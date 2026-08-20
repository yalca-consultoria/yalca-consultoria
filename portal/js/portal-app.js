/* =========================================
   Yalca Portal — lógica do painel do cliente
   Dados reais via Supabase (ver portal-data.js).
   ========================================= */

let DATA = null;
let YALCA_PROFILE = null;
let YALCA_IS_ADMIN = false;

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await yalcaRequireAuth();
  if (!authed) return;

  document.getElementById('pendingLogoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });
  document.getElementById('blockedLogoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  try {
    YALCA_IS_ADMIN = await yalcaIsAdmin();
    YALCA_PROFILE = await yalcaGetOwnProfile();
  } catch (err) {
    alert('Não foi possível verificar seu acesso: ' + err.message);
    return;
  }

  if (!YALCA_IS_ADMIN) {
    if (!YALCA_PROFILE) {
      alert('Não encontramos seu perfil de cliente. Fale com a Yalca para regularizar seu acesso.');
      await yalcaLogout();
      window.location.href = 'login.html';
      return;
    }
    if (YALCA_PROFILE.status === 'pending') {
      document.getElementById('pendingScreen').style.display = 'flex';
      return;
    }
    if (YALCA_PROFILE.status === 'blocked') {
      document.getElementById('blockedScreen').style.display = 'flex';
      return;
    }
  }

  document.getElementById('portalShell').style.display = 'flex';

  initSidebarNav();
  initModals();
  populateMarketplaceSelects();
  bindGlobalActions();
  initPricingCalculator();
  initKeepaSection();

  await reloadAndRenderAll();
});

async function reloadAndRenderAll() {
  try {
    const [data] = await Promise.all([
      yalcaFetchAll(YALCA_PROFILE),
      reloadKeepaData().catch(err => { console.error('Keepa:', err); }) // não trava o resto do painel se essa parte falhar
    ]);
    DATA = data;
    renderAll();
  } catch (err) {
    console.error(err);
    alert('Não foi possível carregar seus dados: ' + err.message);
  }
}

function renderAll() {
  renderClientName();
  renderOverview();
  renderFinanceiro();
  renderMarketplaces();
  renderEstoque();
  renderFluxoCaixa();
  recalcPricing();
  renderResetButtonLabel();
  renderSettingsForm();
  renderKeepaTracked();
  renderKeepaAlerts();
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function initSidebarNav() {
  const items = document.querySelectorAll('.portal-nav__item');
  const sections = document.querySelectorAll('.portal-section');
  const title = document.getElementById('sectionTitle');
  const sidebar = document.getElementById('portalSidebar');
  const scrim = document.getElementById('portalSidebarScrim');
  const toggle = document.getElementById('sidebarToggle');
  const main = document.querySelector('.portal-main');

  function isMobileDrawer() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function openSidebar() {
    sidebar.classList.add('is-open');
    scrim.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (isMobileDrawer()) main.setAttribute('aria-hidden', 'true');
    items[0].focus();
  }

  function closeSidebar({ returnFocus = false } = {}) {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    main.removeAttribute('aria-hidden');
    if (returnFocus) toggle.focus();
  }

  items.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.section;
      items.forEach(i => i.classList.toggle('is-active', i === item));
      sections.forEach(s => s.classList.toggle('is-active', s.dataset.section === target));
      title.textContent = item.querySelector('.portal-nav__label').textContent;
      if (isMobileDrawer()) closeSidebar();
    });
  });

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) closeSidebar({ returnFocus: true });
    else openSidebar();
  });

  scrim.addEventListener('click', () => closeSidebar({ returnFocus: true }));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sidebar.classList.contains('is-open') || !isMobileDrawer()) return;
    closeSidebar({ returnFocus: true });
  });

  // Foco preso dentro do menu enquanto ele estiver aberto no mobile.
  sidebar.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !isMobileDrawer() || !sidebar.classList.contains('is-open')) return;
    const focusable = sidebar.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
}

function bindGlobalActions() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  document.getElementById('resetDemoBtn').addEventListener('click', async () => {
    const isEmpty = DATA && DATA.products.length === 0 && DATA.transactions.length === 0;
    const msg = isEmpty
      ? 'Isso vai preencher sua conta com produtos e lançamentos de exemplo, só para você conhecer as ferramentas. Continuar?'
      : 'Isso vai apagar TODOS os seus produtos, lançamentos e lançamentos futuros atuais e substituir por dados de exemplo. Essa ação não pode ser desfeita. Continuar?';
    if (!confirm(msg)) return;
    try {
      if (!isEmpty) await yalcaClearAllData();
      await yalcaSeedDemoData();
      await reloadAndRenderAll();
    } catch (err) {
      alert('Não foi possível carregar os dados de exemplo: ' + err.message);
    }
  });
}

function renderResetButtonLabel() {
  const btn = document.getElementById('resetDemoBtn');
  const isEmpty = DATA.products.length === 0 && DATA.transactions.length === 0;
  btn.textContent = isEmpty ? '✨ Carregar dados de exemplo' : '↺ Substituir por dados de exemplo';
}

function renderClientName() {
  document.getElementById('clientNameLabel').textContent = DATA.settings.clientName;
}

/* ============================================================
   MODAIS (genérico)
   ============================================================ */
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

function populateMarketplaceSelects() {
  const selects = ['tMarketplace', 'prodMarketplace'];
  selects.forEach(selId => {
    const sel = document.getElementById(selId);
    MARKETPLACES.forEach(mk => {
      const opt = document.createElement('option');
      opt.value = mk;
      opt.textContent = mk;
      sel.appendChild(opt);
    });
  });
  const marketplaceFilter = document.getElementById('marketplaceFilter');
  const optAll = document.createElement('option');
  optAll.value = 'todos'; optAll.textContent = 'Todos os marketplaces';
  marketplaceFilter.appendChild(optAll);
  MARKETPLACES.forEach(mk => {
    const opt = document.createElement('option');
    opt.value = mk; opt.textContent = mk;
    marketplaceFilter.appendChild(opt);
  });
  marketplaceFilter.addEventListener('change', renderMarketplaces);

  document.getElementById('stockFilter').addEventListener('change', renderEstoque);
}

/* ============================================================
   VISÃO GERAL
   ============================================================ */
