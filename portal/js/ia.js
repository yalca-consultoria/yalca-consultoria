/* =========================================
   Yalca Portal — IA (assistente / diagnóstico / suporte)
   Respostas demoram 20-70s (Ollama local, CPU) — todo
   estado de "gerando" precisa ficar visível e o botão
   de enviar precisa travar até a resposta voltar.
   ========================================= */

function yalcaLoadIaHistory(storageId) {
  try {
    const raw = localStorage.getItem(storageId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function initIaSection() {
  initIaTabs();
  initIaDiagnostico({ btnId: 'iaDiagnosticoBtn', resultId: 'iaDiagnosticoResult', statusId: 'iaDiagnosticoStatus' });
  initIaChat({
    listId: 'suporteChatList', formId: 'suporteChatForm', inputId: 'suporteChatInput', statusId: 'suporteChatStatus',
    apiFn: yalcaIaSuporte,
    emptyText: 'Pergunte sobre a calculadora de preço, controle de estoque, fluxo de caixa ou qualquer dúvida sobre o portal.',
    storageKey: 'suporte',
    suggestions: [
      'Como funciona a calculadora de preço?',
      'Como registro uma entrada no fluxo de caixa?',
      'Como faço pra exportar um relatório em PDF?',
    ],
  });
}

function initIaTabs() {
  document.querySelectorAll('.ia-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.iaTab;
      document.querySelectorAll('.ia-tab').forEach(t => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.ia-tabpanel').forEach(p => p.classList.toggle('is-active', p.dataset.iaPanel === target));
    });
  });
}

// Cria um chat completo (histórico + input + envio) num container.
// apiFn(message, history, onChunk, attachments) -> {ok, reply, message}
// enableAttachments (opcional): injeta botão de foto + microfone antes do
// campo de texto — só usado pelo widget de agente por página; os outros
// chats (Assistente/Suporte) continuam sem, passando undefined.
function initIaChat({ listId, formId, inputId, statusId, apiFn, emptyText, enableAttachments, storageKey, suggestions, contextHint }) {
  const list = document.getElementById(listId);
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  if (!form) return;

  // Sem isso a conversa some ao trocar de página ou dar refresh — cada chat
  // guarda seu próprio histórico no navegador do usuário (nunca sai daqui,
  // não é enviado a lugar nenhum além do que o próprio chat já envia).
  const storageId = storageKey ? `yalca_ia_${storageKey}` : null;
  const history = (storageId && yalcaLoadIaHistory(storageId)) || [];

  let pendingImageDataUrl = null;
  let pendingAudio = null; // { base64, mimeType }
  let mediaRecorder = null;
  let recordedChunks = [];

  function saveHistory() {
    if (!storageId) return;
    try { localStorage.setItem(storageId, JSON.stringify(history.slice(-20))); } catch { /* quota/privado: ignora */ }
  }

  function renderMessage(role, text) {
    const row = document.createElement('div');
    row.className = `ia-msg ia-msg--${role}`;
    row.innerHTML = `<div class="ia-msg__bubble">${yalcaEscapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  function renderEmptyState() {
    if (emptyText) {
      const hint = document.createElement('p');
      hint.className = 'alert-empty';
      hint.textContent = emptyText;
      list.appendChild(hint);
    }
    if (suggestions?.length) {
      const box = document.createElement('div');
      box.className = 'ia-suggestions';
      suggestions.forEach((text) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ia-suggestion-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
          input.value = text;
          form.requestSubmit();
        });
        box.appendChild(chip);
      });
      list.appendChild(box);
    }
  }

  if (contextHint) {
    const hint = document.createElement('p');
    hint.className = 'ia-context-hint';
    hint.textContent = contextHint;
    form.parentNode.insertBefore(hint, list);
  }

  if (history.length) {
    history.forEach((msg) => renderMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content));
  } else if (list.children.length === 0) {
    renderEmptyState();
  }

  let attachBtn, micBtn, imageInput, attachPreview;
  if (enableAttachments) {
    const row = document.createElement('div');
    row.className = 'ia-attach-row';
    row.innerHTML = `
      <input type="file" accept="image/*" id="${inputId}_img" style="display:none;">
      <button type="button" class="ia-attach-btn" id="${inputId}_attachBtn" title="Anexar foto">📷</button>
      <button type="button" class="ia-attach-btn" id="${inputId}_micBtn" title="Gravar áudio">🎤</button>
      <span class="ia-attach-preview" id="${inputId}_preview"></span>`;
    form.parentNode.insertBefore(row, form);
    imageInput = row.querySelector(`#${inputId}_img`);
    attachBtn = row.querySelector(`#${inputId}_attachBtn`);
    micBtn = row.querySelector(`#${inputId}_micBtn`);
    attachPreview = row.querySelector(`#${inputId}_preview`);

    attachBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingImageDataUrl = reader.result;
        attachPreview.textContent = '🖼️ foto anexada';
      };
      reader.readAsDataURL(file);
    });

    micBtn.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        micBtn.textContent = '🎤';
        micBtn.classList.remove('is-recording');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = () => {
            pendingAudio = { base64: reader.result.split(',')[1], mimeType: 'audio/webm' };
            attachPreview.textContent = '🎙️ áudio gravado';
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        micBtn.textContent = '⏹️';
        micBtn.classList.add('is-recording');
      } catch {
        statusEl.textContent = 'Não foi possível acessar o microfone.';
        statusEl.style.color = 'var(--critical)';
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message && !pendingImageDataUrl && !pendingAudio) return;

    list.querySelector('.alert-empty')?.remove();
    list.querySelector('.ia-suggestions')?.remove();

    const attachments = (pendingImageDataUrl || pendingAudio)
      ? { imageDataUrl: pendingImageDataUrl, audioBase64: pendingAudio?.base64, audioMimeType: pendingAudio?.mimeType }
      : null;
    let userLabel = message;
    if (!userLabel) userLabel = attachments?.imageDataUrl ? '📷 (foto enviada)' : '🎤 (áudio enviado)';
    else if (attachments?.imageDataUrl) userLabel += ' 📷';
    renderMessage('user', userLabel);
    input.value = '';
    pendingImageDataUrl = null;
    pendingAudio = null;
    if (attachPreview) attachPreview.textContent = '';
    if (imageInput) imageInput.value = '';
    input.disabled = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Gerando...';
    statusEl.textContent = 'A IA está respondendo...';
    statusEl.style.color = 'var(--text-muted)';

    // A bolha do assistente já entra na tela vazia e vai sendo preenchida
    // conforme os pedaços chegam — é isso que faz a resposta "aparecer
    // aos poucos" em vez de só surgir pronta no final.
    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'ia-msg ia-msg--assistant';
    const bubble = document.createElement('div');
    bubble.className = 'ia-msg__bubble';
    bubbleRow.appendChild(bubble);
    let started = false;
    let full = '';

    try {
      const result = await apiFn(message, history, (piece) => {
        if (!started) { list.appendChild(bubbleRow); started = true; }
        full += piece;
        bubble.innerHTML = yalcaEscapeHtml(full).replace(/\n/g, '<br>');
        list.scrollTop = list.scrollHeight;
      }, attachments);
      if (!result.ok) {
        if (started) bubbleRow.remove();
        statusEl.textContent = result.message || 'Não foi possível gerar a resposta agora.';
        statusEl.style.color = 'var(--warning)';
        return;
      }
      history.push({ role: 'user', content: message || userLabel }, { role: 'assistant', content: result.reply });
      saveHistory();
      statusEl.textContent = '';
    } catch (err) {
      if (started) bubbleRow.remove();
      statusEl.textContent = 'Não foi possível consultar agora: ' + err.message;
      statusEl.style.color = 'var(--critical)';
    } finally {
      input.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar';
      input.focus();
    }
  });
}

