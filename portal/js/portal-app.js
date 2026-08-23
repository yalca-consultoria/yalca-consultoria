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
  initOverviewPeriodFilter();
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
  recalcPricing();
  renderResetButtonLabel();
  renderKeepaSellerMetrics();
  renderKeepaTracked();
  renderKeepaAlerts();
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

function populateMarketplaceSelects() {
  const selects = ['prodMarketplace'];
  selects.forEach(selId => {
    const sel = document.getElementById(selId);
    MARKETPLACES.forEach(mk => {
      const opt = document.createElement('option');
      opt.value = mk;
      opt.textContent = mk;
      sel.appendChild(opt);
    });
  });
}

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
   js/marketplaces-app.js), 2026-08-23. O submit do #productForm continua
   aqui porque a Calculadora de Preço (openSaveAsProduct, ainda nesta
   página) reaproveita o mesmo #productModal pra salvar um produto novo. */
document.addEventListener('DOMContentLoaded', () => {
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

// CHANNEL_VISUALS/renderChannelBadge moraram aqui até 2026-08-23 — mudaram
// pra charts.js (compartilhado por todas as páginas) porque a Visão Geral
// e o Keepa (que continuam aqui) e a Gestão de Marketplaces (que virou
// página própria) todos precisam.

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