function renderOverview() {
  const monthly = yalcaGroupTransactionsByMonth(DATA.transactions);

  if (monthly.length === 0) {
    const stockAlerts = DATA.products.filter(p => ['Esgotado', 'Baixo'].includes(yalcaStockStatus(p)));
    renderKpiGrid('overviewKpis', [
      { label: 'Faturamento', value: yalcaFormatCurrency(0), delta: null, hint: 'nenhum lançamento ainda' },
      { label: 'Lucro líquido do mês', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Margem líquida', value: '—', delta: null },
      { label: 'Estoque em alerta', value: stockAlerts.length, delta: null, hint: 'produtos baixos ou esgotados' },
      { label: 'Saldo em caixa', value: yalcaFormatCurrency(DATA.settings.cashBalance), delta: null, hint: 'cadastre lançamentos para projetar' }
    ]);
    document.getElementById('overviewTrendChart').innerHTML = '<p class="alert-empty">Cadastre seus lançamentos em "Financeiro" (ou clique em "Carregar dados de exemplo" no menu lateral) para ver o gráfico aqui.</p>';
    renderOverviewAlerts();
    return;
  }

  const current = monthly[monthly.length - 1];
  const lucroAtual = current.receita - current.despesa;
  const margemAtual = current.receita > 0 ? (lucroAtual / current.receita) * 100 : 0;

  const stockAlerts = DATA.products.filter(p => ['Esgotado', 'Baixo'].includes(yalcaStockStatus(p)));
  const cashflow = computeCashflowProjection();
  const nextMonthBalance = cashflow.projection[0];

  const kpis = [
    { label: `Faturamento (${yalcaMonthLabel(current.key + '-01')})`, value: yalcaFormatCurrency(current.receita), delta: null, hint: 'mês em andamento — total parcial' },
    { label: 'Lucro líquido do mês', value: yalcaFormatCurrency(lucroAtual), delta: null, hint: `Margem de ${margemAtual.toFixed(1)}%` },
    { label: 'Margem líquida', value: `${margemAtual.toFixed(1)}%`, delta: null, hint: 'Receita menos todos os custos' },
    { label: 'Estoque em alerta', value: stockAlerts.length, delta: null, hint: 'produtos baixos ou esgotados' },
    { label: 'Saldo projetado (próx. mês)', value: yalcaFormatCurrency(nextMonthBalance.saldo), delta: null, hint: yalcaMonthLabel(nextMonthBalance.key + '-01') }
  ];
  renderKpiGrid('overviewKpis', kpis);

  const last6 = monthly.slice(-6);
  yalcaRenderLineChart(document.getElementById('overviewTrendChart'), {
    series: [
      { name: 'Faturamento', color: YALCA_COLORS.series1, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })) },
      { name: 'Custo total', color: YALCA_COLORS.series2, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) }
    ],
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  renderOverviewAlerts();
}

function renderOverviewAlerts() {
  const container = document.getElementById('overviewAlerts');
  const alerts = [];

  DATA.products.filter(p => yalcaStockStatus(p) === 'Esgotado').forEach(p => {
    alerts.push({ level: 'critical', icon: '⛔', title: `${p.name} está esgotado`, sub: `${p.marketplace} · SKU ${p.sku}` });
  });
  DATA.products.forEach(p => {
    const { marginPct } = yalcaProductMargin(p, DATA.settings);
    if (marginPct < 0) {
      alerts.push({ level: 'critical', icon: '📉', title: `${p.name} está sendo vendido no prejuízo`, sub: `Margem líquida estimada: ${marginPct.toFixed(1)}%` });
    }
  });
  DATA.products.filter(p => yalcaStockStatus(p) === 'Baixo').forEach(p => {
    alerts.push({ level: 'warning', icon: '⚠️', title: `Estoque baixo: ${p.name}`, sub: `Restam ${p.stock} unidades (mínimo recomendado: ${p.minStock})` });
  });

  renderAlertList(container, alerts.slice(0, 6));
}

function renderAlertList(container, alerts) {
  if (alerts.length === 0) {
    container.innerHTML = '<p class="alert-empty">Nenhum alerta no momento. Tudo sob controle. ✅</p>';
    return;
  }
  container.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.level}">
      <span class="alert-item__icon">${a.icon}</span>
      <div><strong>${yalcaEscapeHtml(a.title)}</strong><span>${yalcaEscapeHtml(a.sub)}</span></div>
    </div>`).join('');
}

function renderKpiGrid(containerId, kpis) {
  const el = document.getElementById(containerId);
  el.innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-card__label">${yalcaEscapeHtml(k.label)}</div>
      <div class="kpi-card__value">${k.value}</div>
      ${k.delta !== null ? `<div class="kpi-card__delta ${k.delta >= 0 ? 'up' : 'down'}">${k.delta >= 0 ? '▲' : '▼'} ${Math.abs(k.delta).toFixed(1)}%</div>` : ''}
      ${k.hint ? `<div class="kpi-card__hint">${yalcaEscapeHtml(k.hint)}</div>` : ''}
    </div>`).join('');
}

/* ============================================================
   FINANCEIRO
   ============================================================ */
