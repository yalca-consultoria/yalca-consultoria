// Cliente pro Ollama local (127.0.0.1:11434, nunca exposto pra fora) — com
// uma fila que garante NO MÁXIMO uma geração rodando por vez em todo o
// processo. Motivo: cada geração usa boa parte dos 4 vCPUs por vários
// segundos; duas gerações simultâneas competem pelos mesmos núcleos e
// ficam mais lentas ainda (e, com dois modelos diferentes carregados ao
// mesmo tempo, já encheu o swap inteiro num teste real —
// OLLAMA_MAX_LOADED_MODELS=1 evita isso, mas a fila aqui evita a lentidão
// de duas gerações do MESMO modelo disputando CPU).

const OLLAMA_URL = 'http://127.0.0.1:11434';
// qwen2.5:3b — testado contra o 7b (25-33s) e o deepseek-r1 (54-72s): responde
// em ~10s com português ainda bom. Trocado por pedido direto do usuário
// depois de reclamação real de demora.
const MODEL = 'qwen2.5:3b';

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
// da resposta — visto num teste real com o 7b. Detecta caracteres CJK
// assim que aparecem no stream e aborta a geração em vez de deixar o
// cliente receber texto quebrado.
const CJK_RE = /[一-鿿぀-ヿ]/;

function buildMessages(messages, systemPrompt) {
  const langGuard = 'IMPORTANTE: responda SEMPRE em português do Brasil, do início ao fim — nunca troque de idioma no meio da resposta.';
  return [
    { role: 'system', content: systemPrompt ? `${systemPrompt}\n\n${langGuard}` : langGuard },
    ...messages,
  ];
}

// Chama o Ollama com stream:true e entrega cada pedaço de texto pro
// callback onChunk assim que chega — é isso que permite a resposta
// aparecer na tela aos poucos em vez de só no final (a demora total é a
// mesma, mas a sensação de espera muda muito).
async function chatStream(messages, { systemPrompt, onChunk }) {
  return runQueued(async () => {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: buildMessages(messages, systemPrompt), stream: true, options: { temperature: 0.3 } }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama respondeu ${res.status}: ${await res.text().catch(() => '')}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // última linha pode estar incompleta — guarda pro próximo pedaço
        for (const line of lines) {
          if (!line.trim()) continue;
          const json = JSON.parse(line);
          const piece = json.message?.content ?? '';
          if (piece) {
            full += piece;
            if (CJK_RE.test(full)) {
              throw Object.assign(new Error('modelo respondeu em outro idioma'), { code: 'wrong_language' });
            }
            onChunk(piece);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return full;
  });
}

// Checagem síncrona, ANTES de começar a resposta em stream — depois que o
// stream começa (headers já mandados como 200 text/plain) não dá mais pra
// voltar atrás e mandar um JSON de "ocupado" no lugar.
function isBusy() {
  return queueDepth >= MAX_QUEUE_DEPTH;
}

module.exports = { chatStream, isBusy, MODEL };