// Widget flutuante de agente especializado — um por página do portal.
// Reaproveita initIaChat (mesma lógica de streaming/histórico do chat de
// Suporte) só que injeta o HTML do balão+painel na hora, em vez de exigir
// marcação própria em cada página. AGENT_LABELS/EMPTY_TEXTS vivem aqui
// mesmo pra não duplicar string em toda página que chama a função.
const IA_AGENT_LABELS = {
  overview: 'Assistente da Visão Geral',
  financeiro: 'Assistente Financeiro',
  fluxocaixa: 'Assistente de Fluxo de Caixa',
  marketplaces: 'Assistente de Marketplaces',
  estoque: 'Assistente de Estoque',
  precificacao: 'Assistente de Precificação',
  concorrencia: 'Assistente de Compras & Concorrência',
};

// Perguntas prontas por página — reduz a barreira de "não sei o que
// perguntar" e mostra na prática que o assistente enxerga os dados reais
// desta tela (não é um chat genérico).
const IA_AGENT_SUGGESTIONS = {
  overview: ['O que mais precisa da minha atenção agora?', 'Resuma como está o negócio este mês.'],
  financeiro: ['Minha margem está saudável?', 'Onde estão minhas maiores despesas?'],
  fluxocaixa: ['Vou ter saldo suficiente no fim do mês?', 'Quais contas a pagar estão mais próximas?'],
  marketplaces: ['Qual canal está vendendo melhor?', 'Algum anúncio parado ou sem estoque?'],
  estoque: ['Quais produtos estão perto de acabar?', 'Tem produto parado há muito tempo?'],
  precificacao: ['Meu preço atual cobre bem os custos?', 'Como melhorar minha margem nesse produto?'],
  concorrencia: ['Estou perdendo a buybox em algum produto?', 'Que produto merece atenção agora?'],
};