function renderFinanceiro() {
  const monthly = yalcaGroupTransactionsByMonth(DATA.transactions);

  if (monthly.length === 0) {
    renderKpiGrid('financeKpis', [
      { label: 'Receita', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Despesa', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Lucro líquido', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Margem líquida', value: '—', delta: null }
    ]);
    document.getElementById('financeFilterMonth').innerHTML = '<option value="todos">Todos os meses</option>';
    document.getElementById('financeTrendChart').innerHTML = '<p class="alert-empty">Nenhum lançamento cadastrado ainda.</p>';
    document.getElementById('financeMarketplaceChart').innerHTML = '<p class="alert-empty">Nenhuma receita registrada ainda.</p>';
    renderTransactionsTable([]);
    return;
  }

  populateMonthFilter(monthly);

  const filterEl = document.getElementById('financeFilterMonth');
  const selectedKey = filterEl.value || 'todos';

  const filteredTx = selectedKey === 'todos'
    ? DATA.transactions
    : DATA.transactions.filter(t => t.date.startsWith(selectedKey));

  const receitaTotal = filteredTx.filter(t => t.type === 'receita').reduce((a, t) => a + Number(t.amount), 0);
  const despesaTotal = filteredTx.filter(t => t.type === 'despesa').reduce((a, t) => a + Number(t.amount), 0);
  const lucro = receitaTotal - despesaTotal;
  const margem = receitaTotal > 0 ? (lucro / receitaTotal) * 100 : 0;

  renderKpiGrid('financeKpis', [
    { label: 'Receita', value: yalcaFormatCurrency(receitaTotal), delta: null },
    { label: 'Despesa', value: yalcaFormatCurrency(despesaTotal), delta: null },
    { label: 'Lucro líquido', value: yalcaFormatCurrency(lucro), delta: null },
    { label: 'Margem líquida', value: `${margem.toFixed(1)}%`, delta: null }
  ]);

  const last6 = monthly.slice(-6);
  yalcaRenderLineChart(document.getElementById('financeTrendChart'), {
    series: [
      { name: 'Receita', color: YALCA_COLORS.series1, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })) },
      { name: 'Despesa', color: YALCA_COLORS.series2, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) }
    ],
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  const marketplaceKey = selectedKey === 'todos' ? monthly[monthly.length - 1].key : selectedKey;
  const revenueByMarketplace = MARKETPLACES
    .map(mk => ({
      label: mk,
      value: DATA.transactions.filter(t => t.type === 'receita' && t.marketplace === mk && t.date.startsWith(marketplaceKey)).reduce((a, t) => a + Number(t.amount), 0),
      color: YALCA_MARKETPLACE_COLOR[mk]
    }))
    .filter(d => d.value > 0);

  if (revenueByMarketplace.length > 0) {
    yalcaRenderBarChart(document.getElementById('financeMarketplaceChart'), {
      data: revenueByMarketplace,
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  } else {
    document.getElementById('financeMarketplaceChart').innerHTML = '<p class="alert-empty">Sem receita registrada nesse período.</p>';
  }

  const categoryTotals = new Map();
  filteredTx.filter(t => t.type === 'despesa').forEach(t => {
    categoryTotals.set(t.category, (categoryTotals.get(t.category) || 0) + Number(t.amount));
  });
  const categoryData = [...categoryTotals.entries()]
    .map(([label, value]) => ({ label, value, color: YALCA_COLORS.series2 }))
    .sort((a, b) => b.value - a.value);

  if (categoryData.length > 0) {
    yalcaRenderBarChart(document.getElementById('financeCategoryChart'), {
      data: categoryData,
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  } else {
    document.getElementById('financeCategoryChart').innerHTML = '<p class="alert-empty">Sem despesas registradas nesse período.</p>';
  }

  renderTransactionsTable(filteredTx);
}

function populateMonthFilter(monthly) {
  const sel = document.getElementById('financeFilterMonth');
  const current = sel.value;
  sel.innerHTML = '<option value="todos">Todos os meses</option>' +
    monthly.map(m => `<option value="${m.key}">${yalcaMonthLabel(m.key + '-01')}</option>`).join('');
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  else sel.value = monthly[monthly.length - 1].key;
  sel.onchange = renderFinanceiro;
}

function renderTransactionsTable(transactions) {
  const tbody = document.getElementById('transactionsTableBody');
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="alert-empty">Nenhum lançamento neste período.</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(t => `
    <tr>
      <td data-label="Data">${yalcaFormatDate(t.date)}</td>
      <td data-label="Tipo">${t.type === 'receita' ? '<span class="badge badge--receita">Receita</span>' : '<span class="badge badge--despesa">Despesa</span>'}</td>
      <td data-label="Categoria">${yalcaEscapeHtml(t.category)}</td>
      <td data-label="Marketplace">${yalcaEscapeHtml(t.marketplace)}</td>
      <td data-label="Descrição">${yalcaEscapeHtml(t.description)}</td>
      <td class="num ${t.type === 'receita' ? 'text-good' : 'text-critical'}" data-label="Valor">${t.type === 'receita' ? '+' : '-'} ${yalcaFormatCurrency(t.amount)}</td>
      <td class="row-actions">
        <button class="icon-btn" title="Editar" data-action="editTransaction" data-id="${t.id}">✎</button>
        <button class="icon-btn" title="Excluir" data-action="deleteTransactionRow" data-id="${t.id}">🗑</button>
      </td>
    </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('transactionsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'editTransaction') editTransaction(id);
    else if (action === 'deleteTransactionRow') deleteTransactionRow(id);
  });

  document.getElementById('addTransactionBtn').addEventListener('click', () => {
    document.getElementById('transactionForm').reset();
    document.getElementById('tId').value = '';
    document.getElementById('transactionModalTitle').textContent = 'Novo lançamento';
    document.getElementById('tDate').value = new Date().toISOString().slice(0, 10);
    openModal('transactionModal');
  });

  document.getElementById('transactionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const id = document.getElementById('tId').value;
    const record = {
      date: document.getElementById('tDate').value,
      type: document.getElementById('tType').value,
      category: document.getElementById('tCategory').value,
      marketplace: document.getElementById('tMarketplace').value,
      description: document.getElementById('tDescription').value,
      amount: parseFloat(document.getElementById('tAmount').value) || 0
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      if (id) await yalcaUpdateTransaction(id, record);
      else await yalcaAddTransaction(record);
      closeModal('transactionModal');
      await reloadAndRenderAll();
    } catch (err) {
      alert('Não foi possível salvar o lançamento: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportTransactionsCsv);
  document.getElementById('importCsvInput').addEventListener('change', importTransactionsCsv);
});

function editTransaction(id) {
  const t = DATA.transactions.find(x => x.id === id);
  if (!t) return;
  document.getElementById('tId').value = t.id;
  document.getElementById('tDate').value = t.date;
  document.getElementById('tType').value = t.type;
  document.getElementById('tCategory').value = t.category;
  document.getElementById('tMarketplace').value = t.marketplace;
  document.getElementById('tDescription').value = t.description;
  document.getElementById('tAmount').value = t.amount;
  document.getElementById('transactionModalTitle').textContent = 'Editar lançamento';
  openModal('transactionModal');
}

async function deleteTransactionRow(id) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    await yalcaDeleteTransaction(id);
    await reloadAndRenderAll();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}

function exportTransactionsCsv() {
  const rows = [['data', 'tipo', 'categoria', 'marketplace', 'descricao', 'valor']];
  DATA.transactions.forEach(t => rows.push([t.date, t.type, t.category, t.marketplace, t.description, t.amount]));
  const csv = rows.map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lancamentos-yalca.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function importTransactionsCsv(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const lines = String(reader.result).split(/\r?\n/).filter(l => l.trim().length > 0);
    const dataLines = lines.slice(1); // ignora cabeçalho
    const records = [];
    dataLines.forEach(line => {
      const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g);
      if (!cols || cols.length < 6) return;
      const clean = cols.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const [date, type, category, marketplace, description, amount] = clean;
      if (!date || !['receita', 'despesa'].includes(type)) return;
      records.push({
        date, type, category: category || 'Outros',
        marketplace: marketplace || '-', description: description || '', amount: parseFloat(amount) || 0
      });
    });
    try {
      for (const record of records) {
        await yalcaAddTransaction(record);
      }
      await reloadAndRenderAll();
      alert(`${records.length} lançamento(s) importado(s) com sucesso.`);
    } catch (err) {
      alert('Erro ao importar CSV: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

/* ============================================================
   GESTÃO DE MARKETPLACES (produtos / SKUs)
   ============================================================ */
function renderMarketplaces() {
  const filter = document.getElementById('marketplaceFilter').value || 'todos';
  const products = filter === 'todos' ? DATA.products : DATA.products.filter(p => p.marketplace === filter);

  const margins = products.map(p => yalcaProductMargin(p, DATA.settings).marginPct);
  const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const negativeCount = products.filter(p => yalcaProductMargin(p, DATA.settings).marginPct < 0).length;
  const totalUnits = products.reduce((a, p) => a + p.unitsSoldMonth, 0);

  renderKpiGrid('marketplaceKpis', [
    { label: 'Produtos cadastrados', value: products.length, delta: null },
    { label: 'Unidades vendidas/mês', value: totalUnits, delta: null },
    { label: 'Margem média da carteira', value: `${avgMargin.toFixed(1)}%`, delta: null },
    { label: 'Produtos no prejuízo', value: negativeCount, delta: null, hint: negativeCount > 0 ? 'revise o preço desses itens' : 'nenhum item no prejuízo' }
  ]);

  const marginByMarketplace = MARKETPLACES
    .map(mk => {
      const mkProducts = DATA.products.filter(p => p.marketplace === mk);
      if (mkProducts.length === 0) return null;
      const avg = mkProducts.reduce((a, p) => a + yalcaProductMargin(p, DATA.settings).marginPct, 0) / mkProducts.length;
      return { label: mk, value: Number(avg.toFixed(1)), color: YALCA_MARKETPLACE_COLOR[mk] };
    })
    .filter(Boolean);

  if (marginByMarketplace.length > 0) {
    yalcaRenderBarChart(document.getElementById('marketplaceMarginChart'), {
      data: marginByMarketplace,
      formatValue: (v) => `${v}%`
    });
  } else {
    document.getElementById('marketplaceMarginChart').innerHTML = '<p class="alert-empty">Cadastre produtos para ver a margem média por marketplace.</p>';
  }

  const tbody = document.getElementById('productsTableBody');
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="alert-empty">Nenhum produto cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(p => {
    const { marginPct } = yalcaProductMargin(p, DATA.settings);
    const marginClass = marginPct < 0 ? 'text-critical' : (marginPct < 15 ? '' : 'text-good');
    const gaugeColor = marginPct < 0 ? 'var(--critical)' : (marginPct < 15 ? 'var(--warning)' : 'var(--good)');
    const gaugeWidth = Math.max(0, Math.min(100, marginPct));
    return `
    <tr>
      <td data-label="SKU">${yalcaEscapeHtml(p.sku)}</td>
      <td data-label="Produto">${yalcaEscapeHtml(p.name)}</td>
      <td data-label="Marketplace"><div class="marketplace-cell">${renderChannelBadge(p.marketplace)}<div class="marketplace-cell__text"><strong>${yalcaEscapeHtml(p.marketplace)}</strong></div></div></td>
      <td class="num" data-label="Custo">${yalcaFormatCurrency(p.cost)}</td>
      <td class="num" data-label="Preço">${yalcaFormatCurrency(p.price)}</td>
      <td class="num ${marginClass}" data-label="Margem líquida">
        ${marginPct.toFixed(1)}%
        <div class="margin-gauge margin-gauge--sm"><div class="margin-gauge__fill" style="width:${gaugeWidth}%; background:${gaugeColor};"></div></div>
      </td>
      <td class="num" data-label="Vendidos/mês">${p.unitsSoldMonth}</td>
      <td data-label="Status">${p.status === 'Ativo' ? '<span class="badge badge--ativo">Ativo</span>' : '<span class="badge badge--pausado">Pausado</span>'}</td>
      <td class="row-actions">
        <button class="icon-btn" title="Editar" data-action="editProduct" data-id="${p.id}">✎</button>
        <button class="icon-btn" title="Excluir" data-action="deleteProductRow" data-id="${p.id}">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('productsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'editProduct') editProduct(id);
    else if (action === 'deleteProductRow') deleteProductRow(id);
  });

  document.getElementById('addProductBtn').addEventListener('click', () => {
    document.getElementById('productForm').reset();
    document.getElementById('prodId').value = '';
    document.getElementById('productModalTitle').textContent = 'Novo produto';
    openModal('productModal');
  });

  document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const id = document.getElementById('prodId').value;
    const record = {
      sku: document.getElementById('prodSku').value,
      name: document.getElementById('prodName').value,
      marketplace: document.getElementById('prodMarketplace').value,
      category: document.getElementById('prodCategory').value,
      cost: parseFloat(document.getElementById('prodCost').value) || 0,
      price: parseFloat(document.getElementById('prodPrice').value) || 0,
      stock: parseInt(document.getElementById('prodStock').value, 10) || 0,
      minStock: parseInt(document.getElementById('prodMinStock').value, 10) || 0,
      unitsSoldMonth: parseInt(document.getElementById('prodSoldMonth').value, 10) || 0,
      status: document.getElementById('prodStatus').value
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      if (id) await yalcaUpdateProduct(id, record);
      else await yalcaAddProduct(record);
      closeModal('productModal');
      await reloadAndRenderAll();
    } catch (err) {
      alert('Não foi possível salvar o produto: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });
});

function editProduct(id) {
  const p = DATA.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prodId').value = p.id;
  document.getElementById('prodSku').value = p.sku;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodMarketplace').value = p.marketplace;
  document.getElementById('prodCategory').value = p.category;
  document.getElementById('prodCost').value = p.cost;
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodStock').value = p.stock;
  document.getElementById('prodMinStock').value = p.minStock;
  document.getElementById('prodSoldMonth').value = p.unitsSoldMonth;
  document.getElementById('prodStatus').value = p.status;
  document.getElementById('productModalTitle').textContent = 'Editar produto';
  openModal('productModal');
}

async function deleteProductRow(id) {
  if (!confirm('Excluir este produto?')) return;
  try {
    await yalcaDeleteProduct(id);
    await reloadAndRenderAll();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}

/* ============================================================
   CALCULADORA DE PRECIFICAÇÃO
   Cada variante tem "brackets": faixas de preço com comissão (%)
   e taxa fixa PRÓPRIAS de cada faixa — modelo necessário porque
   marketplaces reais (ex: TikTok Shop) cobram % diferente conforme
   o preço, não só uma taxa fixa adicional.

   Fontes: páginas oficiais dos vendedores quando acessíveis
   (venda.amazon.com.br/precos foi possível abrir direto). Onde o
   acesso automático foi bloqueado (Mercado Livre bloqueia todo
   acesso automatizado; Shopee e TikTok carregam a Central do
   Vendedor via login/JavaScript; Temu é só por convite), usamos a
   melhor fonte especializada disponível e marcamos "verified: false"
   — visível no editor de taxas com um aviso e link para conferir na
   fonte oficial. Revisado em 21/07/2026.
   ============================================================ */

const PRICING_VARIANTS_DEFAULT = [
  {
    key: 'ml_classico', label: 'Mercado Livre — Clássico', channel: 'Mercado Livre', planLabel: 'Clássico',
    brackets: [
      { maxPrice: 20, pct: 12.5, fixedFee: 5.50 },
      { maxPrice: 78.99, pct: 12.5, fixedFee: 6.00 },
      { maxPrice: Infinity, pct: 12.5, fixedFee: 0 }
    ],
    sourceUrl: 'https://www.mercadolivre.com.br/ajuda/quanto-custa-vender-um-produto_1338',
    verified: false,
    note: 'Comissão típica de 11% a 14% por categoria (usamos 12,5% de média). Itens até R$20 pagam R$5,50 de taxa fixa por unidade; de R$20,01 a R$78,99, R$6,00; acima de R$79, sem taxa fixa. O Mercado Livre bloqueia acesso automático à própria página de ajuda, então não conseguimos confirmar ao vivo — confirme a % exata da sua categoria na Central do Vendedor.'
  },
  {
    key: 'ml_premium', label: 'Mercado Livre — Premium', channel: 'Mercado Livre', planLabel: 'Premium',
    brackets: [
      { maxPrice: 20, pct: 17.5, fixedFee: 5.50 },
      { maxPrice: 78.99, pct: 17.5, fixedFee: 6.00 },
      { maxPrice: Infinity, pct: 17.5, fixedFee: 0 }
    ],
    sourceUrl: 'https://www.mercadolivre.com.br/ajuda/quanto-custa-vender-um-produto_1338',
    verified: false,
    note: 'Comissão típica de 16% a 19% por categoria (usamos 17,5% de média) — mais alta que o Clássico, mas com parcelamento sem juros ao comprador. Mesmas faixas de taxa fixa do Clássico. Confirme a % exata da sua categoria na Central do Vendedor.'
  },
  {
    key: 'amazon_fbm', label: 'Amazon — FBM (frete próprio)', channel: 'Amazon', planLabel: 'FBM (frete próprio)',
    brackets: [{ maxPrice: Infinity, pct: 13, fixedFee: 0 }],
    sourceUrl: 'https://venda.amazon.com.br/precos',
    verified: true,
    note: 'Comissão por categoria de 10% a 15% (ex: alimentos 10%, saúde 12%, roupas/joias 14%, eletrônicos/livros 13-15%) — usamos 13% de média. Existe comissão mínima de R$1 a R$2 por venda (só pesa em produtos muito baratos, não incluída no cálculo). Some seu frete real no campo "Frete" acima. Também há mensalidade do plano de venda: Profissional é grátis no 1º ano e depois R$19/mês, ou R$2,00 por unidade no plano Individual sem mensalidade — não incluída aqui.'
  },
  {
    key: 'amazon_fba', label: 'Amazon — FBA (logística Amazon)', channel: 'Amazon', planLabel: 'FBA (logística Amazon)',
    brackets: [
      { maxPrice: 29.99, pct: 13, fixedFee: 10.05 },
      { maxPrice: 49.99, pct: 13, fixedFee: 12.05 },
      { maxPrice: 78.99, pct: 13, fixedFee: 14.05 },
      { maxPrice: 99.99, pct: 13, fixedFee: 15.05 },
      { maxPrice: Infinity, pct: 13, fixedFee: 15.55 }
    ],
    sourceUrl: 'https://venda.amazon.com.br/precos',
    verified: true,
    note: 'Mesma comissão por categoria do FBM (13% de média) + taxa de logística FBA para produtos leves (até 100g): R$10,05 até R$29,99; R$12,05 de R$30 a R$49,99; R$14,05 de R$50 a R$78,99; R$15,05 de R$79 a R$99,99; R$15,55 acima de R$100 (a taxa NÃO zera acima de R$100 — corrigimos isso aqui). Produtos mais pesados pagam mais: use a calculadora oficial de FBA da Amazon para o valor exato do seu produto. Não inclui taxa de armazenagem mensal.'
  },
  {
    key: 'shopee', label: 'Shopee', channel: 'Shopee', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 14, fixedFee: 4.00 }],
    sourceUrl: 'https://seller.shopee.com.br/edu/article/18483/como-funciona-a-politica-de-comissao-para-vendedores-shopee',
    verified: false,
    note: 'A Central do Vendedor da Shopee exige login e carrega por JavaScript — não conseguimos confirmar a comissão exata direto na página oficial. Fontes especializadas citam ~14% + taxa fixa que cresce com o preço (usamos R$4 como referência). Vendedores CPF com mais de 450 pedidos em 90 dias pagam +R$3,00 por item. Confirme no seu painel.'
  },
  {
    key: 'tiktok', label: 'TikTok Shop', channel: 'TikTok', planLabel: '',
    brackets: [
      { maxPrice: 49.99, pct: 10, fixedFee: 0 },
      { maxPrice: Infinity, pct: 6, fixedFee: 6.00 }
    ],
    sourceUrl: 'https://seller-br.tiktok.com/',
    verified: false,
    note: 'Mudança de 15/07/2026: produtos abaixo de R$50 pagam 10% de comissão; a partir de R$50, 6% + R$6,00 de taxa fixa por item (subiu de R$4,00). Novos vendedores ficam isentos de comissão por 60 dias. Não conseguimos abrir a Central do Vendedor diretamente (login/JavaScript) — dado de fonte especializada que cita o painel oficial. Confirme no seu painel.'
  },
  {
    key: 'temu', label: 'Temu', channel: 'Temu', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 16, fixedFee: 0 }],
    sourceUrl: 'https://seller.temu.com',
    verified: false,
    note: 'O painel de vendedor da Temu é só por convite e não tem página pública de taxas. Fontes especializadas citam isenção de comissão nos primeiros 30 dias e 16% depois. Ajuste conforme o combinado no seu cadastro.'
  },
  {
    key: 'droga_raia', label: 'Droga Raia', channel: 'Droga Raia', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 0, fixedFee: 0 }],
    sourceUrl: null,
    verified: false,
    note: 'Não é um marketplace de comissão padrão como os demais — não existe uma "taxa oficial" pública. Ajuste aqui a % ou taxa fixa do seu acordo comercial (revenda, consignação, marketplace de parceiros etc).'
  }
];

