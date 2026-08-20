// Cliente pro Ollama local (127.0.0.1:11434, nunca exposto pra fora) — com
// uma fila que garante NO MÁXIMO uma geração rodando por vez em todo o
// processo. Motivo: cada geração usa 100% dos 4 vCPUs por ~20-40s; duas
// gerações simultâneas competem pelos mesmos núcleos e ficam mais lentas
// ainda (e, com dois modelos diferentes carregados ao mesmo tempo, já
// encheu o swap inteiro num teste real — OLLAMA_MAX_LOADED_MODELS=1 evita
// isso, mas a fila aqui evita a lentidão de duas gerações do MESMO modelo
// disputando CPU).

const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL = 'qwen2.5:7b'; // mais rápido e com português melhor que o deepseek-r1 nos testes

const MAX_QUEUE_DEPTH = 3; // acima disso, recusa em vez de empilhar espera enorme

let queueDepth = 0;
let chain = Promise.resolve();

function runQueued(fn) {
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    throw Object.assign(new Error('ai_busy'), { code: 'ai_busy' });
  }
  queueDepth++;
  const result = chain.then(fn, fn);
  chain = result.catch(() => {}); // uma falha não trava a fila pros próximos
  result.finally(() => { queueDepth--; });
  return result;
}

// O Qwen (modelo chinês por origem) ocasionalmente troca de idioma no meio
// da resposta — visto num teste real ("...que a Amazon armazena," seguido
// de chinês). Detecta caracteres CJK e força nova tentativa em vez de
// devolver uma resposta quebrada pro cliente.
const CJK_RE = /[一-鿿぀-ヿ]/;

async function callOnce(fullMessages) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: fullMessages, stream: false, options: { temperature: 0.3 } }),
  });
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.message?.content ?? '';
}

async function chat(messages, { systemPrompt } = {}) {
  const langGuard = 'IMPORTANTE: responda SEMPRE em português do Brasil, do início ao fim — nunca troque de idioma no meio da resposta.';
  const fullMessages = [
    { role: 'system', content: systemPrompt ? `${systemPrompt}\n\n${langGuard}` : langGuard },
    ...messages,
  ];
  return runQueued(async () => {
    let reply = await callOnce(fullMessages);
    if (CJK_RE.test(reply)) reply = await callOnce(fullMessages); // uma segunda tentativa, mesmo prompt
    if (CJK_RE.test(reply)) throw new Error('modelo respondeu em outro idioma repetidamente');
    return reply;
  });
}

module.exports = { chat, MODEL };
