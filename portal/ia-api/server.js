#!/usr/bin/env node
// Yalca Portal — API Node pra IA (DeepSeek testado, Qwen2.5:7b escolhido —
// mais rápido e com português melhor nos testes reais de 2026-08-20).
// Ollama roda local (127.0.0.1:11434, nunca exposto), protegido por
// systemd (OOMScoreAdjust=1000 + MemoryMax) pra nunca derrubar o Supabase
// que roda na mesma VPS — ver lib/ollama-client.js pra fila de concorrência.
//
// Quatro rotas:
//   POST /assistant   — só admin do portal Yalca: chat livre.
//   POST /diagnostico — cliente do portal aprovado: análise a partir dos
//                       dados JÁ cadastrados (sem formulário novo).
//   POST /suporte      — cliente do portal aprovado: chat de dúvidas.
//   POST /chat         — painel pessoal (ia.yalca.com.br), usuário
//                       aprovado em ia_profiles: chat livre. Tabela de
//                       aprovação PRÓPRIA (ia_profiles/ia_admins),
//                       separada de client_profiles/admins do portal —
//                       um cliente do portal não ganha acesso automático
//                       aqui, e vice-versa.
//
// Deploy: site Node.js no CloudPanel (ia-api.yalca.com.br, usuário iaapi,
// porta 3002), mesmo padrão do keepa-api/.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeRestClient } = require('./lib/rest-client');
const { makeAuthClient } = require('./lib/auth');
const { chatStream, isBusy } = require('./lib/ollama-client');
const { buildDiagnosticPrompt } = require('./lib/diagnostic-builder');

function loadEnv(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}
const env = { ...loadEnv(path.join(__dirname, '.env')), ...process.env };

const PORT = Number(env.PORT || 3002);
const SUPABASE_URL = env.SUPABASE_URL || 'https://api.yalca.com.br';
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;
// Duas origens diferentes chamam essa API: o portal da Yalca (/assistant,
// /diagnostico, /suporte) e o painel pessoal (/chat) — cada uma só pode
// receber SEU PRÓPRIO Access-Control-Allow-Origin de volta, nunca as duas
// juntas, então reflete a origem da requisição atual se ela bater com uma
// das permitidas (res.req dá acesso à requisição original a partir da
// resposta, evitando ter que passar req por toda função que monta headers).
const ALLOWED_ORIGINS = [
  env.PORTAL_ORIGIN || 'https://www.yalca.com.br',
  env.IA_PANEL_ORIGIN || 'https://ia.yalca.com.br',
];
function corsOriginFor(res) {
  const origin = res.req?.headers?.origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY = 12; // mensagens (não pares) — limita o tamanho do contexto mandado pro modelo

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY e/ou SUPABASE_ANON_KEY não configuradas em .env — abortando.');
  process.exit(1);
}

const db = makeRestClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const authClient = makeAuthClient({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

function sendJson(res, status, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOriginFor(res),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  res.writeHead(status, headers);
  if (status === 204) { res.end(); return; }
  res.end(JSON.stringify(body));
}

// Começa uma resposta em texto puro, indo direto (chunked, sem
// Content-Length) — é isso que deixa o front-end ler pedaço por pedaço em
// vez de esperar o corpo inteiro. Erros de PRÉ-checagem (auth, aprovação,
// fila cheia) acontecem ANTES disso e continuam mandando JSON normal —
// só a geração em si vira texto puro.
function startTextStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': corsOriginFor(res),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-cache',
  });
}

// Roda a geração e transmite os pedaços; devolve a mensagem de erro (pra
// logar) se algo falhar DEPOIS que o stream já começou — nesse caso não dá
// mais pra mandar um JSON de erro (os headers já foram enviados), então só
// encerra a conexão; o front-end trata isso como "parou no meio".
async function streamChatResponse(res, messages, systemPrompt) {
  startTextStream(res);
  try {
    const full = await chatStream(messages, {
      systemPrompt,
      onChunk: (piece) => res.write(piece),
    });
    res.end();
    return { ok: true, full };
  } catch (err) {
    res.end();
    return { ok: false, error: err };
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 200_000) req.destroy(); });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function requireUser(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) { sendJson(res, 401, { ok: false, reason: 'unauthenticated', message: 'Sessão inválida. Faça login novamente.' }); return null; }
  const user = await authClient.getUserFromToken(token);
  if (!user) { sendJson(res, 401, { ok: false, reason: 'unauthenticated', message: 'Sessão inválida. Faça login novamente.' }); return null; }
  return user;
}

async function requireAdmin(userId, res) {
  const adminRow = await db.restGetOne('admins', `user_id=eq.${userId}&select=user_id`);
  if (!adminRow) { sendJson(res, 403, { ok: false, reason: 'forbidden', message: 'Acesso restrito.' }); return false; }
  return true;
}

async function requireApprovedClient(userId, res) {
  const [profile, adminRow] = await Promise.all([
    db.restGetOne('client_profiles', `user_id=eq.${userId}&select=status`),
    db.restGetOne('admins', `user_id=eq.${userId}&select=user_id`),
  ]);
  if (profile?.status !== 'approved' && !adminRow) {
    sendJson(res, 200, { ok: false, reason: 'not_approved', message: 'Seu acesso ainda não foi aprovado pela Yalca.' });
    return false;
  }
  return true;
}