/* Selo por canal: logo real (imagem já usada no site principal) quando temos
   um asset legítimo e sourced; iniciais coloridas como fallback automático
   para qualquer canal sem logo (ex: Temu, Droga Raia — este último nem é um
   marketplace de comissão padrão, é um acordo comercial customizado, então
   nunca faria sentido "inventar" um logo genérico pra ele). */
const CHANNEL_VISUALS = {
  'Mercado Livre': { initials: 'ML', bg: '#FFE600', color: '#1c1c1c', logo: 'mercadolivre.svg' },
  'Amazon': { initials: 'AZ', bg: '#131921', color: '#FF9900', logo: 'amazon.svg' },
  'Shopee': { initials: 'SP', bg: '#EE4D2D', color: '#ffffff', logo: 'shopee.svg' },
  'TikTok': { initials: 'TT', bg: '#010101', color: '#25F4EE', logo: 'tiktok.svg' },
  'Temu': { initials: 'TM', bg: '#FB6514', color: '#ffffff' },
  'Droga Raia': { initials: 'DR', bg: '#00A650', color: '#ffffff' }
};

function renderChannelBadge(channel) {
  const v = CHANNEL_VISUALS[channel] || { initials: channel.slice(0, 2).toUpperCase(), bg: 'var(--surface-2)', color: 'var(--text)' };
  if (v.logo) {
    return `<span class="marketplace-cell__logo" title="${yalcaEscapeHtml(channel)}"><img src="../img/marketplaces/${v.logo}" alt="${yalcaEscapeHtml(channel)}" loading="lazy"></span>`;
  }
  return `<span class="marketplace-cell__logo" style="background:${v.bg}; color:${v.color};" title="${yalcaEscapeHtml(channel)}">${v.initials}</span>`;
}