function initIaAgentWidget(agentKey) {
  // Algumas páginas chamam a função de render principal mais de uma vez
  // (ex: depois de recarregar dados) — sem essa guarda, o widget duplicaria
  // o próprio DOM (e o listener do chat) a cada re-render.
  if (document.querySelector('.ia-widget')) return;
  const label = IA_AGENT_LABELS[agentKey];
  if (!label) return;

  const wrap = document.createElement('div');
  wrap.className = 'ia-widget';
  wrap.innerHTML = `
    <button type="button" class="ia-widget__toggle" id="iaWidgetToggle" aria-label="${yalcaEscapeHtml(label)}">💬</button>
    <div class="ia-widget__panel" id="iaWidgetPanel" style="display:none;">
      <div class="ia-widget__header">
        <span>${yalcaEscapeHtml(label)}</span>
        <button type="button" class="ia-widget__close" id="iaWidgetClose" aria-label="Fechar">✕</button>
      </div>
      <div class="ia-chat-list" id="iaWidgetList" style="max-height:320px;"></div>
      <p class="ia-widget__status" id="iaWidgetStatus"></p>
      <form class="ia-chat-form" id="iaWidgetForm">
        <textarea id="iaWidgetInput" placeholder="Pergunte algo sobre esta página..." required></textarea>
        <button type="submit" class="btn btn--primary btn--sm">Enviar</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  const toggle = document.getElementById('iaWidgetToggle');
  const panel = document.getElementById('iaWidgetPanel');
  const closeBtn = document.getElementById('iaWidgetClose');
  toggle.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? '' : 'none'; });
  closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

  initIaChat({
    listId: 'iaWidgetList', formId: 'iaWidgetForm', inputId: 'iaWidgetInput', statusId: 'iaWidgetStatus',
    apiFn: (message, history, onChunk, attachments) => yalcaIaAgente(agentKey, message, history, onChunk, attachments),
    emptyText: 'Pergunte algo sobre os dados desta página, ou anexe uma foto/áudio.',
    enableAttachments: true,
    storageKey: `agente_${agentKey}`,
    suggestions: IA_AGENT_SUGGESTIONS[agentKey],
    contextHint: 'Este assistente já enxerga os dados reais desta página.',
  });
}

// Diagnóstico: sem histórico de conversa, só um botão "gerar" e o
// resultado (texto corrido) — os dados já vêm do que o cliente cadastrou.
function initIaDiagnostico({ btnId, resultId, statusId }) {
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById(resultId);
  const statusEl = document.getElementById(statusId);
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Gerando diagnóstico...';
    statusEl.textContent = 'Analisando seus dados...';
    statusEl.style.color = 'var(--text-muted)';
    resultEl.style.display = 'none';
    resultEl.innerHTML = '';
    let full = '';

    try {
      const result = await yalcaIaDiagnostico((piece) => {
        resultEl.style.display = '';
        full += piece;
        resultEl.innerHTML = yalcaEscapeHtml(full).replace(/\n/g, '<br>');
      });
      if (!result.ok) {
        resultEl.style.display = 'none';
        statusEl.textContent = result.message || 'Não foi possível gerar o diagnóstico agora.';
        statusEl.style.color = 'var(--warning)';
        return;
      }
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Não foi possível gerar agora: ' + err.message;
      statusEl.style.color = 'var(--critical)';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Gerar diagnóstico';
    }
  });
}
