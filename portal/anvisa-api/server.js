#!/usr/bin/env node
// Yalca Portal — API Node pura pra Consulta Anvisa. Mesmo esqueleto de
// portal/keepa-api/server.js (mesmo tipo de problema resolvido do mesmo
// jeito: servidor HTTP simples, sem framework, autenticando via GoTrue e
// gravando no Postgres via PostgREST com a service_role key).
//
// Diferente do Keepa: a API da Anvisa é gratuita (sem "tokens" pagos), só
// tem cota de requisições — orçamento aqui é um contador diário simples,
// não uma economia de tokens variável por chamada.
//
// Acesso liberado pra qualquer cliente logado (não exige aprovação, ao
// contrário do resto do portal) — decisão explícita: consulta Anvisa é
// informação pública, não expõe dado sensível do negócio do cliente.
//
// Deploy: site Node.js no CloudPanel (anvisa-api.yalca.com.br, usuário
// anvisaapi, porta 3002), pasta htdocs/anvisa-api.yalca.com.br/ com todo
// esse diretório anvisa-api/ dentro. .env (chmod 600) com
// ANVISA_CLIENT_ID, ANVISA_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY, SUPABASE_URL, PORTAL_ORIGIN, ANVISA_MOCK.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeRestClient } = require('./lib/rest-client');
const { makeAuthClient } = require('./lib/auth');
const { CATEGORIES } = require('./lib/anvisa-categories');

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
const ANVISA_CLIENT_ID = env.ANVISA_CLIENT_ID;
const ANVISA_CLIENT_SECRET = env.ANVISA_CLIENT_SECRET;
const ANVISA_MOCK = env.ANVISA_MOCK === 'true';
const ALLOWED_ORIGIN = env.PORTAL_ORIGIN || 'https://www.yalca.com.br';
const ANVISA_TOKEN_URL = 'https://acesso.prd.apps.anvisa.gov.br/auth/realms/externo/protocol/openid-connect/token';
const ANVISA_GATEWAY = 'https://api-gateway.prd.apps.anvisa.gov.br';
const ANVISA_FETCH_TIMEOUT_MS = 15_000;

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY e/ou SUPABASE_ANON_KEY não configuradas em .env — abortando.');
  process.exit(1);
}