let PRICING_VARIANTS = [];
let FOCUSED_VARIANT_KEY = null;

function clonePricingVariants() {
  return PRICING_VARIANTS_DEFAULT.map(v => ({ ...v, brackets: v.brackets.map(b => ({ ...b })) }));
}

function pricingBracketRangeLabel(brackets, index) {
  const min = index === 0 ? 0 : brackets[index - 1].maxPrice;
  const b = brackets[index];
  if (b.maxPrice === Infinity) return `Acima de ${yalcaFormatCurrency(min)}`;
  return index === 0 ? `Até ${yalcaFormatCurrency(b.maxPrice)}` : `${yalcaFormatCurrency(min)} a ${yalcaFormatCurrency(b.maxPrice)}`;
}

function initPricingCalculator() {
  PRICING_VARIANTS = clonePricingVariants();

  ['pCost', 'pShipping', 'pTax', 'pMargin', 'pManualPrice'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcPricing);
  });

  document.getElementById('toggleFeeEditor').addEventListener('click', (e) => {
    const editor = document.getElementById('feeEditor');
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    e.target.textContent = showing ? '⚙ Ajustar taxas dos marketplaces' : '⚙ Ocultar ajuste de taxas';
  });

  document.getElementById('pricingComparisonBody').addEventListener('click', (e) => {
    const saveBtn = e.target.closest('[data-action="openSaveAsProduct"]');
    if (saveBtn) {
      openSaveAsProduct(saveBtn.dataset.channel, parseFloat(saveBtn.dataset.price), parseFloat(saveBtn.dataset.cost));
      return;
    }
    const row = e.target.closest('[data-action="selectVariantForDetail"]');
    if (row) selectVariantForDetail(row.dataset.key);
  });

  renderFeeEditor();
}

