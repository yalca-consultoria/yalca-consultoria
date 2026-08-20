/* =========================================
   Yalca Portal — painel de controle
   Visível apenas para quem está na tabela "admins".
   Como administrador, as políticas de RLS liberam a
   leitura de transactions/products/client_settings de
   TODOS os clientes — por isso as consultas abaixo não
   filtram por user_id (exceto quando buscamos 1 cliente
   específico para a tela de detalhes).
   ========================================= */

let CLIENTS = [];
let ADMINS = [];
let ALL_TRANSACTIONS = [];
let ALL_PRODUCTS = [];
let CLIENT_METRICS = new Map();
let CURRENT_USER_ID = null;

let sortState = { column: 'receita', dir: 'desc' };
let periodFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await yalcaRequireAuth();
  if (!authed) return;

  const isAdmin = await yalcaIsAdmin();
  if (!isAdmin) {
    document.getElementById('deniedScreen').style.display = 'flex';
    return;
  }

  const user = await yalcaCurrentUser();
  CURRENT_USER_ID = user ? user.id : null;

  document.getElementById('adminShell').style.display = 'block';
  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  initIaChat({
    listId: 'assistantChatList', formId: 'assistantChatForm', inputId: 'assistantChatInput', statusId: 'assistantChatStatus',
    apiFn: yalcaIaAssistant,
    emptyText: 'Pergunte qualquer coisa — sobre a Yalca, sua marca FBA, ou peça pra gerar/revisar um texto.',
  });

  document.getElementById('statusFilter').addEventListener('change', renderClientsTable);
  document.getElementById('clientSearch').addEventListener('input', renderClientsTable);
  document.getElementById('periodFilter').addEventListener('change', (e) => {
    periodFilter = e.target.value;
    recomputeMetricsAndRender();
  });
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortState.column === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      else sortState = { column: col, dir: 'asc' };
      renderClientsTable();
    });
  });

  document.getElementById('exportClientsCsvBtn').addEventListener('click', exportClientsCsv);
  document.getElementById('promoteAdminBtn').addEventListener('click', promoteSelectedAdmin);

  document.getElementById('clientsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, status } = btn.dataset;
    if (action === 'openClientDetail') openClientDetail(id);
    else if (action === 'openNotes') openNotes(id);
    else if (action === 'updateClientStatus') updateClientStatus(id, status);
    else if (action === 'deleteClient') deleteClient(id);
  });
  document.getElementById('adminsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="removeAdmin"]');
    if (!btn) return;
    removeAdmin(btn.dataset.id);
  });

  initModals();
  document.getElementById('notesForm').addEventListener('submit', saveNotes);

  await loadClients();
});

function initModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });
}
function openModal(id) { document.getElementById(id).classList.add('is-open'); }
function closeModal(id) { document.getElementById(id).classList.remove('is-open'); }

/* ============================================================
   CARGA DE DADOS
   ============================================================ */
