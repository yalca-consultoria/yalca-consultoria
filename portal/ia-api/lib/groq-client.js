// Cliente da API do Groq — grátis (sem cartão de crédito), rodando em
// hardware próprio (LPU) bem mais rápido que o Ollama local que rodava
// antes. Formato compatível com a API da OpenAI (Chat Completions), então
// é só fetch() puro — não precisa de nenhuma dependência nova, mesmo
// padrão já usado no resto desse projeto (rest-client.js, auth.js).
//
// Limite grátis: 1.000 requisições/dia, 30/minuto, ~100K tokens/dia —
// confortável pro uso pessoal + os clientes do portal. Se algum dia
// estourar, a API devolve 429 (tratado abaixo).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'openai/gpt-oss-120b';
// gpt-oss não aceita imagem — quando o cliente manda uma foto, troca pra
// esse modelo com visão (mesma família Llama 4, também gratuito na Groq).
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
// gpt-oss é um modelo de raciocínio: antes de responder ele gera tokens de
// "pensamento" em inglês (campo separado `reasoning`, não aparece na
// resposta) que contam no mesmo orçamento de max_completion_tokens. Com
// 2048 e reasoning padrão, respostas mais longas (ex.: diagnóstico com
// vários números) estouravam o teto e vinham cortadas no meio da frase.
// reasoning_effort baixo + teto maior resolve.
const MAX_TOKENS = 4096;
const REASONING_EFFORT = 'low';
// Generoso porque a resposta é streamada aos poucos (não é um "tudo ou
// nada" de 90s) — isso só protege contra a chamada travar de vez.
const FETCH_TIMEOUT_MS = 90_000;

function mapError(status, bodyText) {
  if (status === 401) return new Error('Chave de API do Groq inválida ou não configurada.');
  if (status === 429) return new Error('Limite de uso gratuito do Groq atingido por hoje. Tente novamente mais tarde.');
  return new Error(`Erro da API do Groq (${status}): ${bodyText}`);
}

// messages: [{role: 'user'|'assistant', content: string}, ...]. onChunk
// recebe cada pedaço de texto assim que chega (parsing manual do SSE no
// formato OpenAI: linhas "data: {...}", terminado por "data: [DONE]").
// imageDataUrl (opcional): data URL da foto que o cliente anexou — quando
// presente, vira parte do conteúdo multimodal da ÚLTIMA mensagem do
// usuário, e troca o modelo pro que tem visão (gpt-oss não entende imagem).
async function chatStream(messages, { systemPrompt, onChunk, apiKey, imageDataUrl }) {
  let fullMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;

  if (imageDataUrl) {
    fullMessages = fullMessages.map((m, i) => {
      if (i !== fullMessages.length - 1 || m.role !== 'user') return m;
      return { role: 'user', content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: imageDataUrl } }] };
    });
  }
  const model = imageDataUrl ? VISION_MODEL : MODEL;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: fullMessages, max_completion_tokens: MAX_TOKENS, reasoning_effort: REASONING_EFFORT, stream: true }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw mapError(res.status, await res.text().catch(() => ''));

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
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        const json = JSON.parse(payload);
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) { full += piece; onChunk(piece); }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

// Transcreve um áudio (base64) pra texto via Whisper da Groq — usado
// quando o cliente grava a pergunta em vez de digitar. audioBase64 sem o
// prefixo "data:...;base64,", mimeType tipo "audio/webm".
async function transcribeAudio({ audioBase64, mimeType, apiKey }) {
  const buffer = Buffer.from(audioBase64, 'base64');
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'm4a';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
  form.append('model', WHISPER_MODEL);
  form.append('language', 'pt');

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  return json.text || '';
}

module.exports = { chatStream, transcribeAudio, MODEL };