function renderFeeEditor() {
  const editor = document.getElementById('feeEditor');
  editor.innerHTML = PRICING_VARIANTS.map(v => {
    const bracketInputs = v.brackets.map((b, i) => `
      <div><label>${pricingBracketRangeLabel(v.brackets, i)} — comissão (%)</label><input type="number" min="0" step="0.1" value="${b.pct}" data-field="pct" data-bracket-index="${i}"></div>
      <div><label>Taxa fixa nessa faixa (R$)</label><input type="number" min="0" step="0.01" value="${b.fixedFee || 0}" data-field="fixedFee" data-bracket-index="${i}"></div>
    `).join('');
    const sourceHtml = v.sourceUrl
      ? `<a href="${v.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent); font-size:0.76rem; display:inline-block; margin-top:6px;">Ver fonte oficial ↗</a>`
      : '';
    const verifiedBadge = v.verified
      ? '<span class="badge badge--ativo">✔ Confirmado na fonte oficial</span>'
      : '<span class="badge badge--pending">⚠ Não confirmado ao vivo</span>';
    return `
    <div class="fee-editor-row" data-key="${v.key}">
      <div class="fee-editor-row__title">${yalcaEscapeHtml(v.channel)}${v.planLabel ? ' — ' + yalcaEscapeHtml(v.planLabel) : ''} ${verifiedBadge}</div>
      <div class="fee-editor-row__fields">${bracketInputs}</div>
      <div class="fee-editor-row__note">${yalcaEscapeHtml(v.note)}${sourceHtml}</div>
    </div>`;
  }).join('') + `<button type="button" class="table-view-toggle" id="resetFeeEditor">Restaurar valores padrão</button>`;

  editor.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.closest('.fee-editor-row').dataset.key;
      const variant = PRICING_VARIANTS.find(v => v.key === key);
      const idx = Number(input.dataset.bracketIndex);
      const field = input.dataset.field;
      variant.brackets[idx][field] = parseFloat(input.value) || 0;
      recalcPricing();
    });
  });

  document.getElementById('resetFeeEditor').addEventListener('click', () => {
    PRICING_VARIANTS = clonePricingVariants();
    renderFeeEditor();
    recalcPricing();
  });
}

function getBracketFor(variant, price) {
  return variant.brackets.find(b => price <= b.maxPrice) || variant.brackets[variant.brackets.length - 1];
}

function feeForPrice(variant, price) {
  const b = getBracketFor(variant, price);
  return price * (b.pct / 100) + (b.fixedFee || 0);
}

function solveForwardPrice(variant, cost, shipping, tax, marginDesired) {
  let prevMax = 0;
  for (const b of variant.brackets) {
    const denom = 1 - (b.pct + tax + marginDesired) / 100;
    if (denom > 0) {
      const price = (cost + shipping + (b.fixedFee || 0)) / denom;
      if (price > prevMax && price <= b.maxPrice) return price;
    }
    prevMax = b.maxPrice;
  }
  // Nenhuma faixa foi auto-consistente (raro) — usa a última faixa como aproximação.
  const last = variant.brackets[variant.brackets.length - 1];
  const denom = 1 - (last.pct + tax + marginDesired) / 100;
  if (denom <= 0) return null;
  return (cost + shipping + (last.fixedFee || 0)) / denom;
}

function calcPricingVariant(variant, inputs) {
  const { cost, shipping, tax, marginDesired, manualPrice } = inputs;

  const computeBreakdown = (price) => {
    const feeValue = feeForPrice(variant, price);
    const taxValue = price * (tax / 100);
    const netProfit = price - cost - shipping - feeValue - taxValue;
    const marginPct = price > 0 ? (netProfit / price) * 100 : 0;
    return {
      key: variant.key, label: variant.label, channel: variant.channel, planLabel: variant.planLabel,
      verified: variant.verified, sourceUrl: variant.sourceUrl,
      price, feeValue, taxValue, netProfit, marginPct
    };
  };

  if (manualPrice !== null && manualPrice > 0) {
    return { mode: 'reverse', ...computeBreakdown(manualPrice) };
  }

  const price = solveForwardPrice(variant, cost, shipping, tax, marginDesired);
  if (price === null) return { mode: 'invalid', key: variant.key, label: variant.label };
  return { mode: 'forward', ...computeBreakdown(price) };
}