async function loadClients() {
  try {
    const [profilesRes, transactionsRes, productsRes, adminsRes] = await Promise.all([
      supabaseClient.from('client_profiles').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('transactions').select('*'),
      supabaseClient.from('products').select('*'),
      supabaseClient.from('admins').select('user_id')
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (transactionsRes.error) throw new Error(transactionsRes.error.message);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (adminsRes.error) throw new Error(adminsRes.error.message);

    CLIENTS = profilesRes.data || [];
    ALL_TRANSACTIONS = transactionsRes.data || [];
    ALL_PRODUCTS = productsRes.data || [];
    ADMINS = adminsRes.data || [];

    recomputeMetricsAndRender();
    renderAdminsPanel();
  } catch (err) {
    alert('Não foi possível carregar os clientes: ' + err.message);
  }
}

function periodStartDate(period) {
  const now = new Date();
  if (period === 'month') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (period === 'last3') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return null;
}

function recomputeMetricsAndRender() {
  const start = periodStartDate(periodFilter);
  const filteredTx = start ? ALL_TRANSACTIONS.filter(t => t.date >= start) : ALL_TRANSACTIONS;
  CLIENT_METRICS = buildClientMetrics(filteredTx, ALL_PRODUCTS);
  renderKpis();
  renderVgvChart();
  renderClientsTable();
}

function buildClientMetrics(transactions, products) {
  const map = new Map();
  const ensure = (userId) => {
    if (!map.has(userId)) map.set(userId, { receita: 0, despesa: 0, produtos: 0 });
    return map.get(userId);
  };
  transactions.forEach(t => {
    const bucket = ensure(t.user_id);
    if (t.type === 'receita') bucket.receita += Number(t.amount);
    else bucket.despesa += Number(t.amount);
  });
  products.forEach(p => ensure(p.user_id).produtos += 1);
  return map;
}

function metricsFor(userId) {
  const m = CLIENT_METRICS.get(userId) || { receita: 0, despesa: 0, produtos: 0 };
  const lucro = m.receita - m.despesa;
  const margem = m.receita > 0 ? (lucro / m.receita) * 100 : 0;
  return { ...m, lucro, margem };
}

/* ============================================================
   KPIs E GRÁFICO
   ============================================================ */
function renderKpis() {
  const pending = CLIENTS.filter(c => c.status === 'pending').length;
  const approved = CLIENTS.filter(c => c.status === 'approved').length;
  const blocked = CLIENTS.filter(c => c.status === 'blocked').length;

  let vgvTotal = 0, lucroTotal = 0;
  CLIENTS.forEach(c => {
    const m = metricsFor(c.user_id);
    vgvTotal += m.receita;
    lucroTotal += m.lucro;
  });

  document.getElementById('adminKpis').innerHTML = [
    { label: 'Total de clientes', value: CLIENTS.length },
    { label: 'Aguardando aprovação', value: pending },
    { label: 'Aprovados', value: approved },
    { label: 'Bloqueados', value: blocked },
    { label: 'VGV total (período)', value: yalcaFormatCurrency(vgvTotal) },
    { label: 'Lucro agregado (período)', value: yalcaFormatCurrency(lucroTotal) }
  ].map(k => `
    <div class="kpi-card">
      <div class="kpi-card__label">${k.label}</div>
      <div class="kpi-card__value">${k.value}</div>
    </div>`).join('');
}

function renderVgvChart() {
  const container = document.getElementById('vgvChart');
  const data = CLIENTS
    .map(c => ({ label: c.store_name || c.email, value: metricsFor(c.user_id).receita, color: YALCA_COLORS.series1 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  if (data.length === 0) {
    container.innerHTML = '<p class="alert-empty">Nenhum cliente com receita lançada nesse período.</p>';
    return;
  }
  yalcaRenderBarChart(container, { data, formatValue: (v) => yalcaFormatCurrency(v) });
}

/* ============================================================
   TABELA DE CLIENTES (busca, ordenação, ações)
   ============================================================ */
function renderClientsTable() {
  const statusValue = document.getElementById('statusFilter').value;
  const search = document.getElementById('clientSearch').value.trim().toLowerCase();

  let rows = CLIENTS.filter(c => statusValue === 'todos' || c.status === statusValue);
  if (search) {
    rows = rows.filter(c =>
      (c.store_name || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search)
    );
  }

  rows = [...rows].sort((a, b) => {
    const dir = sortState.dir === 'asc' ? 1 : -1;
    const col = sortState.column;
    if (['receita', 'lucro', 'margem', 'produtos'].includes(col)) {
      return (metricsFor(a.user_id)[col] - metricsFor(b.user_id)[col]) * dir;
    }
    if (col === 'created_at') {
      return (new Date(a.created_at) - new Date(b.created_at)) * dir;
    }
    const av = (a[col] || '').toString().toLowerCase();
    const bv = (b[col] || '').toString().toLowerCase();
    return av.localeCompare(bv) * dir;
  });

  document.querySelectorAll('.sortable-th').forEach(th => {
    th.classList.toggle('is-active', th.dataset.sort === sortState.column);
    const arrow = th.querySelector('.sort-arrow');
    arrow.textContent = th.dataset.sort === sortState.column ? (sortState.dir === 'asc' ? '▴' : '▾') : '▾';
  });

  const tbody = document.getElementById('clientsTableBody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="alert-empty">Nenhum cliente encontrado.</td></tr>';
    return;
  }

  const badge = {
    pending: '<span class="badge badge--pending">Pendente</span>',
    approved: '<span class="badge badge--ativo">Aprovado</span>',
    blocked: '<span class="badge badge--blocked">Bloqueado</span>'
  };

  tbody.innerHTML = rows.map(c => {
    const m = metricsFor(c.user_id);
    const margemClass = m.receita === 0 ? '' : (m.margem < 0 ? 'text-critical' : (m.margem < 15 ? '' : 'text-good'));
    return `
    <tr>
      <td>${yalcaEscapeHtmlSafe(c.store_name) || '—'}</td>
      <td>${yalcaEscapeHtmlSafe(c.email)}</td>
      <td class="num">${yalcaFormatCurrency(m.receita)}</td>
      <td class="num ${m.lucro < 0 ? 'text-critical' : ''}">${yalcaFormatCurrency(m.lucro)}</td>
      <td class="num ${margemClass}">${m.receita > 0 ? m.margem.toFixed(1) + '%' : '—'}</td>
      <td class="num">${m.produtos}</td>
      <td>${new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
      <td>${badge[c.status] || c.status}</td>
      <td class="row-actions">
        <button class="icon-btn" title="Ver detalhes" data-action="openClientDetail" data-id="${c.user_id}">👁</button>
        <button class="icon-btn" title="Observações" data-action="openNotes" data-id="${c.user_id}">📝</button>
        ${c.status === 'pending' ? `<button class="icon-btn" title="Aprovar" data-action="updateClientStatus" data-id="${c.user_id}" data-status="approved">✔</button>` : ''}
        ${c.status !== 'blocked' ? `<button class="icon-btn" title="Bloquear" data-action="updateClientStatus" data-id="${c.user_id}" data-status="blocked">⛔</button>` : ''}
        ${c.status === 'blocked' ? `<button class="icon-btn" title="Reativar" data-action="updateClientStatus" data-id="${c.user_id}" data-status="approved">↺</button>` : ''}
        <button class="icon-btn" title="Excluir cliente" data-action="deleteClient" data-id="${c.user_id}">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

async function updateClientStatus(userId, status) {
  if (status === 'blocked' && !confirm('Bloquear este cliente? Ele perde acesso às ferramentas imediatamente.')) return;
  try {
    const { error } = await supabaseClient.from('client_profiles').update({ status }).eq('user_id', userId);
    if (error) throw new Error(error.message);
    await loadClients();
  } catch (err) {
    alert('Não foi possível atualizar o status: ' + err.message);
  }
}

/* ============================================================
   DETALHES DO CLIENTE
   ============================================================ */
async function openClientDetail(userId) {
  const profile = CLIENTS.find(c => c.user_id === userId);
  if (!profile) return;
  document.getElementById('clientDetailTitle').textContent = profile.store_name || profile.email;

  try {
    const { data: settingsRow, error: settingsError } = await supabaseClient
      .from('client_settings').select('*').eq('user_id', userId).maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const settings = settingsRow ? dbToSettings(settingsRow) : {
      clientName: profile.store_name || '',
      cashBalance: 0,
      defaultTaxPct: 6,
      defaultShippingCost: 12,
      marketplaceFees: { ...MARKETPLACE_FEES_DEFAULT }
    };

    const clientTx = ALL_TRANSACTIONS.filter(t => t.user_id === userId);
    const clientProducts = ALL_PRODUCTS.filter(p => p.user_id === userId).map(dbToProduct);

    const receitaTotal = clientTx.filter(t => t.type === 'receita').reduce((a, t) => a + Number(t.amount), 0);
    const despesaTotal = clientTx.filter(t => t.type === 'despesa').reduce((a, t) => a + Number(t.amount), 0);
    const lucro = receitaTotal - despesaTotal;
    const margem = receitaTotal > 0 ? (lucro / receitaTotal) * 100 : 0;
    const estoqueAlerta = clientProducts.filter(p => ['Esgotado', 'Baixo'].includes(yalcaStockStatus(p))).length;

    document.getElementById('clientDetailKpis').innerHTML = [
      { label: 'Faturamento total', value: yalcaFormatCurrency(receitaTotal) },
      { label: 'Lucro total', value: yalcaFormatCurrency(lucro) },
      { label: 'Margem', value: receitaTotal > 0 ? margem.toFixed(1) + '%' : '—' },
      { label: 'Produtos cadastrados', value: clientProducts.length },
      { label: 'Estoque em alerta', value: estoqueAlerta }
    ].map(k => `
      <div class="kpi-card">
        <div class="kpi-card__label">${k.label}</div>
        <div class="kpi-card__value">${k.value}</div>
      </div>`).join('');

    const monthly = yalcaGroupTransactionsByMonth(clientTx);
    const chartEl = document.getElementById('clientDetailChart');
    if (monthly.length === 0) {
      chartEl.innerHTML = '<p class="alert-empty">Este cliente ainda não tem lançamentos financeiros.</p>';
    } else {
      const last6 = monthly.slice(-6);
      yalcaRenderLineChart(chartEl, {
        series: [
          { name: 'Faturamento', color: YALCA_COLORS.series1, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })) },
          { name: 'Custo total', color: YALCA_COLORS.series2, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) }
        ],
        formatValue: (v) => yalcaFormatCurrency(v)
      });
    }

    const tbody = document.getElementById('clientDetailProducts');
    if (clientProducts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="alert-empty">Nenhum produto cadastrado.</td></tr>';
    } else {
      tbody.innerHTML = clientProducts.map(p => {
        const { marginPct } = yalcaProductMargin(p, settings);
        const marginClass = marginPct < 0 ? 'text-critical' : (marginPct < 15 ? '' : 'text-good');
        return `<tr>
          <td>${yalcaEscapeHtmlSafe(p.sku)}</td>
          <td>${yalcaEscapeHtmlSafe(p.name)}</td>
          <td>${yalcaEscapeHtmlSafe(p.marketplace)}</td>
          <td class="num">${yalcaFormatCurrency(p.price)}</td>
          <td class="num ${marginClass}">${marginPct.toFixed(1)}%</td>
          <td class="num">${p.stock}</td>
        </tr>`;
      }).join('');
    }

    openModal('clientDetailModal');
  } catch (err) {
    alert('Não foi possível carregar os detalhes: ' + err.message);
  }
}

/* ============================================================
   OBSERVAÇÕES INTERNAS
   ============================================================ */
function openNotes(userId) {
  const profile = CLIENTS.find(c => c.user_id === userId);
  if (!profile) return;
  document.getElementById('notesUserId').value = userId;
  document.getElementById('notesText').value = profile.admin_notes || '';
  openModal('notesModal');
}

async function saveNotes(e) {
  e.preventDefault();
  const userId = document.getElementById('notesUserId').value;
  const notes = document.getElementById('notesText').value;
  try {
    const { error } = await supabaseClient.from('client_profiles').update({ admin_notes: notes }).eq('user_id', userId);
    if (error) throw new Error(error.message);
    closeModal('notesModal');
    await loadClients();
  } catch (err) {
    alert('Não foi possível salvar a observação: ' + err.message);
  }
}

/* ============================================================
   EXCLUIR CLIENTE
   ============================================================ */
async function deleteClient(userId) {
  const profile = CLIENTS.find(c => c.user_id === userId);
  const label = profile ? (profile.store_name || profile.email) : 'este cliente';
  if (!confirm(`Excluir TODOS os dados de "${label}" (produtos, lançamentos, perfil)? Essa ação não pode ser desfeita.`)) return;
  if (!confirm(`Confirmando de novo: tem certeza que quer excluir "${label}" permanentemente?`)) return;

  try {
    await supabaseClient.from('products').delete().eq('user_id', userId);
    await supabaseClient.from('transactions').delete().eq('user_id', userId);
    await supabaseClient.from('planned_entries').delete().eq('user_id', userId);
    await supabaseClient.from('client_settings').delete().eq('user_id', userId);
    await supabaseClient.from('admins').delete().eq('user_id', userId);
    const { error } = await supabaseClient.from('client_profiles').delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
    alert('Dados excluídos. Observação: o login desse cliente ainda existe no Supabase (Authentication > Users) — para remover também o acesso por e-mail/senha, apague o usuário lá manualmente.');
    await loadClients();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}

/* ============================================================
   ADMINISTRADORES
   ============================================================ */
function renderAdminsPanel() {
  const tbody = document.getElementById('adminsTableBody');
  if (ADMINS.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="alert-empty">Nenhum administrador encontrado.</td></tr>';
  } else {
    tbody.innerHTML = ADMINS.map(a => {
      const profile = CLIENTS.find(c => c.user_id === a.user_id);
      const isSelf = a.user_id === CURRENT_USER_ID;
      return `<tr>
        <td>${profile ? yalcaEscapeHtmlSafe(profile.store_name) || '—' : '—'}</td>
        <td>${profile ? yalcaEscapeHtmlSafe(profile.email) : a.user_id}${isSelf ? ' (você)' : ''}</td>
        <td class="row-actions">
          <button class="icon-btn" title="Remover admin" data-action="removeAdmin" data-id="${a.user_id}">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }

  const select = document.getElementById('promoteAdminSelect');
  const adminIds = new Set(ADMINS.map(a => a.user_id));
  const candidates = CLIENTS.filter(c => !adminIds.has(c.user_id));
  select.innerHTML = candidates.length === 0
    ? '<option value="">Nenhum cliente disponível</option>'
    : candidates.map(c => `<option value="${c.user_id}">${yalcaEscapeHtmlSafe(c.store_name) || yalcaEscapeHtmlSafe(c.email)} — ${yalcaEscapeHtmlSafe(c.email)}</option>`).join('');
}

async function promoteSelectedAdmin() {
  const select = document.getElementById('promoteAdminSelect');
  const userId = select.value;
  if (!userId) return;
  const profile = CLIENTS.find(c => c.user_id === userId);
  if (!confirm(`Tornar "${profile ? profile.email : userId}" administrador? Ele passa a ver e gerenciar os dados de todos os clientes.`)) return;
  try {
    const { error } = await supabaseClient.from('admins').insert({ user_id: userId });
    if (error) throw new Error(error.message);
    await loadClients();
  } catch (err) {
    alert('Não foi possível promover: ' + err.message);
  }
}

async function removeAdmin(userId) {
  const isSelf = userId === CURRENT_USER_ID;
  const msg = isSelf
    ? 'Você está prestes a remover o SEU PRÓPRIO acesso de administrador. Se não houver outro admin, ninguém mais poderá gerenciar clientes por aqui. Continuar?'
    : 'Remover o acesso de administrador desta pessoa?';
  if (!confirm(msg)) return;
  try {
    const { error } = await supabaseClient.from('admins').delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
    await loadClients();
    if (isSelf) window.location.href = 'dashboard.html';
  } catch (err) {
    alert('Não foi possível remover: ' + err.message);
  }
}

/* ============================================================
   EXPORTAR CSV
   ============================================================ */
function exportClientsCsv() {
  const rows = [['loja', 'email', 'faturamento', 'lucro', 'margem_pct', 'produtos', 'cadastro', 'status']];
  CLIENTS.forEach(c => {
    const m = metricsFor(c.user_id);
    rows.push([c.store_name || '', c.email, m.receita.toFixed(2), m.lucro.toFixed(2), m.margem.toFixed(1), m.produtos, c.created_at, c.status]);
  });
  const csv = rows.map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'clientes-yalca.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function yalcaEscapeHtmlSafe(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