// Painel pessoal (ia.yalca.com.br) — tabelas de aprovação próprias
// (ia_profiles/ia_admins), independentes do portal da Yalca.
async function requireApprovedIaUser(userId, res) {
  const [profile, adminRow] = await Promise.all([
    db.restGetOne('ia_profiles', `user_id=eq.${userId}&select=status`),
    db.restGetOne('ia_admins', `user_id=eq.${userId}&select=user_id`),
  ]);
  if (profile?.status !== 'approved' && !adminRow) {
    sendJson(res, 200, { ok: false, reason: 'not_approved', message: 'Seu acesso ainda não foi aprovado.' });
    return false;
  }
  return true;
}

// Sanitiza o histórico recebido do cliente: só role+content, string, dentro
// do limite de tamanho — nunca confia no shape que veio da requisição.
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LEN) }));
}

async function handleAssistant(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireAdmin(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';
  if (!message) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Mensagem vazia.' }); return; }
  const history = sanitizeHistory(body.history);

  if (isBusy()) { sendJson(res, 200, { ok: false, reason: 'ai_busy', message: 'O assistente está processando outra solicitação. Tente novamente em instantes.' }); return; }
  const { ok, error } = await streamChatResponse(res, [...history, { role: 'user', content: message }],
    'Você é um assistente pessoal do Yanderson, que administra a Yalca Consultoria (consultoria de e-commerce) e sua própria marca de suplementos na Amazon (FBA). Responda em português do Brasil, de forma direta e prática.');
  if (!ok) console.error('erro no assistant (stream já iniciado):', error);
}

async function handleDiagnostico(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireApprovedClient(user.id, res))) return;

  const summary = await buildDiagnosticPrompt(db, user.id);
  if (!summary) {
    sendJson(res, 200, { ok: false, reason: 'no_data', message: 'Ainda não há dados suficientes cadastrados (lançamentos financeiros ou produtos) pra gerar um diagnóstico.' });
    return;
  }
  if (isBusy()) { sendJson(res, 200, { ok: false, reason: 'ai_busy', message: 'O assistente está processando outra solicitação. Tente novamente em instantes.' }); return; }

  const { ok, error } = await streamChatResponse(res, [{
    role: 'user',
    content: `Aqui estão os dados reais da loja de um cliente de e-commerce nos últimos 6 meses:\n\n${summary}\n\nEscreva um diagnóstico curto (4-6 parágrafos) em português do Brasil: pontos fortes, pontos de atenção, e 2-3 recomendações práticas e específicas com base nesses números. Não invente dados que não foram informados.`,
  }], 'Você é um consultor de e-commerce da Yalca Consultoria, analisando os dados reais de um cliente. Seja direto, específico e baseado só nos números fornecidos — nunca invente números.');
  if (!ok) console.error('erro no diagnostico (stream já iniciado):', error);
}

async function handleSuporte(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireApprovedClient(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';
  if (!message) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Mensagem vazia.' }); return; }
  const history = sanitizeHistory(body.history);

  if (isBusy()) { sendJson(res, 200, { ok: false, reason: 'ai_busy', message: 'O assistente está processando outra solicitação. Tente novamente em instantes.' }); return; }
  const { ok, error } = await streamChatResponse(res, [...history, { role: 'user', content: message }],
    'Você é o assistente de suporte do portal da Yalca Consultoria, uma consultoria de e-commerce. Ajude o cliente com dúvidas sobre gestão financeira, marketplaces e as ferramentas do portal (calculadora de preço, controle de estoque, fluxo de caixa). Responda em português do Brasil, de forma clara e objetiva. Se a dúvida for algo que só a equipe da Yalca pode resolver (ex: problema de conta, cobrança), oriente o cliente a entrar em contato com a Yalca diretamente.');
  if (!ok) console.error('erro no suporte (stream já iniciado):', error);
}

async function handlePanelChat(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireApprovedIaUser(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';
  if (!message) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Mensagem vazia.' }); return; }
  const history = sanitizeHistory(body.history);

  if (isBusy()) { sendJson(res, 200, { ok: false, reason: 'ai_busy', message: 'O assistente está processando outra solicitação. Tente novamente em instantes.' }); return; }
  const { ok, error } = await streamChatResponse(res, [...history, { role: 'user', content: message }],
    'Você é um assistente de IA de uso pessoal. Responda em português do Brasil, de forma direta e útil.');
  if (!ok) console.error('erro no chat do painel (stream já iniciado):', error);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { sendJson(res, 204, null); return; }
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/assistant') { await handleAssistant(req, res); return; }
    if (req.method === 'POST' && url === '/diagnostico') { await handleDiagnostico(req, res); return; }
    if (req.method === 'POST' && url === '/suporte') { await handleSuporte(req, res); return; }
    if (req.method === 'POST' && url === '/chat') { await handlePanelChat(req, res); return; }
    if (req.method === 'GET' && url === '/health') { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 404, { ok: false, reason: 'not_found', message: 'Rota não encontrada.' });
  } catch (err) {
    console.error('erro não tratado:', err);
    sendJson(res, 500, { ok: false, reason: 'internal_error', message: 'Erro interno. Tente novamente.' });
  }
});

server.listen(PORT, () => console.log(`ia-api ouvindo na porta ${PORT}`));