function recalcPricing() {
  const comparisonBody = document.getElementById('pricingComparisonBody');
  if (!comparisonBody) return;

  const cost = parseFloat(document.getElementById('pCost').value) || 0;
  const shipping = parseFloat(document.getElementById('pShipping').value) || 0;
  const tax = parseFloat(document.getElementById('pTax').value) || 0;
  const marginDesired = parseFloat(document.getElementById('pMargin').value) || 0;
  const manualPriceRaw = document.getElementById('pManualPrice').value;
  const manualPrice = manualPriceRaw !== '' ? parseFloat(manualPriceRaw) : null;

  const inputs = { cost, shipping, tax, marginDesired, manualPrice };
  const results = PRICING_VARIANTS.map(v => calcPricingVariant(v, inputs));
  const validResults = results.filter(r => r.mode !== 'invalid');

  if (validResults.length === 0) {
    comparisonBody.innerHTML = '<tr><td colspan="5" class="alert-empty" style="color:var(--critical);">A soma de taxa, imposto e margem desejada ultrapassa 100% em todas as opções. Reduza algum valor.</td></tr>';
    document.getElementById('pricingWaterfall').innerHTML = '';
    document.getElementById('pricingBreakdown').innerHTML = '';
    return;
  }

  const bestMarginValue = Math.max(...validResults.map(r => r.marginPct));
  const bestKeyOnBestMargin = validResults.find(r => r.marginPct === bestMarginValue)?.key;
  const sorted = [...validResults].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  if (!FOCUSED_VARIANT_KEY || !validResults.some(r => r.key === FOCUSED_VARIANT_KEY)) {
    FOCUSED_VARIANT_KEY = bestKeyOnBestMargin;
  }

  comparisonBody.innerHTML = sorted.map(r => {
    const isBest = r.key === bestKeyOnBestMargin;
    const isSelected = r.key === FOCUSED_VARIANT_KEY;
    const marginClass = r.marginPct < 0 ? 'text-critical' : (r.marginPct < 15 ? '' : 'text-good');
    return `
    <tr class="${isSelected ? 'comparison-row--selected' : ''}" style="cursor:pointer;" data-action="selectVariantForDetail" data-key="${r.key}">
      <td>
        <div class="marketplace-cell">
          ${renderChannelBadge(r.channel)}
          <div class="marketplace-cell__text">
            <strong>${yalcaEscapeHtml(r.channel)}${!r.verified ? ' <span title="Taxa não confirmada ao vivo na fonte oficial — veja a nota em Ajustar taxas" style="color:var(--warning); cursor:help;">⚠</span>' : ''}</strong>
            ${r.planLabel ? `<span class="marketplace-cell__plan">${yalcaEscapeHtml(r.planLabel)}</span>` : ''}
            ${isBest ? '<span class="best-tag">Melhor margem</span>' : ''}
          </div>
        </div>
      </td>
      <td class="num">${yalcaFormatCurrency(r.price)}</td>
      <td class="num ${r.netProfit < 0 ? 'text-critical' : ''}">${yalcaFormatCurrency(r.netProfit)}</td>
      <td class="num ${marginClass}">${r.marginPct.toFixed(1)}%</td>
      <td class="row-actions">
        <button class="icon-btn" title="Salvar como produto" data-action="openSaveAsProduct" data-channel="${yalcaEscapeHtml(r.channel)}" data-price="${r.price.toFixed(2)}" data-cost="${cost}">＋</button>
      </td>
    </tr>`;
  }).join('');

  renderPricingDetail(results.find(r => r.key === FOCUSED_VARIANT_KEY), inputs);
}

function selectVariantForDetail(key) {
  FOCUSED_VARIANT_KEY = key;
  recalcPricing();
}

