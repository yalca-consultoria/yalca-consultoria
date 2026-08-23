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
  bindGlobalActions();
  initOverviewPeriodFilter();

  await reloadAndRenderAll();
});

async function reloadAndRenderAll() {
  try {
    DATA = await yalcaFetchAll(YALCA_PROFILE);
    renderAll();
  } catch (err) {
    console.error(err);
    alert('Não foi possível carregar seus dados: ' + err.message);
  }
}

function renderAll() {
  renderClientName();
  renderOverview();
  renderResetButtonLabel();
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function initSidebarNav() {
  // Só os itens que ainda trocam de SEÇÃO dentro desta página (têm
  // data-section) — itens que viraram link de verdade pra outra página
  // (ex: Configurações, que já saiu daqui) são <a> normais, o navegador
  // cuida da navegação sozinho.
  const items = document.querySelectorAll('.portal-nav__item[data-section]');
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

  function activateSection(target) {
    const item = [...items].find(i => i.dataset.section === target);
    if (!item) return false;
    items.forEach(i => i.classList.toggle('is-active', i === item));
    sections.forEach(s => s.classList.toggle('is-active', s.dataset.section === target));
    title.textContent = item.querySelector('.portal-nav__label').textContent;
    return true;
  }

  // Outras páginas (ex: configuracoes.html) linkam de volta pra uma seção
  // específica via #hash (dashboard.html#financeiro) — sem isso, chegar de
  // outra página sempre caía na Visão Geral (seção padrão), ignorando o
  // item de menu que a pessoa realmente clicou.
  if (location.hash) activateSection(location.hash.slice(1));

  items.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.section;
      activateSection(target);
      if (isMobileDrawer()) closeSidebar();
      if (sidebar.classList.contains('is-collapsed')) {
        const group = item.closest('.portal-nav__group');
        if (group) { group.classList.remove('is-open'); group.querySelector('.portal-nav__group-heading').setAttribute('aria-expanded', 'false'); }
      }
    });
  });

  // Grupos expansíveis do menu (Financeiro, Marketplaces) — cabeçalho só
  // abre/fecha o próprio grupo, não troca de seção (não tem data-section).
  document.querySelectorAll('.portal-nav__group-heading').forEach(heading => {
    heading.addEventListener('click', () => {
      const group = heading.closest('.portal-nav__group');
      const isOpen = group.classList.toggle('is-open');
      heading.setAttribute('aria-expanded', String(isOpen));
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

  /* --------------------------------------------------------------
     Sidebar recolhível (só desktop) — rail de ícones + flyout pros
     grupos, mesma lógica visual do menu colapsado do Bling. Estado
     persistido pra sobreviver a um F5 no meio do expediente.
     -------------------------------------------------------------- */
  const collapseBtn = document.getElementById('portalSidebarCollapseBtn');
  const SIDEBAR_COLLAPSE_KEY = 'yalcaSidebarCollapsed';

  function closeAllGroupFlyouts() {
    document.querySelectorAll('.portal-nav__group.is-open').forEach(g => {
      g.classList.remove('is-open');
      g.querySelector('.portal-nav__group-heading').setAttribute('aria-expanded', 'false');
    });
  }

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    closeAllGroupFlyouts();
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* localStorage indisponível — sem persistência, sem quebra */ }
  }

  collapseBtn.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('is-collapsed')));

  try {
    if (!isMobileDrawer() && localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1') setCollapsed(true);
  } catch { /* localStorage indisponível — abre expandido, comportamento padrão */ }

  // Fecha o flyout de um grupo ao clicar fora dele (sidebar recolhida).
  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('is-collapsed')) return;
    if (e.target.closest('.portal-nav__group')) return;
    closeAllGroupFlyouts();
  });
}

