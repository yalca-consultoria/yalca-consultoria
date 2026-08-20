// Cliente da API da Claude (Anthropic) — substitui o Ollama local depois
// que o usuário reclamou de demora/qualidade. Modelo Haiku 4.5: o mais
// barato da Claude (US$1/milhão de tokens de entrada, US$5/milhão de
// saída), cobrado na conta Anthropic do próprio usuário — não é mais
// self-hosted, então a fila de concorrência que existia só pra proteger a
// CPU da VPS (Ollama travava o Postgres competindo por núcleo) não faz
// mais sentido aqui: a Anthropic processa requisições concorrentes de
// verdade do lado deles, sem competir com o Supabase.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 2048; // resposta de chat, não precisa de mais que isso

let client = null;
function getClient(apiKey) {
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

function mapError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Chave de API da Claude inválida ou não configurada.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Limite de uso da API da Claude atingido. Tente novamente em instantes.');
  if (err instanceof Anthropic.BadRequestError) return new Error('Requisição inválida pra API da Claude: ' + err.message);
  if (err instanceof Anthropic.APIError) return new Error(`Erro da API da Claude (${err.status}): ${err.message}`);
  return err;
}

// messages: [{role: 'user'|'assistant', content: string}, ...] — mesmo
// formato já usado no resto do app. onChunk recebe cada pedaço de texto
// assim que chega, pra streaming de verdade até o navegador.
async function chatStream(messages, { systemPrompt, onChunk, apiKey }) {
  const anthropic = getClient(apiKey);
  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    });
    stream.on('text', (text) => onChunk(text));
    const final = await stream.finalMessage();
    const textBlock = final.content.find((b) => b.type === 'text');
    return textBlock?.text ?? '';
  } catch (err) {
    throw mapError(err);
  }
}

module.exports = { chatStream, MODEL };
