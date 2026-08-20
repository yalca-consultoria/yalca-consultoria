/* =========================================
   Yalca Portal — IA (assistente / diagnóstico / suporte)
   Respostas demoram 20-70s (Ollama local, CPU) — todo
   estado de "gerando" precisa ficar visível e o botão
   de enviar precisa travar até a resposta voltar.
   ========================================= */

function initIaSection() {
  initIaTabs();
  initIaDiagnostico({ btnId: 'iaDiagnosticoBtn', resultId: 'iaDiagnosticoResult', statusId: 'iaDiagnosticoStatus' });
  initIaChat({
    listId: 'suporteChatList', formId: 'suporteChatForm', inputId: 'suporteChatInput', statusId: 'suporteChatStatus',
    apiFn: yalcaIaSuporte,
    emptyText: 'Pergunte sobre a calculadora de preço, controle de estoque, fluxo de caixa ou qualquer dúvida sobre o portal.',
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
// apiFn(message, history) -> {ok, reply, message}
function initIaChat({ listId, formId, inputId, statusId, apiFn, emptyText }) {
  const list = document.getElementById(listId);
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  if (!form) return;

  const history = [];

  function renderMessage(role, text) {
    const row = document.createElement('div');
    row.className = `ia-msg ia-msg--${role}`;
    row.innerHTML = `<div class="ia-msg__bubble">${yalcaEscapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  if (emptyText && list.children.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'alert-empty';
    hint.textContent = emptyText;
    list.appendChild(hint);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    const emptyHint = list.querySelector('.alert-empty');
    if (emptyHint) emptyHint.remove();

    renderMessage('user', message);
    input.value = '';
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
      });
      if (!result.ok) {
        if (started) bubbleRow.remove();
        statusEl.textContent = result.message || 'Não foi possível gerar a resposta agora.';
        statusEl.style.color = 'var(--warning)';
        return;
      }
      history.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
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