const db = makeRestClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const authClient = makeAuthClient({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

function sendJson(res, status, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  res.writeHead(status, headers);
  if (status === 204) { res.end(); return; }
  res.end(JSON.stringify(body));
}

function readJsonBody(req, res, maxBytes = 200_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (data.length > maxBytes) {
        tooLarge = true;
        sendJson(res, 413, { ok: false, reason: 'payload_too_large', message: 'Requisição grande demais.' });
        req.destroy();
        const err = new Error('payload_too_large'); err.alreadyResponded = true;
        reject(err);
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', (err) => { if (!tooLarge) reject(err); });
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
  if (!adminRow) { sendJson(res, 403, { ok: false, reason: 'forbidden', message: 'Acesso restrito a administradores.' }); return false; }
  return true;
}

// --- token OAuth da Anvisa: cacheado em memória, renovado um pouco antes
// de expirar (expires_in observado ~1740s) — evita autenticar de novo a
// cada requisição de cliente. ---
let cachedAnvisaToken = null; // { accessToken, expiresAt }
async function getAnvisaToken() {
  if (cachedAnvisaToken && cachedAnvisaToken.expiresAt > Date.now() + 30_000) {
    return cachedAnvisaToken.accessToken;
  }
  if (!ANVISA_CLIENT_ID || !ANVISA_CLIENT_SECRET) throw new Error('ANVISA_CLIENT_ID/ANVISA_CLIENT_SECRET não configuradas no ambiente do servidor');
  const res = await fetch(ANVISA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ANVISA_CLIENT_ID, client_secret: ANVISA_CLIENT_SECRET, scope: 'openid' }),
    signal: AbortSignal.timeout(ANVISA_FETCH_TIMEOUT_MS),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`Anvisa auth falhou: ${res.status} ${JSON.stringify(json)}`);
  cachedAnvisaToken = { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
  return cachedAnvisaToken.accessToken;
}

function normalizeCacheKey(categoria, tipo, valor) {
  return `${categoria}:${tipo}:${String(valor).trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

async function handleAnvisaSearch(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  let body;
  try { body = await readJsonBody(req, res); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }

  const categoria = typeof body.categoria === 'string' ? body.categoria.trim() : '';
  const tipo = typeof body.tipo === 'string' ? body.tipo.trim() : '';
  const valor = typeof body.valor === 'string' ? body.valor.trim() : '';
  const categoryDef = CATEGORIES[categoria];
  const validTipos = ['cnpj', 'nome', 'registro', 'processo'];
  if (!categoryDef) { sendJson(res, 400, { ok: false, reason: 'invalid_category', message: 'Categoria de consulta inválida ou ainda não disponível.' }); return; }
  if (!validTipos.includes(tipo) || !valor) { sendJson(res, 400, { ok: false, reason: 'invalid_query', message: 'Informe um CNPJ, nome, número de registro ou de processo válido.' }); return; }

  // --- cache primeiro ---
  const config = await db.restGetOne('anvisa_config', 'id=eq.1&select=*');
  const cacheMaxAgeMs = (config?.query_cache_max_age_hours ?? 24) * 3600 * 1000;
  const cacheKey = normalizeCacheKey(categoria, tipo, valor);
  const cached = await db.restGetOne('anvisa_query_cache', `cache_key=eq.${cacheKey}&select=*`);
  const cacheAgeMs = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (cached && cacheAgeMs < cacheMaxAgeMs) {
    await db.restInsert('anvisa_query_log', [{ user_id: user.id, categoria, tipo, resulted_in_live_call: false }]);
    sendJson(res, 200, { ok: true, source: 'cache', categoria, results: cached.results ?? [] });
    return;
  }

  // --- limite diário do cliente ---
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const searchesToday = await db.restCount('anvisa_query_log', `user_id=eq.${user.id}&resulted_in_live_call=eq.true&searched_at=gte.${startOfDay.toISOString()}`);
  if (searchesToday >= (config?.max_searches_per_client_per_day ?? 20)) {
    sendJson(res, 200, { ok: false, reason: 'client_cap', message: 'Você atingiu o limite de consultas de hoje. Tente novamente amanhã.' });
    return;
  }

  // --- orçamento diário de requisições (compartilhado entre categorias) ---
  const budget = await db.restGetOne('anvisa_request_budget', 'id=eq.1&select=*');
  const todayStr = new Date().toISOString().slice(0, 10);
  const spentToday = budget?.spend_day === todayStr ? (budget?.requests_spent_today ?? 0) : 0;
  const cap = config?.daily_request_cap ?? 500;
  if (spentToday + 1 > cap) {
    sendJson(res, 200, { ok: false, reason: 'no_budget', message: 'Sem cota de consultas disponível hoje. Tente novamente amanhã.' });
    return;
  }

  // --- chamada real (ou mock) ---
  let rawResponse;
  try {
    if (ANVISA_MOCK) {
      rawResponse = categoryDef.mock(valor);
    } else {
      const token = await getAnvisaToken();
      const filter = categoryDef.buildFilter(tipo, valor);
      const kres = await fetch(`${ANVISA_GATEWAY}${categoryDef.endpoint}`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 1, filter: { ...filter, size: 20 } }),
        signal: AbortSignal.timeout(ANVISA_FETCH_TIMEOUT_MS),
      });
      if (!kres.ok) throw new Error(`Anvisa respondeu ${kres.status}`);
      rawResponse = await kres.json();
    }
  } catch (err) {
    await db.restInsert('anvisa_query_log', [{ user_id: user.id, categoria, tipo, resulted_in_live_call: true, success: false, error_message: String(err.message || err) }]);
    sendJson(res, 502, { ok: false, reason: 'anvisa_error', message: 'Não foi possível consultar a Anvisa agora. Tente novamente em instantes.' });
    return;
  }

  const results = (rawResponse.content ?? []).map((raw) => categoryDef.parse(raw));
  const nowIso = new Date().toISOString();

  await db.restUpsert('anvisa_query_cache', [{ cache_key: cacheKey, categoria, tipo, valor, results, fetched_at: nowIso }], 'cache_key');
  await db.restUpdate('anvisa_request_budget', 'id=eq.1', { requests_spent_today: spentToday + 1, spend_day: todayStr, last_checked_at: nowIso });
  await db.restInsert('anvisa_query_log', [{ user_id: user.id, categoria, tipo, resulted_in_live_call: true, success: true }]);

  sendJson(res, 200, { ok: true, source: 'live', categoria, results });
}

async function handleAnvisaCategories(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const list = Object.entries(CATEGORIES).map(([key, def]) => ({ key, label: def.label }));
  sendJson(res, 200, { ok: true, categories: list });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { sendJson(res, 204, null); return; }
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/search') { await handleAnvisaSearch(req, res); return; }
    if (req.method === 'GET' && url === '/categories') { await handleAnvisaCategories(req, res); return; }
    if (req.method === 'GET' && url === '/health') { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 404, { ok: false, reason: 'not_found', message: 'Rota não encontrada.' });
  } catch (err) {
    console.error('erro não tratado:', err);
    sendJson(res, 500, { ok: false, reason: 'internal_error', message: 'Erro interno. Tente novamente.' });
  }
});

server.listen(PORT, () => console.log(`anvisa-api ouvindo na porta ${PORT}${ANVISA_MOCK ? ' (MOCK)' : ''}`));