function renderPricingDetail(result, inputs) {
  document.getElementById('pricingDetailTitle').textContent = `Detalhamento — ${result.label}`;

  if (result.mode === 'invalid') {
    document.getElementById('pricingDetailConfidence').innerHTML = '';
    document.getElementById('pricingWaterfall').innerHTML = '<p class="alert-empty" style="color:var(--critical);">Configuração impossível para esta opção (taxa + imposto + margem desejada ultrapassa 100%).</p>';
    document.getElementById('pricingBreakdown').innerHTML = '';
    return;
  }

  const confidenceHtml = result.verified
    ? '<span class="badge badge--ativo">✔ Confirmado na fonte oficial</span>'
    : `<span class="badge badge--pending">⚠ Não confirmado ao vivo na fonte oficial</span>${result.sourceUrl ? ` <a href="${result.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent); font-size:0.8rem;">conferir fonte ↗</a>` : ''}`;
  document.getElementById('pricingDetailConfidence').innerHTML = confidenceHtml;

  const segments = [
    { label: 'Custo do produto', value: inputs.cost, color: YALCA_WATERFALL_COLORS.custo },
    { label: 'Frete', value: inputs.shipping, color: YALCA_WATERFALL_COLORS.frete },
    { label: 'Taxa do marketplace', value: result.feeValue, color: YALCA_WATERFALL_COLORS.taxa },
    { label: 'Imposto', value: result.taxValue, color: YALCA_WATERFALL_COLORS.imposto },
    { label: 'Lucro líquido', value: Math.max(result.netProfit, 0), color: YALCA_WATERFALL_COLORS.lucro }
  ];
  yalcaRenderWaterfallBar(document.getElementById('pricingWaterfall'), {
    segments,
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  const gaugeColor = result.marginPct < 0 ? 'var(--critical)' : (result.marginPct < 15 ? 'var(--warning)' : 'var(--good)');
  document.getElementById('pricingBreakdown').innerHTML = `
    <div class="calc-result__row"><span>Custo do produto</span><strong>${yalcaFormatCurrency(inputs.cost)}</strong></div>
    <div class="calc-result__row"><span>Frete</span><strong>${yalcaFormatCurrency(inputs.shipping)}</strong></div>
    <div class="calc-result__row"><span>Taxa do marketplace</span><strong>${yalcaFormatCurrency(result.feeValue)}</strong></div>
    <div class="calc-result__row"><span>Imposto</span><strong>${yalcaFormatCurrency(result.taxValue)}</strong></div>
    <div class="calc-result__row"><span>Lucro líquido</span><strong style="color:${gaugeColor};">${yalcaFormatCurrency(result.netProfit)}</strong></div>
    <div class="calc-result__row total"><span>Preço de venda${result.mode === 'reverse' ? ' (informado)' : ' sugerido'}</span><strong>${yalcaFormatCurrency(result.price)}</strong></div>
    <div class="calc-result__row"><span>Margem líquida</span><strong style="color:${gaugeColor};">${result.marginPct.toFixed(1)}%</strong></div>`;
}

function openSaveAsProduct(marketplace, price, cost) {
  document.getElementById('productForm').reset();
  document.getElementById('prodId').value = '';
  document.getElementById('productModalTitle').textContent = 'Novo produto (da calculadora)';
  document.getElementById('prodMarketplace').value = marketplace;
  document.getElementById('prodCost').value = cost;
  document.getElementById('prodPrice').value = price;
  document.getElementById('prodStatus').value = 'Ativo';
  openModal('productModal');
}

/* ============================================================
   CONTROLE DE ESTOQUE
   ============================================================ */
function renderEstoque() {
  const filter = document.getElementById('stockFilter').value || 'todos';
  const withStatus = DATA.products.map(p => ({ ...p, status_calc: yalcaStockStatus(p) }));
  const filtered = filter === 'todos' ? withStatus : withStatus.filter(p => p.status_calc === filter);

  const esgotado = withStatus.filter(p => p.status_calc === 'Esgotado').length;
  const baixo = withStatus.filter(p => p.status_calc === 'Baixo').length;
  const parado = withStatus.filter(p => p.status_calc === 'Parado');
  const valorParado = parado.reduce((a, p) => a + p.cost * p.stock, 0);

  renderKpiGrid('stockKpis', [
    { label: 'Esgotados', value: esgotado, delta: null },
    { label: 'Estoque baixo', value: baixo, delta: null },
    { label: 'Estoque parado', value: parado.length, delta: null },
    { label: 'Capital parado em estoque', value: yalcaFormatCurrency(valorParado), delta: null, hint: 'custo × unidades de itens parados' }
  ]);

  const alerts = [];
  withStatus.filter(p => p.status_calc === 'Esgotado').forEach(p =>
    alerts.push({ level: 'critical', icon: '⛔', title: `${p.name} esgotado`, sub: `${p.marketplace} · vendia ${p.unitsSoldMonth}/mês` }));
  withStatus.filter(p => p.status_calc === 'Baixo').forEach(p =>
    alerts.push({ level: 'warning', icon: '⚠️', title: `Estoque baixo: ${p.name}`, sub: `${p.stock} unidades restantes (mínimo: ${p.minStock})` }));
  withStatus.filter(p => p.status_calc === 'Parado').forEach(p =>
    alerts.push({ level: '', icon: '🐌', title: `${p.name} está parado`, sub: `${p.stock} unidades em estoque, só ${p.unitsSoldMonth} vendidas no mês — ${yalcaFormatCurrency(p.cost * p.stock)} parados` }));
  renderAlertList(document.getElementById('stockAlerts'), alerts.slice(0, 8));

  const tbody = document.getElementById('stockTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="alert-empty">Nenhum produto nesse status.</td></tr>';
    return;
  }
  const badgeClass = { OK: 'ok', Baixo: 'baixo', Esgotado: 'esgotado', Parado: 'parado' };
  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td data-label="SKU">${yalcaEscapeHtml(p.sku)}</td>
      <td data-label="Produto">${yalcaEscapeHtml(p.name)}</td>
      <td class="num" data-label="Estoque">${p.stock}</td>
      <td class="num" data-label="Mínimo">${p.minStock}</td>
      <td class="num" data-label="Vendidos/mês">${p.unitsSoldMonth}</td>
      <td data-label="Status"><span class="badge badge--${badgeClass[p.status_calc]}">${p.status_calc}</span></td>
    </tr>`).join('');
}

/* ============================================================
   FLUXO DE CAIXA
   ============================================================ */
function computeCashflowProjection() {
  const monthly = yalcaGroupTransactionsByMonth(DATA.transactions);
  const now = new Date();
  const fallbackKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastKey = monthly.length > 0 ? monthly[monthly.length - 1].key : fallbackKey;

  let recurringNet = 0;
  if (monthly.length > 0) {
    const lastClosed = monthly.length > 1 ? monthly[monthly.length - 2] : monthly[monthly.length - 1];
    recurringNet = lastClosed.receita - lastClosed.despesa;
  }

  let saldo = DATA.settings.cashBalance;
  const projection = [];
  let [y, m] = lastKey.split('-').map(Number);

  for (let i = 0; i < 3; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const plannedForMonth = DATA.plannedEntries.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
    saldo = saldo + recurringNet + plannedForMonth;
    projection.push({ key, saldo, plannedForMonth });
  }

  return { recurringNet, projection, currentBalance: DATA.settings.cashBalance, currentKey: lastKey };
}

function renderFluxoCaixa() {
  const { recurringNet, projection, currentBalance, currentKey } = computeCashflowProjection();

  const lowestMonth = projection.reduce((min, p) => p.saldo < min.saldo ? p : min, projection[0]);

  renderKpiGrid('cashflowKpis', [
    { label: 'Saldo atual em caixa', value: yalcaFormatCurrency(currentBalance), delta: null, hint: yalcaMonthLabel(currentKey + '-01') },
    { label: 'Lucro recorrente/mês', value: yalcaFormatCurrency(recurringNet), delta: null, hint: 'baseado no último mês fechado' },
    { label: `Saldo projetado (${yalcaMonthLabel(projection[2].key + '-01')})`, value: yalcaFormatCurrency(projection[2].saldo), delta: null },
    { label: 'Mês mais apertado', value: yalcaMonthLabel(lowestMonth.key + '-01'), delta: null, hint: yalcaFormatCurrency(lowestMonth.saldo) }
  ]);

  const points = [{ label: yalcaMonthLabel(currentKey + '-01'), value: currentBalance }, ...projection.map(p => ({ label: yalcaMonthLabel(p.key + '-01'), value: p.saldo }))];
  yalcaRenderLineChart(document.getElementById('cashflowChart'), {
    series: [{ name: 'Saldo projetado', color: YALCA_COLORS.series3, data: points }],
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  renderPlannedTable();
}

function renderPlannedTable() {
  const tbody = document.getElementById('plannedTableBody');
  const sorted = [...DATA.plannedEntries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="alert-empty">Nenhum lançamento futuro cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${yalcaFormatDate(e.date)}</td>
      <td>${yalcaEscapeHtml(e.description)}</td>
      <td class="num ${e.amount >= 0 ? 'text-good' : 'text-critical'}">${e.amount >= 0 ? '+' : ''}${yalcaFormatCurrency(e.amount)}</td>
      <td class="row-actions"><button class="icon-btn" title="Excluir" data-action="deletePlannedRow" data-id="${e.id}">🗑</button></td>
    </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('plannedTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deletePlannedRow"]');
    if (btn) deletePlannedRow(btn.dataset.id);
  });

  document.getElementById('addPlannedBtn').addEventListener('click', () => {
    document.getElementById('plannedForm').reset();
    openModal('plannedModal');
  });

  document.getElementById('plannedForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const record = {
      date: document.getElementById('plDate').value,
      description: document.getElementById('plDescription').value,
      amount: parseFloat(document.getElementById('plAmount').value) || 0
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      await yalcaAddPlannedEntry(record);
      closeModal('plannedModal');
      await reloadAndRenderAll();
    } catch (err) {
      alert('Não foi possível salvar: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });
});

async function deletePlannedRow(id) {
  if (!confirm('Excluir este lançamento futuro?')) return;
  try {
    await yalcaDeletePlannedEntry(id);
    await reloadAndRenderAll();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
function renderSettingsForm() {
  document.getElementById('setClientName').value = DATA.settings.clientName;
  document.getElementById('setCashBalance').value = DATA.settings.cashBalance;
  document.getElementById('setTaxPct').value = DATA.settings.defaultTaxPct;
  document.getElementById('setShipping').value = DATA.settings.defaultShippingCost;

  const feeFields = document.getElementById('settingsFeeFields');
  feeFields.innerHTML = MARKETPLACES.map(mk => `
    <div class="field">
      <label for="setFee_${mk.replace(/\s/g, '')}">${mk} (%)</label>
      <input type="number" id="setFee_${mk.replace(/\s/g, '')}" min="0" step="0.1" value="${DATA.settings.marketplaceFees[mk] ?? 0}" data-mk="${mk}">
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const successMsg = document.getElementById('settingsSuccess');
    successMsg.classList.remove('is-visible');

    const marketplaceFees = {};
    document.querySelectorAll('#settingsFeeFields input').forEach(input => {
      marketplaceFees[input.dataset.mk] = parseFloat(input.value) || 0;
    });

    const patch = {
      client_name: document.getElementById('setClientName').value,
      cash_balance: parseFloat(document.getElementById('setCashBalance').value) || 0,
      default_tax_pct: parseFloat(document.getElementById('setTaxPct').value) || 0,
      default_shipping_cost: parseFloat(document.getElementById('setShipping').value) || 0,
      marketplace_fees: marketplaceFees
    };

    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      await yalcaUpdateSettings(patch);
      await reloadAndRenderAll();
      successMsg.classList.add('is-visible');
      setTimeout(() => successMsg.classList.remove('is-visible'), 4000);
    } catch (err) {
      alert('Não foi possível salvar as configurações: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar configurações';
    }
  });
});
