const IA_API_URL = 'https://ia-api.yalca.com.br';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR');
}

// Mesmo protocolo de streaming do resto do site: checagens prévias (auth,
// aprovação, fila cheia) vêm como JSON de uma vez; a geração em si vem
// como texto puro, chunk por chunk.
async function iaChatCall(message, history, onChunk) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  const res = await fetch(`${IA_API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, history }),
  });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('Não foi possível consultar agora. Tente novamente em instantes.');
    return json;
  }
  if (!res.body) throw new Error('Não foi possível consultar agora. Tente novamente em instantes.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    full += piece;
    onChunk(piece);
  }
  if (!full) throw new Error('Não foi possível gerar a resposta agora. Tente novamente.');
  return { ok: true, reply: full };
}

function initChat() {
  const list = document.getElementById('chatList');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const statusEl = document.getElementById('chatStatus');
  const history = [];

  function renderMessage(role, text) {
    const row = document.createElement('div');
    row.className = `ia-msg ia-msg--${role}`;
    row.innerHTML = `<div class="ia-msg__bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return row;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    renderMessage('user', message);
    input.value = '';
    input.disabled = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Gerando...';
    statusEl.textContent = 'A IA está respondendo...';
    statusEl.style.color = 'var(--text-muted)';

    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'ia-msg ia-msg--assistant';
    const bubble = document.createElement('div');
    bubble.className = 'ia-msg__bubble';
    bubbleRow.appendChild(bubble);
    let started = false;
    let full = '';

    try {
      const result = await iaChatCall(message, history, (piece) => {
        if (!started) { list.appendChild(bubbleRow); started = true; }
        full += piece;
        bubble.innerHTML = escapeHtml(full).replace(/\n/g, '<br>');
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

async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  const { data, error } = await supabaseClient.from('ia_profiles').select('*').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="4">Erro ao carregar: ${escapeHtml(error.message)}</td></tr>`; return; }

  const statusLabels = { pending: 'Pendente', approved: 'Aprovado', blocked: 'Bloqueado' };
  const statusBadge = { pending: 'badge--pending', approved: 'badge--ativo', blocked: 'badge--blocked' };

  tbody.innerHTML = data.map(row => `
    <tr>
      <td data-label="E-mail">${escapeHtml(row.email)}</td>
      <td data-label="Status"><span class="badge ${statusBadge[row.status] || ''}">${statusLabels[row.status] || row.status}</span></td>
      <td data-label="Cadastro">${formatDate(row.created_at)}</td>
      <td data-label="" class="row-actions">
        ${row.status !== 'approved' ? `<button type="button" class="btn btn--ghost btn--sm" data-action="approve" data-id="${row.user_id}">Aprovar</button>` : ''}
        ${row.status !== 'blocked' ? `<button type="button" class="btn btn--ghost btn--sm" data-action="block" data-id="${row.user_id}">Bloquear</button>` : ''}
      </td>
    </tr>`).join('');
}

function initAdmin() {
  document.getElementById('toggleAdminBtn').style.display = '';
  document.getElementById('toggleAdminBtn').addEventListener('click', () => {
    const chatPanel = document.getElementById('chatPanel');
    const adminPanel = document.getElementById('adminPanel');
    const showingAdmin = adminPanel.style.display === 'none';
    adminPanel.style.display = showingAdmin ? '' : 'none';
    chatPanel.style.display = showingAdmin ? 'none' : '';
    document.getElementById('toggleAdminBtn').textContent = showingAdmin ? 'Voltar ao chat' : 'Gerenciar usuários';
    if (showingAdmin) loadUsers();
  });

  document.getElementById('usersTableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const status = btn.dataset.action === 'approve' ? 'approved' : 'blocked';
    btn.disabled = true;
    const { error } = await supabaseClient.from('ia_profiles').update({ status }).eq('user_id', btn.dataset.id);
    if (error) alert('Erro: ' + error.message);
    await loadUsers();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await iaRequireAuth())) return;

  const profile = await iaGetOwnProfile();
  const isAdmin = await iaIsAdmin();

  if (profile?.status !== 'approved' && !isAdmin) {
    document.getElementById('pendingScreen').style.display = 'flex';
    document.getElementById('pendingTitle').textContent = profile?.status === 'blocked' ? 'Acesso bloqueado' : 'Acesso pendente';
    document.getElementById('pendingText').textContent = profile?.status === 'blocked'
      ? 'Sua conta foi bloqueada.'
      : 'Sua conta ainda não foi aprovada. Tente novamente mais tarde.';
    document.getElementById('pendingLogoutBtn').addEventListener('click', async () => { await iaLogout(); window.location.href = 'login.html'; });
    return;
  }

  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutBtn').addEventListener('click', async () => { await iaLogout(); window.location.href = 'login.html'; });

  initChat();
  if (isAdmin) initAdmin();
});