function bindGlobalActions() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  document.getElementById('resetDemoBtn').addEventListener('click', () => {
    const isEmpty = DATA && DATA.products.length === 0 && DATA.transactions.length === 0;
    const confirmInput = document.getElementById('resetDemoConfirmInput');
    const confirmBtn = document.getElementById('resetDemoConfirmBtn');
    confirmInput.value = '';
    confirmBtn.disabled = true;

    if (isEmpty) {
      // Conta vazia: nada real a perder, então uma confirmação simples basta.
      document.getElementById('resetDemoModalText').textContent = 'Isso vai preencher sua conta com produtos e lançamentos de exemplo, só para você conhecer as ferramentas.';
      document.getElementById('resetDemoConfirmInput').closest('.field').style.display = 'none';
      confirmBtn.disabled = false;
    } else {
      document.getElementById('resetDemoModalText').textContent = 'Isso vai APAGAR TODOS os seus produtos, lançamentos e lançamentos futuros atuais e substituir por dados de exemplo. Essa ação não pode ser desfeita.';
      document.getElementById('resetDemoConfirmInput').closest('.field').style.display = '';
    }
    openModal('resetDemoModal');
  });

  document.getElementById('resetDemoConfirmInput').addEventListener('input', (e) => {
    document.getElementById('resetDemoConfirmBtn').disabled = e.target.value.trim().toUpperCase() !== 'CONFIRMAR';
  });

  document.getElementById('resetDemoConfirmBtn').addEventListener('click', async () => {
    const isEmpty = DATA && DATA.products.length === 0 && DATA.transactions.length === 0;
    const btn = document.getElementById('resetDemoConfirmBtn');
    btn.disabled = true; btn.textContent = 'Aplicando...';
    try {
      if (!isEmpty) await yalcaClearAllData();
      await yalcaSeedDemoData();
      closeModal('resetDemoModal');
      await reloadAndRenderAll();
    } catch (err) {
      alert('Não foi possível carregar os dados de exemplo: ' + err.message);
    } finally {
      btn.textContent = 'Substituir dados';
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

/* ============================================================
   VISÃO GERAL
   Estilo Bling: filtro de período + período de comparação, KPIs
   com barra de progresso e variação % real contra o período
   anterior, gráfico com as duas janelas sobrepostas por dia/semana.
   ============================================================ */
let OVERVIEW_PERIOD = null;

function isoDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultOverviewPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const compareStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const compareEnd = new Date(now.getFullYear(), now.getMonth(), 0); // último dia do mês anterior
  return { start: isoDateLocal(start), end: isoDateLocal(now), compareStart: isoDateLocal(compareStart), compareEnd: isoDateLocal(compareEnd) };
}

function initOverviewPeriodFilter() {
  OVERVIEW_PERIOD = defaultOverviewPeriod();
  document.getElementById('overviewPeriodStart').value = OVERVIEW_PERIOD.start;
  document.getElementById('overviewPeriodEnd').value = OVERVIEW_PERIOD.end;
  document.getElementById('overviewComparePeriodStart').value = OVERVIEW_PERIOD.compareStart;
  document.getElementById('overviewComparePeriodEnd').value = OVERVIEW_PERIOD.compareEnd;

  document.getElementById('overviewApplyPeriodBtn').addEventListener('click', () => {
    const start = document.getElementById('overviewPeriodStart').value;
    const end = document.getElementById('overviewPeriodEnd').value;
    const compareStart = document.getElementById('overviewComparePeriodStart').value;
    const compareEnd = document.getElementById('overviewComparePeriodEnd').value;
    if (!start || !end || !compareStart || !compareEnd) { alert('Preencha as datas de início e fim dos dois períodos.'); return; }
    if (start > end || compareStart > compareEnd) { alert('Em cada período, a data final deve ser igual ou posterior à inicial.'); return; }
    OVERVIEW_PERIOD = { start, end, compareStart, compareEnd };
    renderOverview();
  });
}

function pctDelta(curr, prev) {
  if (prev === 0) return curr === 0 ? null : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
function progressOf(curr, prev) {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return (curr / prev) * 100;
}

// Agrega receita por dia (ou por semana, se o período passar de 31 dias —
// dia a dia num período de meses viraria um gráfico ilegível) dentro da
// janela [startStr, endStr]. bucketDays vem junto pro rótulo do eixo X
// bater com a granularidade escolhida.
function bucketedRevenue(transactions, startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const bucketDays = totalDays > 31 ? 7 : 1;
  const bucketCount = Math.ceil(totalDays / bucketDays);
  const byDate = new Map();
  transactions.forEach(t => {
    if (t.type !== 'receita') return;
    byDate.set(t.date, (byDate.get(t.date) || 0) + Number(t.amount));
  });
  const buckets = new Array(bucketCount).fill(0);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    buckets[Math.floor(i / bucketDays)] += byDate.get(isoDateLocal(d)) || 0;
  }
  return { buckets, bucketDays };
}

function renderOverview() {
  if (!OVERVIEW_PERIOD) OVERVIEW_PERIOD = defaultOverviewPeriod();
  const { start, end, compareStart, compareEnd } = OVERVIEW_PERIOD;

  const currentTx = DATA.transactions.filter(t => t.date >= start && t.date <= end);
  const compareTx = DATA.transactions.filter(t => t.date >= compareStart && t.date <= compareEnd);
  const sum = (txs, type) => txs.filter(t => t.type === type).reduce((a, t) => a + Number(t.amount), 0);

  const receitaAtual = sum(currentTx, 'receita');
  const despesaAtual = sum(currentTx, 'despesa');
  const lucroAtual = receitaAtual - despesaAtual;
  const margemAtual = receitaAtual > 0 ? (lucroAtual / receitaAtual) * 100 : 0;

  const receitaAnterior = sum(compareTx, 'receita');
  const despesaAnterior = sum(compareTx, 'despesa');
  const lucroAnterior = receitaAnterior - despesaAnterior;
  const margemAnterior = receitaAnterior > 0 ? (lucroAnterior / receitaAnterior) * 100 : 0;

  const stockAlerts = DATA.products.filter(p => ['Esgotado', 'Baixo'].includes(yalcaStockStatus(p)));
  const cashflow = computeCashflowProjection();
  const nextMonthBalance = cashflow.projection[0];

  const hasAnyData = currentTx.length > 0 || compareTx.length > 0;

  renderKpiGrid('overviewKpis', [
    {
      label: 'Faturamento no período', value: yalcaFormatCurrency(receitaAtual),
      delta: hasAnyData ? pctDelta(receitaAtual, receitaAnterior) : null,
      progress: hasAnyData ? progressOf(receitaAtual, receitaAnterior) : null,
      compareValue: hasAnyData ? `${yalcaFormatCurrency(receitaAnterior)} no período anterior` : null,
      hint: hasAnyData ? null : 'cadastre lançamentos para ver aqui',
      info: 'Soma de todas as receitas lançadas no período selecionado, comparado com o mesmo tamanho de período imediatamente anterior.'
    },
    {
      label: 'Lucro líquido', value: yalcaFormatCurrency(lucroAtual),
      delta: hasAnyData ? pctDelta(lucroAtual, lucroAnterior) : null,
      progress: hasAnyData ? progressOf(lucroAtual, lucroAnterior) : null,
      compareValue: hasAnyData ? `${yalcaFormatCurrency(lucroAnterior)} no período anterior` : null,
      info: 'Faturamento menos todas as despesas lançadas no mesmo período.'
    },
    { label: 'Margem líquida', value: hasAnyData ? `${margemAtual.toFixed(1)}%` : '—', hint: hasAnyData ? `Período anterior: ${margemAnterior.toFixed(1)}%` : 'Receita menos todos os custos', info: 'Lucro líquido dividido pelo faturamento, em %. Mostra quanto do que entra realmente sobra de lucro.' },
    { label: 'Estoque em alerta', value: stockAlerts.length, hint: 'produtos baixos ou esgotados', info: 'Quantos produtos do Controle de Estoque estão marcados como "Baixo" ou "Esgotado" agora.' },
    { label: 'Saldo projetado (próx. mês)', value: yalcaFormatCurrency(nextMonthBalance.saldo), hint: yalcaMonthLabel(nextMonthBalance.key + '-01'), info: 'Estimativa de quanto vai sobrar em caixa no próximo mês, baseada nos lançamentos recorrentes e planejados que você já cadastrou.' }
  ]);

  const chartEl = document.getElementById('overviewTrendChart');
  if (!hasAnyData) {
    chartEl.innerHTML = '<p class="alert-empty">Cadastre seus lançamentos em "Financeiro" (ou clique em "Carregar dados de exemplo" no menu lateral) para ver o gráfico aqui.</p>';
  } else {
    const curBuckets = bucketedRevenue(currentTx, start, end);
    const cmpBuckets = bucketedRevenue(compareTx, compareStart, compareEnd);
    const len = Math.max(curBuckets.buckets.length, cmpBuckets.buckets.length);
    const unitLabel = curBuckets.bucketDays > 1 ? 'Sem' : 'Dia';
    const labels = Array.from({ length: len }, (_, i) => `${unitLabel} ${i + 1}`);
    yalcaRenderLineChart(chartEl, {
      series: [
        { name: 'Período atual', color: YALCA_COLORS.series1, data: labels.map((label, i) => ({ label, value: curBuckets.buckets[i] || 0 })) },
        { name: 'Período anterior', color: YALCA_COLORS.series2, data: labels.map((label, i) => ({ label, value: cmpBuckets.buckets[i] || 0 })) }
      ],
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  }

  renderOverviewAlerts();
  renderOverviewChannelChart(currentTx);
  renderOverviewTopProducts();
}

function renderOverviewChannelChart(currentTx) {
  const el = document.getElementById('overviewChannelChart');
  const data = MARKETPLACES
    .map(mk => ({ label: mk, value: currentTx.filter(t => t.type === 'receita' && t.marketplace === mk).reduce((a, t) => a + Number(t.amount), 0), color: YALCA_MARKETPLACE_COLOR[mk] }))
    .filter(d => d.value > 0);
  if (data.length === 0) {
    el.innerHTML = '<p class="alert-empty">Sem receita registrada no período selecionado.</p>';
    return;
  }
  yalcaRenderBarChart(el, { data, formatValue: (v) => yalcaFormatCurrency(v) });
}

function renderOverviewTopProducts() {
  const tbody = document.getElementById('overviewTopProductsBody');
  const top = [...DATA.products].sort((a, b) => b.unitsSoldMonth - a.unitsSoldMonth).slice(0, 10);
  if (top.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="alert-empty">Nenhum produto cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = top.map(p => `
    <tr>
      <td data-label="Produto">${yalcaEscapeHtml(p.name)}</td>
      <td data-label="Marketplace"><div class="marketplace-cell">${renderChannelBadge(p.marketplace)}<div class="marketplace-cell__text"><strong>${yalcaEscapeHtml(p.marketplace)}</strong></div></div></td>
      <td class="num" data-label="Vendidos/mês">${p.unitsSoldMonth}</td>
    </tr>`).join('');
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

// renderAlertList e renderKpiGrid moraram aqui até 2026-08-22 — mudaram
// pra charts.js (compartilhado por TODAS as páginas, inclusive as
// standalone que vieram depois de dashboard.html, ex: estoque.html) pra
// não duplicar a mesma função em cada página nova separada do SPA.

/* FINANCEIRO saiu daqui — virou página própria (financeiro.html +
   js/financeiro-app.js), 2026-08-23. */

/* Gestão de Marketplaces (renderMarketplaces/editProduct/deleteProductRow)
   saiu daqui — virou página própria (marketplaces.html +
   js/marketplaces-app.js), 2026-08-23. */

/* Calculadora de Preço saiu daqui — virou página própria (precificacao.html
   + js/precificacao-app.js), 2026-08-23. O #productModal/#productForm que
   ela reaproveitava pra "salvar como produto" foi duplicado na página nova
   (mesmo padrão do #resetDemoModal em toda página standalone). */

/* Controle de Estoque saiu daqui — virou página própria (estoque.html +
   js/estoque-app.js), 2026-08-22. */

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

/* renderFluxoCaixa/renderPlannedTable/deletePlannedRow saíram daqui — viraram
   página própria (fluxocaixa.html + js/fluxocaixa-app.js), 2026-08-23.
   computeCashflowProjection() continua aqui pois a Visão Geral também usa. */

/* Configurações saiu daqui — virou página própria (configuracoes.html +
   js/configuracoes-app.js), primeira página separada do antigo SPA único
   (pedido do cliente, 2026-08-22). */
