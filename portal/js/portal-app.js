/* =========================================
   Yalca Portal — painel do cliente
   Dados reais via Supabase (ver portal-data.js).

   Organização:
   1. estado e boot          5. seções (render sob demanda)
   2. navegação e rotas      6. precificação
   3. utilitários de UI      7. formulários e CRUD
   4. tabelas                8. configurações
   ========================================= */

/* ============================================================
   1. ESTADO E BOOT
   ============================================================ */

let DATA = null;
let PROFILE = null;
let IS_ADMIN = false;
let USER = null;

const UI = {
  section: 'inicio',
  period: 'last6',
  dirty: new Set(),
  filters: {
    financeSearch: '', financeType: 'todos',
    productSearch: '', productChannel: 'todos', productMargin: 'todos',
    stockSearch: '', stockStatus: 'todos'
  },
  sort: {
    transactions: { key: 'date', dir: 'desc' },
    products: { key: 'profitMonth', dir: 'desc' },
    stock: { key: 'daysLeft', dir: 'asc' }
  }
};

const SECTIONS = {
  inicio: { title: 'Início', short: 'Início', subtitle: 'Resumo do seu negócio', period: true },
  financeiro: { title: 'Financeiro', short: 'Financeiro', subtitle: 'Entradas, saídas e resultado', period: true },
  produtos: { title: 'Produtos e margem', short: 'Produtos', subtitle: 'Quanto sobra em cada venda', period: false },
  precificacao: { title: 'Precificação', short: 'Preços', subtitle: 'O preço ideal em cada canal', period: false },
  estoque: { title: 'Estoque', short: 'Estoque', subtitle: 'O que repor e o que está parado', period: false },
  caixa: { title: 'Fluxo de caixa', short: 'Caixa', subtitle: 'Quanto você terá em caixa', period: false },
  config: { title: 'Configurações', short: 'Ajustes', subtitle: 'Loja, metas, canais e conta', period: false }
};

/* Em telas estreitas usamos rótulos curtos ("6 meses", "Produtos") para
   tudo caber em uma linha só na barra superior. */
const NARROW_TOPBAR = window.matchMedia('(max-width: 560px)');

const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  $('pendingLogoutBtn').addEventListener('click', doLogout);
  $('blockedLogoutBtn').addEventListener('click', doLogout);

  if (!(await yalcaRequireAuth())) return;

  try {
    USER = await yalcaCurrentUser();
    const [isAdmin, profile] = await Promise.all([yalcaIsAdmin(), yalcaEnsureProfile()]);
    IS_ADMIN = isAdmin;
    PROFILE = profile;
  } catch (err) {
    showBootError('Não foi possível verificar seu acesso: ' + err.message);
    return;
  }

  if (!IS_ADMIN) {
    if (!PROFILE) {
      showBootError('Não encontramos seu perfil de cliente. Fale com a Yalca para regularizar seu acesso.');
      return;
    }
    if (PROFILE.status === 'pending') return showEntryScreen('pendingScreen');
    if (PROFILE.status === 'blocked') return showEntryScreen('blockedScreen');
  }

  await yalcaDetectSchema();
  applySchemaVisibility();

  try {
    DATA = await yalcaFetchAll(PROFILE);
  } catch (err) {
    showBootError('Não foi possível carregar seus dados: ' + err.message);
    return;
  }

  $('bootScreen').hidden = true;
  $('portalShell').hidden = false;

  initNavigation();
  initPeriodSelect();
  initModals();
  initGlobalActions();
  initTables();
  initFinanceSection();
  initProductSection();
  initStockSection();
  initCashflowSection();
  initPricingSection();
  initSettingsSection();

  renderShellChrome();
  markAllDirty();
  goToSection(sectionFromHash(), { replace: true });
}

function showEntryScreen(id) {
  $('bootScreen').hidden = true;
  $(id).hidden = false;
}

function showBootError(message) {
  $('bootScreen').innerHTML = `
    <div class="boot-screen__inner">
      <span class="logo">Yalca<span>.</span></span>
      <div class="state-icon">⚠️</div>
      <p>${yalcaEscapeHtml(message)}</p>
      <button class="btn btn--ghost btn--sm" onclick="location.reload()">Tentar de novo</button>
    </div>`;
}

async function doLogout() {
  await yalcaLogout();
  window.location.href = 'login.html';
}

/* Esconde o que depende da migração v7 em vez de mostrar campos quebrados. */
function applySchemaVisibility() {
  $$('[data-requires="v7"]').forEach(el => { el.hidden = !YALCA_SCHEMA.settingsV7 && !YALCA_SCHEMA.productsV7; });
  $$('[data-requires="v7-planned"]').forEach(el => { el.hidden = !YALCA_SCHEMA.plannedV7; });
}

function renderShellChrome() {
  const name = DATA.settings.clientName || 'Minha Loja';
  $('clientNameLabel').textContent = name;
  $('clientInitials').textContent = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'Y';
  $('clientEmailLabel').textContent = (USER && USER.email) || 'Cliente Yalca';
  $('adminLink').hidden = !IS_ADMIN;
}

/* ============================================================
   2. NAVEGAÇÃO E ROTAS
   ============================================================ */

function sectionFromHash() {
  const key = String(location.hash || '').replace('#', '');
  return SECTIONS[key] ? key : 'inicio';
}

function initNavigation() {
  $$('.portal-nav__item').forEach(btn => btn.addEventListener('click', () => goToSection(btn.dataset.section)));
  $$('.portal-tabbar button[data-section]').forEach(btn => btn.addEventListener('click', () => goToSection(btn.dataset.section)));
  $('tabbarMore').addEventListener('click', openSidebar);
  $('sidebarToggle').addEventListener('click', openSidebar);
  $('sidebarClose').addEventListener('click', closeSidebar);
  $('navOverlay').addEventListener('click', closeSidebar);
  window.addEventListener('hashchange', () => goToSection(sectionFromHash(), { replace: true }));
}

function goToSection(name, opts) {
  const key = SECTIONS[name] ? name : 'inicio';
  UI.section = key;

  $$('.portal-nav__item').forEach(i => {
    const on = i.dataset.section === key;
    i.classList.toggle('is-active', on);
    i.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.portal-tabbar button[data-section]').forEach(i => i.classList.toggle('is-active', i.dataset.section === key));
  $$('.portal-section').forEach(s => {
    const on = s.dataset.section === key;
    s.classList.toggle('is-active', on);
    s.hidden = !on;
  });

  const meta = SECTIONS[key];
  $('sectionTitle').textContent = NARROW_TOPBAR.matches ? meta.short : meta.title;
  $('sectionSubtitle').textContent = meta.subtitle;
  $('periodSelect').hidden = !meta.period;

  if (!opts || !opts.replace) history.pushState(null, '', '#' + key);
  else if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key);

  closeSidebar();
  renderSection(key);
  $('portalContent').scrollTo ? $('portalContent').scrollTo({ top: 0 }) : null;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function openSidebar() {
  $('portalSidebar').classList.add('is-open');
  $('navOverlay').hidden = false;
  $('sidebarToggle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
}

function closeSidebar() {
  $('portalSidebar').classList.remove('is-open');
  $('navOverlay').hidden = true;
  $('sidebarToggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
}

/* Só a seção visível é redesenhada; as demais ficam marcadas como
   sujas e se atualizam quando o cliente entra nelas. */
function markAllDirty() {
  Object.keys(SECTIONS).forEach(k => UI.dirty.add(k));
}

function renderSection(key, force) {
  if (!DATA) return;
  if (!force && !UI.dirty.has(key)) return;
  UI.dirty.delete(key);
  const renderers = {
    inicio: renderInicio,
    financeiro: renderFinanceiro,
    produtos: renderProdutos,
    precificacao: renderPrecificacao,
    estoque: renderEstoque,
    caixa: renderCaixa,
    config: renderConfig
  };
  try {
    renderers[key]();
  } catch (err) {
    console.error('Erro ao desenhar a seção ' + key, err);
    toast('Algo deu errado ao montar esta tela. Recarregue a página.', 'error');
  }
}

/* Redesenha a seção atual e invalida as outras. */
function refreshUI() {
  markAllDirty();
  renderShellChrome();
  renderSection(UI.section, true);
}

function fillPeriodOptions() {
  const sel = $('periodSelect');
  const current = sel.value;
  sel.innerHTML = YALCA_PERIODS.map(p => `<option value="${p.key}">${NARROW_TOPBAR.matches ? p.short : p.label}</option>`).join('');
  if (current) sel.value = current;
}

function initPeriodSelect() {
  const sel = $('periodSelect');
  fillPeriodOptions();
  const onChangeWidth = () => { fillPeriodOptions(); goToSection(UI.section, { replace: true }); };
  if (NARROW_TOPBAR.addEventListener) NARROW_TOPBAR.addEventListener('change', onChangeWidth);
  else NARROW_TOPBAR.addListener(onChangeWidth);
  const saved = localStorage.getItem('yalca_period');
  UI.period = YALCA_PERIODS.some(p => p.key === saved) ? saved : 'last6';
  sel.value = UI.period;
  sel.addEventListener('change', () => {
    UI.period = sel.value;
    try { localStorage.setItem('yalca_period', UI.period); } catch (e) { /* modo privado */ }
    UI.dirty.add('inicio'); UI.dirty.add('financeiro');
    renderSection(UI.section, true);
  });
}

function currentRange() {
  return yalcaPeriodRange(UI.period, DATA.transactions);
}

/* ============================================================
   3. UTILITÁRIOS DE UI
   ============================================================ */

function toast(message, kind) {
  const stack = $('toastStack');
  // Um resultado torna o aviso de "processando" obsoleto — some com ele
  // em vez de empilhar os dois na tela do celular.
  if (kind === 'success' || kind === 'error') $$('.toast--info', stack).forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast toast--' + (kind || 'info');
  el.innerHTML = `<span>${yalcaEscapeHtml(message)}</span><button aria-label="Fechar">×</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 7000 : 4000);
}

/* Substitui confirm(): no celular o diálogo nativo é péssimo e
   bloqueia a thread. */
function confirmDialog(message, opts) {
  return new Promise(resolve => {
    const o = opts || {};
    $('confirmTitle').textContent = o.title || 'Confirmar';
    $('confirmMessage').textContent = message;
    const ok = $('confirmOkBtn');
    ok.textContent = o.okLabel || 'Confirmar';
    ok.classList.toggle('btn--danger', !!o.danger);

    const cleanup = (value) => {
      ok.removeEventListener('click', onOk);
      $('confirmModal').removeEventListener('yalca:close', onClose);
      closeModal('confirmModal');
      resolve(value);
    };
    const onOk = () => cleanup(true);
    const onClose = () => cleanup(false);
    ok.addEventListener('click', onOk);
    $('confirmModal').addEventListener('yalca:close', onClose, { once: true });
    openModal('confirmModal');
  });
}

/* ---------- Modais acessíveis: foco preso, ESC fecha ---------- */

let modalReturnFocus = null;

function initModals() {
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
  $$('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(backdrop.id); });
  });
  document.addEventListener('keydown', (e) => {
    const open = document.querySelector('.modal-backdrop.is-open');
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(open.id); return; }
    if (e.key === 'Tab') trapFocus(e, open);
  });
}

function focusables(root) {
  return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter(el => el.offsetParent !== null);
}

function trapFocus(e, modal) {
  const items = focusables(modal);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openModal(id) {
  modalReturnFocus = document.activeElement;
  const el = $(id);
  el.classList.add('is-open');
  document.body.classList.add('no-scroll');
  const first = focusables(el).find(f => !f.classList.contains('modal__close'));
  if (first) setTimeout(() => first.focus(), 40);
}

function closeModal(id) {
  const el = $(id);
  if (!el.classList.contains('is-open')) return;
  el.classList.remove('is-open');
  if (!document.querySelector('.modal-backdrop.is-open')) document.body.classList.remove('no-scroll');
  el.dispatchEvent(new CustomEvent('yalca:close'));
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
  modalReturnFocus = null;
}

/* ---------- KPIs ---------- */

/* kpi: { label, value, delta, hint, tone, spark } */
function renderKpiGrid(containerId, kpis) {
  $(containerId).innerHTML = kpis.map(k => `
    <div class="kpi-card${k.tone ? ' kpi-card--' + k.tone : ''}">
      <div class="kpi-card__label">${yalcaEscapeHtml(k.label)}</div>
      <div class="kpi-card__value">${yalcaEscapeHtml(k.value)}</div>
      ${k.delta === null || k.delta === undefined ? '' : `<div class="kpi-card__delta ${k.delta >= 0 ? 'up' : 'down'}">${k.delta >= 0 ? '▲' : '▼'} ${Math.abs(k.delta).toFixed(1)}% <span>vs. período anterior</span></div>`}
      ${k.hint ? `<div class="kpi-card__hint">${yalcaEscapeHtml(k.hint)}</div>` : ''}
      ${k.spark || ''}
    </div>`).join('');
}

function renderSkeletonInto(container, rows) {
  container.innerHTML = Array.from({ length: rows || 3 }).map(() => '<div class="skeleton-line"></div>').join('');
}

/* Selo colorido por canal — sem usar logos de terceiros. */
const CHANNEL_VISUALS = {
  'Mercado Livre': { initials: 'ML', bg: '#FFE600', color: '#1c1c1c' },
  'Amazon': { initials: 'AZ', bg: '#131921', color: '#FF9900' },
  'Shopee': { initials: 'SP', bg: '#EE4D2D', color: '#ffffff' },
  'TikTok': { initials: 'TT', bg: '#010101', color: '#25F4EE' },
  'Temu': { initials: 'TM', bg: '#FB6514', color: '#ffffff' },
  'Droga Raia': { initials: 'DR', bg: '#00A650', color: '#ffffff' }
};

function channelVisual(channel) {
  if (CHANNEL_VISUALS[channel]) return CHANNEL_VISUALS[channel];
  const words = String(channel || '?').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : String(channel).slice(0, 2)).toUpperCase();
  return { initials, bg: yalcaChannelColor(channel), color: '#0b1120' };
}

function channelBadge(channel) {
  const v = channelVisual(channel);
  return `<span class="marketplace-cell__logo" style="background:${v.bg}; color:${v.color};" title="${yalcaEscapeHtml(channel)}">${yalcaEscapeHtml(v.initials)}</span>`;
}

function channelCell(channel, sub) {
  return `<div class="marketplace-cell">${channelBadge(channel)}<div class="marketplace-cell__text"><strong>${yalcaEscapeHtml(channel)}</strong>${sub ? `<span class="marketplace-cell__plan">${yalcaEscapeHtml(sub)}</span>` : ''}</div></div>`;
}

function marginClass(pct, target) {
  if (pct < 0) return 'text-critical';
  if (pct < (target || 0)) return 'text-warning';
  return 'text-good';
}

/* Cada célula leva data-label para virar cartão no celular.
   isTitle marca a célula que vira o cabeçalho do cartão — nem sempre é
   a primeira coluna (num lançamento, a descrição diz mais que a data). */
function td(label, content, cls, isTitle) {
  const classes = [cls, isTitle ? 'card-title' : ''].filter(Boolean).join(' ');
  return `<td data-label="${yalcaEscapeHtml(label)}"${classes ? ` class="${classes}"` : ''}>${content}</td>`;
}

function emptyRow(colspan, message) {
  return `<tr class="is-empty"><td colspan="${colspan}"><p class="alert-empty">${yalcaEscapeHtml(message)}</p></td></tr>`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(f => `"${String(f === null || f === undefined ? '' : f).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  // BOM: sem ele o Excel em pt-BR abre os acentos errados.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   4. TABELAS: ordenação e busca
   ============================================================ */

function initTables() {
  bindSort('transactionsTable', 'transactions', () => { UI.dirty.add('financeiro'); renderSection('financeiro', true); });
  bindSort('productsTable', 'products', () => { UI.dirty.add('produtos'); renderSection('produtos', true); });
  bindSort('stockTable', 'stock', () => { UI.dirty.add('estoque'); renderSection('estoque', true); });
}

function bindSort(tableId, stateKey, onChange) {
  const table = $(tableId);
  if (!table) return;
  $$('.sortable-th', table).forEach(th => {
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');
    const apply = () => {
      const key = th.dataset.sort;
      const state = UI.sort[stateKey];
      if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = key; state.dir = ['sku', 'name', 'description', 'category'].includes(key) ? 'asc' : 'desc'; }
      onChange();
    };
    th.addEventListener('click', apply);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
  });
}

function paintSortHeaders(tableId, stateKey) {
  const table = $(tableId);
  if (!table) return;
  const state = UI.sort[stateKey];
  $$('.sortable-th', table).forEach(th => {
    const on = th.dataset.sort === state.key;
    th.classList.toggle('is-active', on);
    th.setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = on ? (state.dir === 'asc' ? '▴' : '▾') : '▾';
  });
}

function sortRows(rows, state) {
  const { key, dir } = state;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va || '').localeCompare(String(vb || ''), 'pt-BR') * mult;
    }
    const na = Number.isFinite(va) ? va : (dir === 'asc' ? Infinity : -Infinity);
    const nb = Number.isFinite(vb) ? vb : (dir === 'asc' ? Infinity : -Infinity);
    return (na - nb) * mult;
  });
}

function matchesSearch(term, ...fields) {
  if (!term) return true;
  const t = term.trim().toLowerCase();
  return fields.some(f => String(f || '').toLowerCase().includes(t));
}

/* ============================================================
   5. SEÇÕES
   ============================================================ */

/* ---------- 5.1 Início ---------- */

function renderInicio() {
  const range = currentRange();
  const inRange = yalcaFilterByRange(DATA.transactions, range);
  const prev = yalcaPreviousRange(range);
  const prevTx = yalcaFilterByRange(DATA.transactions, prev);
  const totals = yalcaTotals(inRange);
  const prevTotals = yalcaTotals(prevTx);
  const series = yalcaMonthlySeries(inRange, range.months);

  const hasData = DATA.transactions.length > 0 || DATA.products.length > 0;
  $('onboardingCard').hidden = hasData;

  const cashflow = yalcaCashflowProjection(DATA, 3);
  const stockIssues = DATA.products.filter(p => ['Esgotado', 'Crítico', 'Baixo'].includes(yalcaStockStatus(p, DATA.settings)));

  renderKpiGrid('overviewKpis', [
    {
      label: 'Faturamento no período',
      value: yalcaFormatCurrencyShort(totals.receita),
      delta: yalcaDelta(totals.receita, prevTotals.receita),
      hint: range.label,
      spark: yalcaSparklineSvg(series.map(m => m.receita), YALCA_COLORS.series1)
    },
    {
      label: 'Lucro líquido',
      value: yalcaFormatCurrencyShort(totals.lucro),
      delta: yalcaDelta(totals.lucro, prevTotals.lucro),
      hint: `Margem de ${yalcaFormatPct(totals.margem)}`,
      tone: totals.lucro < 0 ? 'critical' : null,
      spark: yalcaSparklineSvg(series.map(m => m.lucro), YALCA_COLORS.series3)
    },
    {
      label: 'Ticket médio por venda',
      value: averageTicket(),
      hint: 'Preço médio ponderado pelas vendas do mês'
    },
    {
      label: 'Estoque pedindo atenção',
      value: String(stockIssues.length),
      hint: stockIssues.length ? 'produtos esgotados, críticos ou baixos' : 'nenhum item em risco',
      tone: stockIssues.length ? 'warning' : null
    },
    {
      label: 'Saldo projetado (3 meses)',
      value: yalcaFormatCurrencyShort(cashflow.projection[2].saldo),
      hint: yalcaMonthLabelLong(cashflow.projection[2].key),
      tone: cashflow.projection[2].saldo < 0 ? 'critical' : null
    }
  ]);

  renderOverviewActions();

  $('overviewTrendSub').textContent = `Evolução mês a mês — ${range.label.toLowerCase()}.`;
  if (series.length && totals.receita + totals.despesa > 0) {
    yalcaRenderLineChart($('overviewTrendChart'), {
      series: [
        { name: 'Faturamento', color: YALCA_COLORS.series1, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })), area: true },
        { name: 'Custo total', color: YALCA_COLORS.series2, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) },
        { name: 'Lucro', color: YALCA_COLORS.series3, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.lucro })) }
      ],
      allowNegative: true,
      formatValue: yalcaFormatCurrency,
      formatAxis: yalcaFormatCurrencyShort
    });
  } else {
    yalcaEmptyChart($('overviewTrendChart'), 'Cadastre lançamentos em Financeiro para ver a evolução aqui.');
  }

  renderGoals();
  renderChannelRevenue(inRange);
  renderTopProducts();
}

function averageTicket() {
  const units = DATA.products.reduce((a, p) => a + yalcaNum(p.unitsSoldMonth), 0);
  if (!units) return '—';
  const revenue = DATA.products.reduce((a, p) => a + yalcaNum(p.price) * yalcaNum(p.unitsSoldMonth), 0);
  return yalcaFormatCurrency(revenue / units);
}

/* A lista de ações é o coração do painel: cada item diz o problema,
   o tamanho do prejuízo e leva direto para onde se resolve. */
function renderOverviewActions() {
  const s = DATA.settings;
  const target = yalcaNum(s.targetMarginPct, 20);
  const actions = [];

  DATA.products.forEach(p => {
    const { marginPct, netProfit } = yalcaProductMargin(p, s);
    if (marginPct < 0) {
      const perMonth = Math.abs(netProfit) * yalcaNum(p.unitsSoldMonth);
      actions.push({
        weight: 1000 + perMonth,
        level: 'critical', icon: '📉',
        title: `${p.name} está sendo vendido no prejuízo`,
        sub: `Margem de ${yalcaFormatPct(marginPct)} — você perde ${yalcaFormatCurrency(Math.abs(netProfit))} por unidade${p.unitsSoldMonth ? ` (${yalcaFormatCurrency(perMonth)} por mês)` : ''}.`,
        cta: 'Corrigir preço', go: () => { UI.filters.productMargin = 'prejuizo'; $('productMarginFilter').value = 'prejuizo'; UI.dirty.add('produtos'); goToSection('produtos'); }
      });
    }
  });

  DATA.products.forEach(p => {
    const status = yalcaStockStatus(p, s);
    const cov = yalcaStockCoverage(p, s);
    if (status === 'Esgotado' && yalcaNum(p.unitsSoldMonth) > 0) {
      const lost = yalcaProductMargin(p, s).netProfit * yalcaNum(p.unitsSoldMonth);
      actions.push({
        weight: 900 + Math.max(lost, 0),
        level: 'critical', icon: '⛔',
        title: `${p.name} está esgotado e continua vendendo`,
        sub: `Vendia ${yalcaFormatNumber(p.unitsSoldMonth)} por mês em ${p.marketplace}. Parado, deixa de render cerca de ${yalcaFormatCurrency(Math.max(lost, 0))} por mês.`,
        cta: 'Ver reposição', go: () => goToSection('estoque')
      });
    } else if (status === 'Crítico') {
      actions.push({
        weight: 700 + (30 - Math.min(cov.daysLeft, 30)),
        level: 'warning', icon: '⏱',
        title: `${p.name} acaba em ${Math.floor(cov.daysLeft)} dia(s)`,
        sub: `Seu prazo de reposição é de ${cov.leadTime} dias — se pedir hoje, ainda assim falta produto. Sugestão: comprar ${yalcaFormatNumber(cov.suggestedPurchase)} unidades.`,
        cta: 'Ver reposição', go: () => goToSection('estoque')
      });
    }
  });

  DATA.products.forEach(p => {
    const { marginPct } = yalcaProductMargin(p, s);
    if (marginPct >= 0 && marginPct < target && yalcaNum(p.unitsSoldMonth) > 0) {
      const suggested = yalcaSuggestedPrice(p, s, target);
      if (suggested) {
        actions.push({
          weight: 400 + (target - marginPct),
          level: 'warning', icon: '⚖️',
          title: `${p.name} rende menos que sua meta de margem`,
          sub: `Hoje: ${yalcaFormatPct(marginPct)}. Para chegar a ${yalcaFormatPct(target, 0)} o preço precisaria ser ${yalcaFormatCurrency(suggested)} (hoje ${yalcaFormatCurrency(p.price)}).`,
          cta: 'Reprecificar', go: () => { UI.filters.productMargin = 'abaixo'; $('productMarginFilter').value = 'abaixo'; UI.dirty.add('produtos'); goToSection('produtos'); }
        });
      }
    }
  });

  const cash = yalcaCashflowProjection(DATA, 6);
  const negative = cash.projection.find(p => p.saldo < 0);
  if (negative) {
    actions.push({
      weight: 950,
      level: 'critical', icon: '🏦',
      title: `Seu caixa fica negativo em ${yalcaMonthLabelLong(negative.key)}`,
      sub: `Projeção de ${yalcaFormatCurrency(negative.saldo)}. Antecipe recebimentos, adie compras ou reduza despesas antes disso.`,
      cta: 'Ver projeção', go: () => goToSection('caixa')
    });
  }

  const parado = DATA.products.filter(p => yalcaStockStatus(p, s) === 'Parado');
  if (parado.length) {
    const capital = parado.reduce((a, p) => a + yalcaNum(p.cost) * yalcaNum(p.stock), 0);
    actions.push({
      weight: 300 + capital / 1000,
      level: '', icon: '🐌',
      title: `${parado.length} produto(s) com estoque parado`,
      sub: `${yalcaFormatCurrency(capital)} do seu capital estão presos em itens que quase não vendem. Considere promoção ou kit.`,
      cta: 'Ver estoque', go: () => { UI.filters.stockStatus = 'Parado'; $('stockFilter').value = 'Parado'; UI.dirty.add('estoque'); goToSection('estoque'); }
    });
  }

  if (YALCA_SCHEMA.settingsV7 && yalcaNum(s.monthlyRevenueGoal) > 0) {
    const monthKey = yalcaCurrentMonthKey();
    const monthTx = DATA.transactions.filter(t => String(t.date).startsWith(monthKey));
    const progress = yalcaGoalProgress(yalcaTotals(monthTx).receita, s.monthlyRevenueGoal, monthKey);
    if (progress && progress.pacePct !== null && progress.pacePct < 90) {
      actions.push({
        weight: 250,
        level: 'warning', icon: '🎯',
        title: 'Sua meta de faturamento do mês está em risco',
        sub: `No ritmo atual você fecha o mês em ${yalcaFormatCurrency(progress.pace)} — ${yalcaFormatPct(progress.pacePct, 0)} da meta de ${yalcaFormatCurrency(progress.goal)}.`,
        cta: 'Ver financeiro', go: () => goToSection('financeiro')
      });
    }
  }

  const list = actions.sort((a, b) => b.weight - a.weight).slice(0, 8);
  $('actionCount').textContent = String(actions.length);
  const container = $('overviewActions');

  if (!list.length) {
    container.innerHTML = DATA.products.length || DATA.transactions.length
      ? '<p class="alert-empty">Nada urgente por aqui. Margens, estoque e caixa estão dentro do esperado. ✅</p>'
      : '<p class="alert-empty">Cadastre seus produtos e lançamentos para o painel começar a apontar oportunidades.</p>';
    return;
  }

  container.innerHTML = list.map((a, i) => `
    <div class="action-item ${a.level}">
      <span class="action-item__icon" aria-hidden="true">${a.icon}</span>
      <div class="action-item__body">
        <strong>${yalcaEscapeHtml(a.title)}</strong>
        <span>${yalcaEscapeHtml(a.sub)}</span>
      </div>
      <button class="btn btn--ghost btn--sm" data-action-index="${i}">${yalcaEscapeHtml(a.cta)}</button>
    </div>`).join('');

  container.onclick = (e) => {
    const btn = e.target.closest('[data-action-index]');
    if (btn) list[Number(btn.dataset.actionIndex)].go();
  };
}

function renderGoals() {
  const container = $('overviewGoals');
  const s = DATA.settings;

  if (!YALCA_SCHEMA.settingsV7) {
    container.innerHTML = '<p class="alert-empty">As metas ficam disponíveis depois de rodar a migração <code>supabase-schema-v7-portal-v2.sql</code> no seu Supabase.</p>';
    return;
  }
  if (!yalcaNum(s.monthlyRevenueGoal) && !yalcaNum(s.monthlyProfitGoal)) {
    container.innerHTML = `<p class="alert-empty">Você ainda não definiu metas. <button class="link-btn" id="goToGoals">Definir agora</button></p>`;
    const btn = $('goToGoals');
    if (btn) btn.addEventListener('click', () => goToSection('config'));
    return;
  }

  const monthKey = yalcaCurrentMonthKey();
  const monthTx = DATA.transactions.filter(t => String(t.date).startsWith(monthKey));
  const totals = yalcaTotals(monthTx);

  container.innerHTML = '<div id="goalRevenue"></div><div id="goalProfit"></div>';

  const paceText = (p) => p && p.pace !== null
    ? `No ritmo atual: <strong>${yalcaEscapeHtml(yalcaFormatCurrency(p.pace))}</strong> até o fim do mês`
    : '';

  if (yalcaNum(s.monthlyRevenueGoal)) {
    const p = yalcaGoalProgress(totals.receita, s.monthlyRevenueGoal, monthKey);
    yalcaRenderProgressRing($('goalRevenue'), {
      pct: p.pct, pacePct: p.pacePct, color: YALCA_COLORS.series1,
      label: 'Faturamento de ' + yalcaMonthLabelLong(monthKey),
      value: `${yalcaFormatCurrency(totals.receita)} de ${yalcaFormatCurrency(s.monthlyRevenueGoal)}`,
      sub: paceText(p)
    });
  }
  if (yalcaNum(s.monthlyProfitGoal)) {
    const p = yalcaGoalProgress(totals.lucro, s.monthlyProfitGoal, monthKey);
    yalcaRenderProgressRing($('goalProfit'), {
      pct: p.pct, pacePct: p.pacePct, color: YALCA_COLORS.series3,
      label: 'Lucro de ' + yalcaMonthLabelLong(monthKey),
      value: `${yalcaFormatCurrency(totals.lucro)} de ${yalcaFormatCurrency(s.monthlyProfitGoal)}`,
      sub: paceText(p)
    });
  }
}

function renderChannelRevenue(transactions) {
  const channels = yalcaChannels(DATA.settings);
  const data = channels.map(c => ({
    label: c,
    value: transactions.filter(t => t.type === 'receita' && t.marketplace === c).reduce((a, t) => a + yalcaNum(t.amount), 0),
    color: yalcaChannelColor(c)
  })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  const total = data.reduce((a, d) => a + d.value, 0);
  if (!data.length) {
    yalcaEmptyChart($('overviewChannelChart'), 'Registre a receita informando o canal para ver esta divisão.');
    return;
  }
  yalcaRenderDonutChart($('overviewChannelChart'), {
    data, formatValue: yalcaFormatCurrency,
    centerValue: yalcaFormatCurrencyShort(total), centerLabel: 'no período'
  });
}

function renderTopProducts() {
  const rows = DATA.products
    .map(p => ({ p, ...yalcaProductMonthly(p, DATA.settings) }))
    .filter(r => r.units > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 6);

  if (!rows.length) {
    yalcaEmptyChart($('overviewTopProducts'), 'Cadastre produtos com o volume vendido no mês para ver o ranking de lucro.');
    return;
  }
  yalcaRenderHBarChart($('overviewTopProducts'), {
    data: rows.map(r => ({ label: r.p.name, value: Math.round(r.profit), color: r.profit < 0 ? '#d03b3b' : yalcaChannelColor(r.p.marketplace) })),
    formatValue: yalcaFormatCurrencyShort
  });
}

/* ---------- 5.2 Financeiro ---------- */

function initFinanceSection() {
  $('financeSearch').addEventListener('input', debounce(() => {
    UI.filters.financeSearch = $('financeSearch').value;
    renderTransactionsTable();
  }, 200));
  $('financeTypeFilter').addEventListener('change', () => {
    UI.filters.financeType = $('financeTypeFilter').value;
    renderTransactionsTable();
  });

  const menu = $('financeMoreMenu');
  $('financeMoreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const showing = !menu.hidden;
    menu.hidden = showing;
    $('financeMoreBtn').setAttribute('aria-expanded', String(!showing));
  });
  document.addEventListener('click', () => { menu.hidden = true; $('financeMoreBtn').setAttribute('aria-expanded', 'false'); });
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'exportTx') exportTransactionsCsv();
    if (btn.dataset.act === 'importTx') $('importCsvInput').click();
    if (btn.dataset.act === 'modelTx') downloadCsvTemplate();
  });

  $('importCsvInput').addEventListener('change', importTransactionsCsv);
  $('addTransactionBtn').addEventListener('click', () => openTransactionModal());
  $('transactionForm').addEventListener('submit', submitTransaction);
  $('transactionsTableBody').addEventListener('click', onTransactionRowAction);
}

function renderFinanceiro() {
  const range = currentRange();
  const inRange = yalcaFilterByRange(DATA.transactions, range);
  const prevTx = yalcaFilterByRange(DATA.transactions, yalcaPreviousRange(range));
  const totals = yalcaTotals(inRange);
  const prevTotals = yalcaTotals(prevTx);
  const series = yalcaMonthlySeries(inRange, range.months);

  renderKpiGrid('financeKpis', [
    { label: 'Receita', value: yalcaFormatCurrencyShort(totals.receita), delta: yalcaDelta(totals.receita, prevTotals.receita), hint: range.label },
    { label: 'Despesa', value: yalcaFormatCurrencyShort(totals.despesa), delta: yalcaDelta(totals.despesa, prevTotals.despesa), hint: range.label },
    { label: 'Lucro líquido', value: yalcaFormatCurrencyShort(totals.lucro), delta: yalcaDelta(totals.lucro, prevTotals.lucro), tone: totals.lucro < 0 ? 'critical' : null },
    { label: 'Margem líquida', value: totals.receita ? yalcaFormatPct(totals.margem) : '—', hint: 'quanto sobra de cada real vendido' },
    { label: 'Resultado médio por mês', value: yalcaFormatCurrencyShort(series.length ? totals.lucro / series.length : 0), hint: `${series.length} mês(es) no período` }
  ]);

  renderBreakEven(inRange);

  if (totals.receita + totals.despesa > 0) {
    yalcaRenderLineChart($('financeTrendChart'), {
      series: [
        { name: 'Receita', color: YALCA_COLORS.series1, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })), area: true },
        { name: 'Despesa', color: YALCA_COLORS.series2, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) },
        { name: 'Lucro', color: YALCA_COLORS.series3, data: series.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.lucro })) }
      ],
      allowNegative: true,
      formatValue: yalcaFormatCurrency,
      formatAxis: yalcaFormatCurrencyShort
    });
  } else {
    yalcaEmptyChart($('financeTrendChart'), 'Nenhum lançamento no período selecionado.');
  }

  const byCategory = new Map();
  inRange.filter(t => t.type === 'despesa').forEach(t => {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + yalcaNum(t.amount));
  });
  const categoryData = [...byCategory.entries()]
    .map(([label, value], i) => ({ label, value, color: YALCA_PALETTE[i % YALCA_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  if (categoryData.length) {
    yalcaRenderDonutChart($('financeCategoryChart'), {
      data: categoryData, formatValue: yalcaFormatCurrency,
      centerValue: yalcaFormatCurrencyShort(totals.despesa), centerLabel: 'em despesas'
    });
  } else {
    yalcaEmptyChart($('financeCategoryChart'), 'Sem despesas registradas neste período.');
  }

  renderCategorySuggestions();
  renderTransactionsTable();
}

function renderBreakEven(transactions) {
  const body = $('breakEvenBody');
  if (!YALCA_SCHEMA.settingsV7) {
    $('breakEvenPanel').hidden = true;
    return;
  }
  $('breakEvenPanel').hidden = false;
  const be = yalcaBreakEven(transactions, DATA.settings);

  if (!be.fixedCosts) {
    body.innerHTML = `<p class="alert-empty">Informe seus custos fixos mensais em Configurações e o painel calcula quanto você precisa faturar para se pagar. <button class="link-btn" id="goToFixed">Informar agora</button></p>`;
    const b = $('goToFixed');
    if (b) b.addEventListener('click', () => goToSection('config'));
    return;
  }
  if (!be.breakEvenRevenue) {
    body.innerHTML = '<p class="alert-empty">Sem receita suficiente no período para calcular a margem de contribuição.</p>';
    return;
  }

  const coverage = Math.max(0, Math.min(be.coverage, 200));
  const ok = be.coverage >= 100;
  body.innerHTML = `
    <div class="breakeven">
      <div class="breakeven__nums">
        <div><span>Custos fixos por mês</span><strong>${yalcaFormatCurrency(be.fixedCosts)}</strong></div>
        <div><span>Margem de contribuição</span><strong>${yalcaFormatPct(be.contributionPct)}</strong></div>
        <div><span>Faturamento mínimo por mês</span><strong class="${ok ? 'text-good' : 'text-critical'}">${yalcaFormatCurrency(be.breakEvenRevenue)}</strong></div>
        <div><span>Sua média no período</span><strong>${yalcaFormatCurrency(be.revenuePerMonth)}</strong></div>
      </div>
      <div class="breakeven__bar">
        <div class="breakeven__fill ${ok ? 'is-ok' : 'is-risk'}" style="width:${Math.min(coverage / 2, 100)}%"></div>
        <div class="breakeven__mark" style="left:50%" title="Ponto de equilíbrio"></div>
      </div>
      <p class="breakeven__verdict ${ok ? 'text-good' : 'text-critical'}">
        ${ok
          ? `Você está faturando ${yalcaFormatPct(be.coverage - 100)} acima do necessário para cobrir os custos fixos.`
          : `Faltam ${yalcaFormatCurrency(be.breakEvenRevenue - be.revenuePerMonth)} de faturamento médio por mês para a operação se pagar.`}
      </p>
    </div>`;
}

function renderCategorySuggestions() {
  const cats = [...new Set(DATA.transactions.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const base = ['Vendas', 'Anúncios', 'Fornecedor', 'Frete', 'Taxa de Marketplace', 'Impostos', 'Custos Fixos', 'Embalagem', 'Devolução'];
  const all = [...new Set([...cats, ...base])];
  $('categorySuggestions').innerHTML = all.map(c => `<option value="${yalcaEscapeHtml(c)}"></option>`).join('');
}

function visibleTransactions() {
  const range = currentRange();
  const f = UI.filters;
  return yalcaFilterByRange(DATA.transactions, range)
    .filter(t => f.financeType === 'todos' || t.type === f.financeType)
    .filter(t => matchesSearch(f.financeSearch, t.description, t.category, t.marketplace));
}

function renderTransactionsTable() {
  paintSortHeaders('transactionsTable', 'transactions');
  const rows = sortRows(visibleTransactions(), UI.sort.transactions);
  const tbody = $('transactionsTableBody');

  if (!rows.length) {
    tbody.innerHTML = emptyRow(7, DATA.transactions.length
      ? 'Nenhum lançamento com esses filtros.'
      : 'Nenhum lançamento cadastrado ainda. Use o botão “+ Lançamento”.');
    $('transactionsFooter').innerHTML = '';
    $('financeCountLabel').textContent = 'Receitas e despesas registradas no período.';
    return;
  }

  tbody.innerHTML = rows.map(t => `
    <tr>
      ${td('Data', yalcaFormatDate(t.date))}
      ${td('Tipo', t.type === 'receita' ? '<span class="badge badge--receita">Receita</span>' : '<span class="badge badge--despesa">Despesa</span>')}
      ${td('Categoria', yalcaEscapeHtml(t.category))}
      ${td('Canal', t.marketplace && t.marketplace !== '-' ? channelCell(t.marketplace) : '<span class="text-muted-num">—</span>')}
      ${td('Descrição', yalcaEscapeHtml(t.description), '', true)}
      ${td('Valor', `${t.type === 'receita' ? '+' : '−'} ${yalcaFormatCurrency(t.amount)}`, `num ${t.type === 'receita' ? 'text-good' : 'text-critical'}`)}
      <td class="row-actions col-actions">
        <button class="icon-btn" title="Editar" aria-label="Editar lançamento" data-action="edit" data-id="${t.id}">✎</button>
        <button class="icon-btn icon-btn--danger" title="Excluir" aria-label="Excluir lançamento" data-action="delete" data-id="${t.id}">🗑</button>
      </td>
    </tr>`).join('');

  const totals = yalcaTotals(rows);
  $('financeCountLabel').textContent = `${rows.length} lançamento(s) no período selecionado.`;
  $('transactionsFooter').innerHTML = `
    <span>Receitas: <strong class="text-good">${yalcaFormatCurrency(totals.receita)}</strong></span>
    <span>Despesas: <strong class="text-critical">${yalcaFormatCurrency(totals.despesa)}</strong></span>
    <span>Resultado: <strong class="${totals.lucro >= 0 ? 'text-good' : 'text-critical'}">${yalcaFormatCurrency(totals.lucro)}</strong></span>`;
}

function onTransactionRowAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const t = DATA.transactions.find(x => String(x.id) === btn.dataset.id);
  if (!t) return;
  if (btn.dataset.action === 'edit') openTransactionModal(t);
  else deleteTransactionRow(t);
}

function openTransactionModal(t) {
  const form = $('transactionForm');
  form.reset();
  populateChannelSelect('tMarketplace', true);
  $('tId').value = t ? t.id : '';
  $('transactionModalTitle').textContent = t ? 'Editar lançamento' : 'Novo lançamento';
  $('tDate').value = t ? String(t.date).slice(0, 10) : yalcaTodayKey();
  form.querySelector(`input[name="tType"][value="${t ? t.type : 'receita'}"]`).checked = true;
  $('tCategory').value = t ? t.category : '';
  $('tMarketplace').value = t ? (t.marketplace || '-') : '-';
  $('tDescription').value = t ? t.description : '';
  $('tAmount').value = t ? Math.abs(yalcaNum(t.amount)) : '';
  openModal('transactionModal');
}

async function submitTransaction(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const id = $('tId').value;
  const record = {
    date: $('tDate').value,
    type: e.target.querySelector('input[name="tType"]:checked').value,
    category: $('tCategory').value.trim() || 'Outros',
    marketplace: $('tMarketplace').value,
    description: $('tDescription').value.trim(),
    amount: Math.abs(parseFloat($('tAmount').value) || 0)
  };
  await withBusy(btn, async () => {
    if (id) {
      const updated = await yalcaUpdateTransaction(id, record);
      const i = DATA.transactions.findIndex(x => String(x.id) === String(id));
      if (i >= 0) DATA.transactions[i] = updated;
      toast('Lançamento atualizado.', 'success');
    } else {
      DATA.transactions.push(await yalcaAddTransaction(record));
      toast('Lançamento salvo.', 'success');
    }
    closeModal('transactionModal');
    refreshUI();
  }, 'Não foi possível salvar o lançamento');
}

async function deleteTransactionRow(t) {
  const ok = await confirmDialog(`Excluir “${t.description}” de ${yalcaFormatDate(t.date)}?`, { danger: true, okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await yalcaDeleteTransaction(t.id);
    DATA.transactions = DATA.transactions.filter(x => String(x.id) !== String(t.id));
    toast('Lançamento excluído.', 'success');
    refreshUI();
  } catch (err) {
    toast('Não foi possível excluir: ' + err.message, 'error');
  }
}

/* ---------- CSV ---------- */

function exportTransactionsCsv() {
  const rows = [['data', 'tipo', 'categoria', 'canal', 'descricao', 'valor']];
  sortRows(visibleTransactions(), UI.sort.transactions)
    .forEach(t => rows.push([t.date, t.type, t.category, t.marketplace, t.description, yalcaNum(t.amount).toFixed(2).replace('.', ',')]));
  downloadCsv('lancamentos-yalca.csv', rows);
  toast(`${rows.length - 1} lançamento(s) exportado(s).`, 'success');
}

function downloadCsvTemplate() {
  downloadCsv('modelo-lancamentos-yalca.csv', [
    ['data', 'tipo', 'categoria', 'canal', 'descricao', 'valor'],
    ['2026-08-05', 'receita', 'Vendas', 'Mercado Livre', 'Vendas do mês', '18000,00'],
    ['2026-08-10', 'despesa', 'Anúncios', '-', 'Tráfego pago', '3800,00']
  ]);
  toast('Modelo baixado. Preencha e importe de volta.', 'success');
}

/* Aceita vírgula ou ponto e vírgula como separador e vírgula decimal —
   é o que sai do Excel em português. */
function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  return lines.map(line => {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  });
}

function parseAmount(raw) {
  const s = String(raw).replace(/[^\d,.-]/g, '');
  // "1.234,56" (pt-BR) vs "1234.56"
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return Math.abs(parseFloat(normalized) || 0);
}

async function importTransactionsCsv(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('O arquivo parece vazio ou sem cabeçalho.', 'error');

  const records = [];
  let ignored = 0;
  rows.slice(1).forEach(cols => {
    if (cols.length < 6) { ignored++; return; }
    const [date, type, category, marketplace, description, amount] = cols;
    const typeNorm = String(type).toLowerCase().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['receita', 'despesa'].includes(typeNorm)) { ignored++; return; }
    records.push({
      date, type: typeNorm,
      category: category || 'Outros',
      marketplace: marketplace || '-',
      description: description || '',
      amount: parseAmount(amount)
    });
  });

  if (!records.length) {
    return toast(`Nenhuma linha válida. Confira o formato: data (AAAA-MM-DD), tipo (receita/despesa), categoria, canal, descrição, valor.`, 'error');
  }

  const ok = await confirmDialog(
    `Importar ${records.length} lançamento(s)?${ignored ? ` ${ignored} linha(s) serão ignoradas por estarem fora do formato.` : ''}`,
    { okLabel: 'Importar' }
  );
  if (!ok) return;

  try {
    toast('Importando…', 'info');
    const inserted = await yalcaAddTransactionsBulk(records);
    DATA.transactions.push(...inserted);
    toast(`${inserted.length} lançamento(s) importado(s).`, 'success');
    refreshUI();
  } catch (err) {
    toast('Erro ao importar: ' + err.message, 'error');
  }
}

/* ---------- 5.3 Produtos e margem ---------- */

function initProductSection() {
  $('productSearch').addEventListener('input', debounce(() => {
    UI.filters.productSearch = $('productSearch').value;
    renderProductsTable();
  }, 200));
  $('marketplaceFilter').addEventListener('change', () => {
    UI.filters.productChannel = $('marketplaceFilter').value;
    renderProductsTable();
  });
  $('productMarginFilter').addEventListener('change', () => {
    UI.filters.productMargin = $('productMarginFilter').value;
    renderProductsTable();
  });
  $('addProductBtn').addEventListener('click', () => openProductModal());
  $('onboardProductBtn').addEventListener('click', () => openProductModal());
  $('exportProductsBtn').addEventListener('click', exportProductsCsv);
  $('productForm').addEventListener('submit', submitProduct);
  $('productsTableBody').addEventListener('click', onProductRowAction);
  $('repriceTableBody').addEventListener('click', onRepriceAction);
  $('applyAllPricesBtn').addEventListener('click', applyAllSuggestedPrices);

  ['prodCost', 'prodPrice', 'prodShipping', 'prodFee', 'prodMarketplace'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderProductMarginPreview);
  });
  $('prodMarketplace').addEventListener('change', renderProductMarginPreview);
}

function renderProdutos() {
  populateChannelSelect('marketplaceFilter', false, true);
  $('marketplaceFilter').value = UI.filters.productChannel;
  $('productMarginFilter').value = UI.filters.productMargin;

  const s = DATA.settings;
  const target = yalcaNum(s.targetMarginPct, 20);
  const all = DATA.products.map(p => ({ p, ...yalcaProductMargin(p, s), ...yalcaProductMonthly(p, s) }));
  const profitMonth = all.reduce((a, r) => a + r.profit, 0);
  const negatives = all.filter(r => r.marginPct < 0);
  const avgMargin = all.length ? all.reduce((a, r) => a + r.marginPct, 0) / all.length : 0;

  renderKpiGrid('productKpis', [
    { label: 'Produtos cadastrados', value: yalcaFormatNumber(all.length) },
    { label: 'Lucro estimado por mês', value: yalcaFormatCurrencyShort(profitMonth), hint: 'margem × unidades vendidas no mês', tone: profitMonth < 0 ? 'critical' : null },
    { label: 'Margem média', value: all.length ? yalcaFormatPct(avgMargin) : '—', hint: `sua meta é ${yalcaFormatPct(target, 0)}`, tone: avgMargin < target ? 'warning' : null },
    { label: 'Produtos no prejuízo', value: String(negatives.length), hint: negatives.length ? 'cada venda tira dinheiro do caixa' : 'nenhum item no prejuízo', tone: negatives.length ? 'critical' : null },
    { label: 'Unidades vendidas/mês', value: yalcaFormatNumber(all.reduce((a, r) => a + r.units, 0)) }
  ]);

  renderRepricePanel(all, target);

  const channels = yalcaChannels(s);
  const marginByChannel = channels.map(c => {
    const items = all.filter(r => r.p.marketplace === c);
    if (!items.length) return null;
    return { label: c, value: Number((items.reduce((a, r) => a + r.marginPct, 0) / items.length).toFixed(1)), color: yalcaChannelColor(c) };
  }).filter(Boolean).sort((a, b) => b.value - a.value);

  if (marginByChannel.length) {
    yalcaRenderBarChart($('marketplaceMarginChart'), { data: marginByChannel, formatValue: (v) => yalcaFormatPct(v) });
  } else {
    yalcaEmptyChart($('marketplaceMarginChart'), 'Cadastre produtos para comparar a margem entre canais.');
  }

  renderAbc();
  renderProductsTable();
}

function renderRepricePanel(all, target) {
  const s = DATA.settings;
  const rows = all
    .filter(r => r.marginPct < target)
    .map(r => ({ r, suggested: yalcaSuggestedPrice(r.p, s, target) }))
    .filter(x => x.suggested !== null && x.suggested > x.r.p.price)
    .sort((a, b) => a.r.marginPct - b.r.marginPct);

  $('repricePanel').hidden = rows.length === 0;
  if (!rows.length) return;

  $('repriceSub').textContent = `${rows.length} produto(s) rendem menos que sua margem alvo de ${yalcaFormatPct(target, 0)}. Os preços abaixo já consideram comissão, imposto e frete.`;

  $('repriceTableBody').innerHTML = rows.map(({ r, suggested }) => `
    <tr>
      ${td('Produto', `<strong>${yalcaEscapeHtml(r.p.name)}</strong><br><span class="text-muted-num">${yalcaEscapeHtml(r.p.sku)}</span>`, '', true)}
      ${td('Canal', channelCell(r.p.marketplace))}
      ${td('Preço atual', yalcaFormatCurrency(r.p.price), 'num')}
      ${td('Margem', yalcaFormatPct(r.marginPct), 'num ' + marginClass(r.marginPct, target))}
      ${td('Preço sugerido', `<strong>${yalcaFormatCurrency(suggested)}</strong><br><span class="text-muted-num">+${yalcaFormatPct(((suggested - r.p.price) / (r.p.price || 1)) * 100)}</span>`, 'num')}
      <td class="row-actions col-actions">
        <button class="btn btn--ghost btn--sm" data-reprice="${r.p.id}" data-price="${suggested.toFixed(2)}">Aplicar</button>
      </td>
    </tr>`).join('');
}

async function onRepriceAction(e) {
  const btn = e.target.closest('[data-reprice]');
  if (!btn) return;
  const product = DATA.products.find(p => String(p.id) === btn.dataset.reprice);
  const price = Number(btn.dataset.price);
  if (!product) return;
  const ok = await confirmDialog(`Mudar o preço de “${product.name}” de ${yalcaFormatCurrency(product.price)} para ${yalcaFormatCurrency(price)}?`, { okLabel: 'Aplicar preço' });
  if (!ok) return;
  await withBusy(btn, async () => {
    const updated = await yalcaUpdateProductPrice(product.id, price);
    Object.assign(product, updated);
    toast('Preço atualizado. Lembre de mudar também no anúncio do canal.', 'success');
    refreshUI();
  }, 'Não foi possível atualizar o preço');
}

async function applyAllSuggestedPrices() {
  const s = DATA.settings;
  const target = yalcaNum(s.targetMarginPct, 20);
  const pending = DATA.products
    .map(p => ({ p, suggested: yalcaSuggestedPrice(p, s, target) }))
    .filter(x => x.suggested !== null && yalcaProductMargin(x.p, s).marginPct < target && x.suggested > x.p.price);

  if (!pending.length) return;
  const ok = await confirmDialog(
    `Aplicar o preço sugerido em ${pending.length} produto(s)? Isso altera o preço no seu painel — você ainda precisa atualizar cada anúncio no marketplace.`,
    { okLabel: 'Aplicar todos' }
  );
  if (!ok) return;

  const btn = $('applyAllPricesBtn');
  await withBusy(btn, async () => {
    for (const { p, suggested } of pending) {
      const updated = await yalcaUpdateProductPrice(p.id, Number(suggested.toFixed(2)));
      Object.assign(p, updated);
    }
    toast(`${pending.length} preço(s) atualizado(s).`, 'success');
    refreshUI();
  }, 'Não foi possível atualizar os preços');
}

function renderAbc() {
  const curve = yalcaAbcCurve(DATA.products, DATA.settings).filter(r => r.revenue > 0);
  if (!curve.length) {
    yalcaEmptyChart($('abcChart'), 'Informe o volume vendido por mês nos produtos para montar a curva ABC.');
    return;
  }
  const classes = ['A', 'B', 'C'].map(c => {
    const items = curve.filter(r => r.classe === c);
    return { label: `Classe ${c} (${items.length})`, value: items.reduce((a, r) => a + r.revenue, 0), color: c === 'A' ? YALCA_COLORS.series3 : c === 'B' ? YALCA_COLORS.series4 : YALCA_COLORS.series2 };
  }).filter(d => d.value > 0);

  yalcaRenderDonutChart($('abcChart'), {
    data: classes, formatValue: yalcaFormatCurrency,
    centerValue: String(curve.filter(r => r.classe === 'A').length), centerLabel: 'produtos classe A'
  });
}

function visibleProducts() {
  const s = DATA.settings;
  const target = yalcaNum(s.targetMarginPct, 20);
  const f = UI.filters;
  return DATA.products
    .map(p => {
      const m = yalcaProductMargin(p, s);
      const monthly = yalcaProductMonthly(p, s);
      return {
        id: p.id, product: p, sku: p.sku, name: p.name, marketplace: p.marketplace,
        cost: p.cost, price: p.price, marginPct: m.marginPct, netProfit: m.netProfit,
        profitMonth: monthly.profit, units: monthly.units, status: p.status
      };
    })
    .filter(r => f.productChannel === 'todos' || r.marketplace === f.productChannel)
    .filter(r => {
      if (f.productMargin === 'prejuizo') return r.marginPct < 0;
      if (f.productMargin === 'abaixo') return r.marginPct >= 0 && r.marginPct < target;
      if (f.productMargin === 'saudavel') return r.marginPct >= target;
      return true;
    })
    .filter(r => matchesSearch(f.productSearch, r.sku, r.name, r.marketplace));
}

function renderProductsTable() {
  paintSortHeaders('productsTable', 'products');
  const target = yalcaNum(DATA.settings.targetMarginPct, 20);
  const rows = sortRows(visibleProducts(), UI.sort.products);
  const tbody = $('productsTableBody');

  if (!rows.length) {
    tbody.innerHTML = emptyRow(9, DATA.products.length ? 'Nenhum produto com esses filtros.' : 'Nenhum produto cadastrado. Use o botão “+ Produto”.');
    $('productsFooter').innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr${r.marginPct < 0 ? ' class="row--critical"' : ''}>
      ${td('SKU', `<code>${yalcaEscapeHtml(r.sku)}</code>`)}
      ${td('Produto', yalcaEscapeHtml(r.name), '', true)}
      ${td('Canal', channelCell(r.marketplace))}
      ${td('Custo', yalcaFormatCurrency(r.cost), 'num')}
      ${td('Preço', yalcaFormatCurrency(r.price), 'num')}
      ${td('Margem', `${yalcaFormatPct(r.marginPct)}<br><span class="text-muted-num">${yalcaFormatCurrency(r.netProfit)}/un</span>`, 'num ' + marginClass(r.marginPct, target))}
      ${td('Lucro/mês', yalcaFormatCurrency(r.profitMonth), 'num ' + (r.profitMonth < 0 ? 'text-critical' : ''))}
      ${td('Anúncio', r.status === 'Ativo' ? '<span class="badge badge--ativo">Ativo</span>' : '<span class="badge badge--pausado">Pausado</span>')}
      <td class="row-actions col-actions">
        <button class="icon-btn" title="Simular preço" aria-label="Simular preço" data-action="price" data-id="${r.id}">🧮</button>
        <button class="icon-btn" title="Editar" aria-label="Editar produto" data-action="edit" data-id="${r.id}">✎</button>
        <button class="icon-btn icon-btn--danger" title="Excluir" aria-label="Excluir produto" data-action="delete" data-id="${r.id}">🗑</button>
      </td>
    </tr>`).join('');

  const totalProfit = rows.reduce((a, r) => a + r.profitMonth, 0);
  const totalRevenue = rows.reduce((a, r) => a + r.price * r.units, 0);
  $('productsFooter').innerHTML = `
    <span>${rows.length} produto(s)</span>
    <span>Receita estimada/mês: <strong>${yalcaFormatCurrency(totalRevenue)}</strong></span>
    <span>Lucro estimado/mês: <strong class="${totalProfit >= 0 ? 'text-good' : 'text-critical'}">${yalcaFormatCurrency(totalProfit)}</strong></span>`;
}

function onProductRowAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const p = DATA.products.find(x => String(x.id) === btn.dataset.id);
  if (!p) return;
  if (btn.dataset.action === 'edit') openProductModal(p);
  else if (btn.dataset.action === 'delete') deleteProductRow(p);
  else if (btn.dataset.action === 'price') loadProductIntoPricing(p.id);
}

function openProductModal(p, preset) {
  const form = $('productForm');
  form.reset();
  populateChannelSelect('prodMarketplace', false);
  $('prodId').value = p ? p.id : '';
  $('productModalTitle').textContent = p ? 'Editar produto' : (preset ? 'Novo produto (da calculadora)' : 'Novo produto');

  if (p) {
    $('prodSku').value = p.sku;
    $('prodName').value = p.name;
    $('prodMarketplace').value = p.marketplace;
    $('prodCategory').value = p.category;
    $('prodCost').value = p.cost;
    $('prodPrice').value = p.price;
    $('prodStock').value = p.stock;
    $('prodMinStock').value = p.minStock;
    $('prodSoldMonth').value = p.unitsSoldMonth;
    $('prodStatus').value = p.status;
    $('prodShipping').value = p.shippingCost === null ? '' : p.shippingCost;
    $('prodFee').value = p.feePct === null ? '' : p.feePct;
  } else {
    $('prodStock').value = 0;
    $('prodMinStock').value = 0;
    $('prodSoldMonth').value = 0;
    $('prodStatus').value = 'Ativo';
    if (preset) {
      $('prodMarketplace').value = preset.marketplace;
      $('prodCost').value = preset.cost;
      $('prodPrice').value = preset.price;
      if (preset.shipping !== undefined) $('prodShipping').value = preset.shipping;
    }
  }
  renderProductMarginPreview();
  openModal('productModal');
}

/* Mostra a margem resultante enquanto o cliente digita o preço —
   evita cadastrar um produto no prejuízo sem perceber. */
function renderProductMarginPreview() {
  const box = $('productMarginPreview');
  const cost = parseFloat($('prodCost').value);
  const price = parseFloat($('prodPrice').value);
  if (!Number.isFinite(cost) || !Number.isFinite(price) || price <= 0) { box.innerHTML = ''; return; }

  const draft = {
    marketplace: $('prodMarketplace').value,
    cost, price,
    shippingCost: $('prodShipping') && $('prodShipping').value !== '' ? parseFloat($('prodShipping').value) : null,
    feePct: $('prodFee') && $('prodFee').value !== '' ? parseFloat($('prodFee').value) : null
  };
  const m = yalcaProductMargin(draft, DATA.settings);
  const target = yalcaNum(DATA.settings.targetMarginPct, 20);
  const cls = marginClass(m.marginPct, target);
  box.innerHTML = `
    <div class="margin-preview__row"><span>Comissão do canal (${yalcaFormatPct(m.feePct)})</span><strong>− ${yalcaFormatCurrency(m.feeValue)}</strong></div>
    <div class="margin-preview__row"><span>Imposto (${yalcaFormatPct(m.taxPct)})</span><strong>− ${yalcaFormatCurrency(m.taxValue)}</strong></div>
    <div class="margin-preview__row"><span>Frete</span><strong>− ${yalcaFormatCurrency(m.shipping)}</strong></div>
    <div class="margin-preview__row margin-preview__row--total"><span>Sobra por unidade</span><strong class="${cls}">${yalcaFormatCurrency(m.netProfit)} · ${yalcaFormatPct(m.marginPct)}</strong></div>`;
}

async function submitProduct(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const id = $('prodId').value;
  const record = {
    sku: $('prodSku').value.trim(),
    name: $('prodName').value.trim(),
    marketplace: $('prodMarketplace').value,
    category: $('prodCategory').value.trim(),
    cost: parseFloat($('prodCost').value) || 0,
    price: parseFloat($('prodPrice').value) || 0,
    stock: parseInt($('prodStock').value, 10) || 0,
    minStock: parseInt($('prodMinStock').value, 10) || 0,
    unitsSoldMonth: parseInt($('prodSoldMonth').value, 10) || 0,
    status: $('prodStatus').value,
    shippingCost: $('prodShipping').value === '' ? null : parseFloat($('prodShipping').value),
    feePct: $('prodFee').value === '' ? null : parseFloat($('prodFee').value)
  };

  await withBusy(btn, async () => {
    if (id) {
      const updated = await yalcaUpdateProduct(id, record);
      const i = DATA.products.findIndex(x => String(x.id) === String(id));
      if (i >= 0) DATA.products[i] = updated;
      toast('Produto atualizado.', 'success');
    } else {
      DATA.products.push(await yalcaAddProduct(record));
      toast('Produto cadastrado.', 'success');
    }
    closeModal('productModal');
    refreshUI();
  }, 'Não foi possível salvar o produto');
}

async function deleteProductRow(p) {
  const ok = await confirmDialog(`Excluir o produto “${p.name}” (${p.sku})?`, { danger: true, okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await yalcaDeleteProduct(p.id);
    DATA.products = DATA.products.filter(x => String(x.id) !== String(p.id));
    toast('Produto excluído.', 'success');
    refreshUI();
  } catch (err) {
    toast('Não foi possível excluir: ' + err.message, 'error');
  }
}

function exportProductsCsv() {
  const s = DATA.settings;
  const rows = [['sku', 'produto', 'canal', 'categoria', 'custo', 'preco', 'margem_pct', 'lucro_unidade', 'estoque', 'estoque_minimo', 'vendidos_mes', 'situacao']];
  sortRows(visibleProducts(), UI.sort.products).forEach(r => {
    const m = yalcaProductMargin(r.product, s);
    rows.push([r.sku, r.name, r.marketplace, r.product.category, r.cost.toFixed(2).replace('.', ','), r.price.toFixed(2).replace('.', ','),
      m.marginPct.toFixed(1).replace('.', ','), m.netProfit.toFixed(2).replace('.', ','), r.product.stock, r.product.minStock, r.units, r.status]);
  });
  downloadCsv('produtos-yalca.csv', rows);
  toast(`${rows.length - 1} produto(s) exportado(s).`, 'success');
}

/* ---------- 5.4 Estoque ---------- */

function initStockSection() {
  $('stockFilter').innerHTML = '<option value="todos">Todos os status</option>' +
    YALCA_STOCK_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');
  $('stockFilter').addEventListener('change', () => {
    UI.filters.stockStatus = $('stockFilter').value;
    renderStockTable();
  });
  $('stockSearch').addEventListener('input', debounce(() => {
    UI.filters.stockSearch = $('stockSearch').value;
    renderStockTable();
  }, 200));
  $('exportRestockBtn').addEventListener('click', exportRestockCsv);
  $('stockTableBody').addEventListener('click', onStockRowAction);
}

function stockRows() {
  const s = DATA.settings;
  return DATA.products.map(p => {
    const cov = yalcaStockCoverage(p, s);
    return {
      id: p.id, product: p, sku: p.sku, name: p.name, marketplace: p.marketplace,
      stock: yalcaNum(p.stock), minStock: yalcaNum(p.minStock), unitsSoldMonth: yalcaNum(p.unitsSoldMonth),
      daysLeft: cov.daysLeft, suggestedPurchase: cov.suggestedPurchase,
      purchaseCost: cov.suggestedPurchase * yalcaNum(p.cost),
      capital: yalcaNum(p.cost) * yalcaNum(p.stock),
      statusCalc: yalcaStockStatus(p, s)
    };
  });
}

function renderEstoque() {
  $('stockFilter').value = UI.filters.stockStatus;
  const rows = stockRows();
  const s = DATA.settings;

  const esgotado = rows.filter(r => r.statusCalc === 'Esgotado').length;
  const critico = rows.filter(r => r.statusCalc === 'Crítico').length;
  const parado = rows.filter(r => ['Parado', 'Excesso'].includes(r.statusCalc));
  const capitalTotal = rows.reduce((a, r) => a + r.capital, 0);
  const capitalParado = parado.reduce((a, r) => a + r.capital, 0);

  renderKpiGrid('stockKpis', [
    { label: 'Esgotados', value: String(esgotado), hint: esgotado ? 'anúncios podem perder posição' : 'nenhum item zerado', tone: esgotado ? 'critical' : null },
    { label: 'Acabando antes da reposição', value: String(critico), hint: `prazo de reposição: ${yalcaNum(s.stockLeadTimeDays, 15)} dias`, tone: critico ? 'warning' : null },
    { label: 'Capital em estoque', value: yalcaFormatCurrencyShort(capitalTotal), hint: 'custo × unidades de todos os itens' },
    { label: 'Capital parado', value: yalcaFormatCurrencyShort(capitalParado), hint: `${parado.length} item(ns) com giro baixo`, tone: capitalParado > capitalTotal * 0.4 ? 'warning' : null },
    { label: 'Compra sugerida', value: yalcaFormatCurrencyShort(rows.reduce((a, r) => a + r.purchaseCost, 0)), hint: 'para cobrir os próximos ' + yalcaNum(s.stockCoverDays, 30) + ' dias' }
  ]);

  renderRestockPanel(rows);
  renderStockLegend();
  renderStockTable();
}

function renderRestockPanel(rows) {
  const list = rows.filter(r => r.suggestedPurchase > 0 && r.unitsSoldMonth > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  $('restockPanel').hidden = list.length === 0;
  if (!list.length) return;

  const s = DATA.settings;
  $('restockSub').textContent = `Cobertura desejada de ${yalcaNum(s.stockCoverDays, 30)} dias, considerando ${yalcaNum(s.stockLeadTimeDays, 15)} dias de prazo de reposição.`;

  $('restockTableBody').innerHTML = list.map(r => `
    <tr>
      ${td('Produto', `<strong>${yalcaEscapeHtml(r.name)}</strong><br><span class="text-muted-num">${yalcaEscapeHtml(r.sku)} · ${yalcaEscapeHtml(r.marketplace)}</span>`, '', true)}
      ${td('Estoque', yalcaFormatNumber(r.stock), 'num')}
      ${td('Acaba em', daysLeftLabel(r.daysLeft), 'num ' + daysLeftClass(r.daysLeft, s))}
      ${td('Comprar', `<strong>${yalcaFormatNumber(r.suggestedPurchase)}</strong> un`, 'num')}
      ${td('Custo da compra', yalcaFormatCurrency(r.purchaseCost), 'num')}
      ${td('Status', stockBadge(r.statusCalc))}
    </tr>`).join('');

  $('restockFooter').innerHTML = `
    <span>${list.length} item(ns) para repor</span>
    <span>Investimento total: <strong>${yalcaFormatCurrency(list.reduce((a, r) => a + r.purchaseCost, 0))}</strong></span>`;
}

function daysLeftLabel(days) {
  if (!Number.isFinite(days)) return 'sem giro';
  if (days < 1) return 'hoje';
  if (days > 365) return '+1 ano';
  return `${Math.floor(days)} dia(s)`;
}

function daysLeftClass(days, settings) {
  if (!Number.isFinite(days)) return 'text-muted-num';
  const lead = yalcaNum(settings.stockLeadTimeDays, 15);
  if (days <= lead) return 'text-critical';
  if (days <= lead * 2) return 'text-warning';
  return '';
}

const STOCK_BADGE_CLASS = { 'OK': 'ok', 'Baixo': 'baixo', 'Esgotado': 'esgotado', 'Parado': 'parado', 'Crítico': 'critico', 'Excesso': 'excesso' };

function stockBadge(status) {
  return `<span class="badge badge--${STOCK_BADGE_CLASS[status] || 'ok'}">${yalcaEscapeHtml(status)}</span>`;
}

function renderStockLegend() {
  const s = DATA.settings;
  const lead = yalcaNum(s.stockLeadTimeDays, 15);
  const items = [
    ['Esgotado', 'Sem unidades. Além de perder venda, o anúncio perde posição no canal.'],
    ['Crítico', `O estoque acaba em menos de ${lead} dias — mesmo pedindo hoje ao fornecedor, vai faltar produto.`],
    ['Baixo', 'Abaixo do estoque mínimo que você definiu. Planeje a reposição.'],
    ['OK', 'Estoque saudável para o ritmo de venda atual.'],
    ['Excesso', 'Estoque muito acima do necessário: dinheiro parado que poderia estar girando.'],
    ['Parado', 'Estoque alto e quase nenhuma venda. Considere promoção, kit ou liquidação.']
  ];
  $('stockLegend').innerHTML = items.map(([status, desc]) => `
    <div class="legend-item">${stockBadge(status)}<span>${yalcaEscapeHtml(desc)}</span></div>`).join('');
}

function renderStockTable() {
  paintSortHeaders('stockTable', 'stock');
  const f = UI.filters;
  const s = DATA.settings;
  const rows = sortRows(
    stockRows()
      .filter(r => f.stockStatus === 'todos' || r.statusCalc === f.stockStatus)
      .filter(r => matchesSearch(f.stockSearch, r.sku, r.name, r.marketplace)),
    UI.sort.stock
  );
  const tbody = $('stockTableBody');

  if (!rows.length) {
    tbody.innerHTML = emptyRow(8, DATA.products.length ? 'Nenhum produto com esses filtros.' : 'Cadastre produtos para acompanhar o estoque.');
    $('stockFooter').innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr${['Esgotado', 'Crítico'].includes(r.statusCalc) ? ' class="row--critical"' : ''}>
      ${td('SKU', `<code>${yalcaEscapeHtml(r.sku)}</code>`)}
      ${td('Produto', yalcaEscapeHtml(r.name), '', true)}
      ${td('Estoque', `${yalcaFormatNumber(r.stock)}<br><span class="text-muted-num">mín. ${yalcaFormatNumber(r.minStock)}</span>`, 'num')}
      ${td('Acaba em', daysLeftLabel(r.daysLeft), 'num ' + daysLeftClass(r.daysLeft, s))}
      ${td('Vendas/mês', yalcaFormatNumber(r.unitsSoldMonth), 'num')}
      ${td('Capital parado', yalcaFormatCurrency(r.capital), 'num')}
      ${td('Status', stockBadge(r.statusCalc))}
      <td class="row-actions col-actions">
        <button class="icon-btn" title="Editar produto" aria-label="Editar produto" data-action="edit" data-id="${r.id}">✎</button>
      </td>
    </tr>`).join('');

  $('stockFooter').innerHTML = `
    <span>${rows.length} produto(s)</span>
    <span>Capital nestes itens: <strong>${yalcaFormatCurrency(rows.reduce((a, r) => a + r.capital, 0))}</strong></span>`;
}

function onStockRowAction(e) {
  const btn = e.target.closest('[data-action="edit"]');
  if (!btn) return;
  const p = DATA.products.find(x => String(x.id) === btn.dataset.id);
  if (p) openProductModal(p);
}

function exportRestockCsv() {
  const rows = [['sku', 'produto', 'canal', 'estoque_atual', 'dias_restantes', 'comprar_unidades', 'custo_compra']];
  stockRows().filter(r => r.suggestedPurchase > 0 && r.unitsSoldMonth > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .forEach(r => rows.push([r.sku, r.name, r.marketplace, r.stock,
      Number.isFinite(r.daysLeft) ? Math.floor(r.daysLeft) : '', r.suggestedPurchase, r.purchaseCost.toFixed(2).replace('.', ',')]));
  downloadCsv('lista-de-reposicao-yalca.csv', rows);
  toast('Lista de reposição exportada.', 'success');
}

/* ---------- 5.5 Fluxo de caixa ---------- */

function initCashflowSection() {
  $('addPlannedBtn').addEventListener('click', openPlannedModal);
  $('plannedForm').addEventListener('submit', submitPlanned);
  $('plannedTableBody').addEventListener('click', onPlannedRowAction);
}

function renderCaixa() {
  const cash = yalcaCashflowProjection(DATA, 6);
  const lowest = cash.projection.reduce((min, p) => p.saldo < min.saldo ? p : min, cash.projection[0]);
  const last = cash.projection[cash.projection.length - 1];

  renderKpiGrid('cashflowKpis', [
    { label: 'Saldo atual em caixa', value: yalcaFormatCurrencyShort(cash.currentBalance), hint: 'informado em Configurações' },
    { label: 'Resultado recorrente/mês', value: yalcaFormatCurrencyShort(cash.recurringNet), hint: 'mediana dos últimos meses fechados', tone: cash.recurringNet < 0 ? 'critical' : null },
    { label: `Saldo em ${yalcaMonthLabel(last.key + '-01')}`, value: yalcaFormatCurrencyShort(last.saldo), tone: last.saldo < 0 ? 'critical' : null },
    { label: 'Mês mais apertado', value: yalcaMonthLabel(lowest.key + '-01'), hint: yalcaFormatCurrency(lowest.saldo), tone: lowest.saldo < 0 ? 'critical' : null }
  ]);

  const points = [{ label: yalcaMonthLabel(cash.currentKey + '-01'), value: cash.currentBalance }]
    .concat(cash.projection.map(p => ({ label: yalcaMonthLabel(p.key + '-01'), value: p.saldo })));

  yalcaRenderLineChart($('cashflowChart'), {
    series: [{ name: 'Saldo projetado', color: cash.projection.some(p => p.saldo < 0) ? YALCA_COLORS.series2 : YALCA_COLORS.series3, data: points, area: true }],
    allowNegative: true,
    formatValue: yalcaFormatCurrency,
    formatAxis: yalcaFormatCurrencyShort
  });

  const negative = cash.projection.find(p => p.saldo < 0);
  $('cashflowWarning').innerHTML = negative
    ? `<div class="notice notice--critical"><strong>Atenção ao caixa.</strong><span>Na projeção atual, o saldo fica negativo em ${yalcaMonthLabelLong(negative.key)} (${yalcaFormatCurrency(negative.saldo)}). Antecipar recebíveis, adiar uma compra de estoque ou cortar despesa recorrente resolve.</span></div>`
    : '';

  $('cashflowTableBody').innerHTML = cash.projection.map(p => `
    <tr${p.saldo < 0 ? ' class="row--critical"' : ''}>
      ${td('Mês', yalcaMonthLabelLong(p.key), '', true)}
      ${td('Resultado recorrente', yalcaFormatCurrency(cash.recurringNet), 'num ' + (cash.recurringNet < 0 ? 'text-critical' : 'text-good'))}
      ${td('Lançamentos previstos', p.planned ? yalcaFormatCurrency(p.planned) : '—', 'num ' + (p.planned < 0 ? 'text-critical' : p.planned > 0 ? 'text-good' : ''))}
      ${td('Saldo no fim do mês', yalcaFormatCurrency(p.saldo), 'num ' + (p.saldo < 0 ? 'text-critical' : ''))}
    </tr>`).join('');

  renderPlannedTable();
}

function renderPlannedTable() {
  const rows = [...DATA.plannedEntries].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tbody = $('plannedTableBody');
  if (!rows.length) {
    tbody.innerHTML = emptyRow(5, 'Nenhum lançamento futuro cadastrado. Cadastre compras de estoque, parcelas e recebimentos já previstos.');
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr>
      ${td('Data', yalcaFormatDate(e.date))}
      ${td('Descrição', yalcaEscapeHtml(e.description), '', true)}
      ${td('Repetição', yalcaNum(e.repeatMonths) > 0 ? `+${yalcaNum(e.repeatMonths)} mês(es)` : '<span class="text-muted-num">única</span>')}
      ${td('Valor', `${yalcaNum(e.amount) >= 0 ? '+' : '−'} ${yalcaFormatCurrency(Math.abs(yalcaNum(e.amount)))}`, 'num ' + (yalcaNum(e.amount) >= 0 ? 'text-good' : 'text-critical'))}
      <td class="row-actions col-actions">
        <button class="icon-btn icon-btn--danger" title="Excluir" aria-label="Excluir lançamento futuro" data-action="delete" data-id="${e.id}">🗑</button>
      </td>
    </tr>`).join('');
}

function openPlannedModal() {
  const form = $('plannedForm');
  form.reset();
  $('plDate').value = yalcaTodayKey();
  $('plRepeat').value = 0;
  openModal('plannedModal');
}

async function submitPlanned(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const sign = e.target.querySelector('input[name="plType"]:checked').value === 'saida' ? -1 : 1;
  const entry = {
    date: $('plDate').value,
    description: $('plDescription').value.trim(),
    amount: sign * Math.abs(parseFloat($('plAmount').value) || 0),
    repeatMonths: parseInt($('plRepeat').value, 10) || 0
  };
  await withBusy(btn, async () => {
    DATA.plannedEntries.push(await yalcaAddPlannedEntry(entry));
    closeModal('plannedModal');
    toast('Lançamento futuro salvo.', 'success');
    refreshUI();
  }, 'Não foi possível salvar');
}

async function onPlannedRowAction(e) {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;
  const entry = DATA.plannedEntries.find(x => String(x.id) === btn.dataset.id);
  if (!entry) return;
  const ok = await confirmDialog(`Excluir “${entry.description}”?`, { danger: true, okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await yalcaDeletePlannedEntry(entry.id);
    DATA.plannedEntries = DATA.plannedEntries.filter(x => String(x.id) !== String(entry.id));
    toast('Lançamento futuro excluído.', 'success');
    refreshUI();
  } catch (err) {
    toast('Não foi possível excluir: ' + err.message, 'error');
  }
}

/* ============================================================
   6. PRECIFICAÇÃO
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

let PRICING_VARIANTS = [];
let FOCUSED_VARIANT_KEY = null;

/* Além do catálogo dos grandes marketplaces, cada canal próprio que o
   cliente cadastrou entra na comparação com a taxa que ele configurou. */
function buildPricingVariants() {
  const base = PRICING_VARIANTS_DEFAULT.map(v => ({ ...v, brackets: v.brackets.map(b => ({ ...b })) }));
  const known = new Set(base.map(v => v.channel));
  yalcaChannels(DATA.settings).forEach(channel => {
    if (known.has(channel)) return;
    base.push({
      key: 'custom_' + channel.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: channel, channel, planLabel: '',
      brackets: [{ maxPrice: Infinity, pct: yalcaNum(DATA.settings.marketplaceFees[channel]), fixedFee: 0 }],
      sourceUrl: null, verified: false, custom: true,
      note: 'Canal cadastrado por você. A comissão vem de Configurações → Canais de venda; ajuste aqui se este canal tiver faixas ou taxa fixa.'
    });
  });

  const overrides = YALCA_SCHEMA.settingsV7 ? DATA.settings.pricingOverrides : yalcaLocalPricingOverrides();
  if (overrides) {
    base.forEach(v => {
      const saved = overrides[v.key];
      if (saved && Array.isArray(saved) && saved.length === v.brackets.length) {
        v.brackets.forEach((b, i) => {
          if (Number.isFinite(saved[i].pct)) b.pct = saved[i].pct;
          if (Number.isFinite(saved[i].fixedFee)) b.fixedFee = saved[i].fixedFee;
        });
        v.customized = true;
      }
    });
  }
  return base;
}

function initPricingSection() {
  ['pCost', 'pShipping', 'pTax', 'pMargin', 'pManualPrice'].forEach(id =>
    $(id).addEventListener('input', debounce(recalcPricing, 120))
  );

  $('toggleFeeEditor').addEventListener('click', () => {
    const editor = $('feeEditor');
    editor.hidden = !editor.hidden;
    $('toggleFeeEditor').setAttribute('aria-expanded', String(!editor.hidden));
    $('toggleFeeEditor').textContent = editor.hidden ? '⚙ Ajustar as taxas dos canais' : '⚙ Ocultar o ajuste de taxas';
  });

  $('pricingComparisonBody').addEventListener('click', (e) => {
    const save = e.target.closest('[data-action="saveAsProduct"]');
    if (save) {
      openProductModal(null, { marketplace: save.dataset.channel, price: Number(save.dataset.price), cost: Number(save.dataset.cost), shipping: Number(save.dataset.shipping) });
      return;
    }
    const row = e.target.closest('[data-variant]');
    if (row) { FOCUSED_VARIANT_KEY = row.dataset.variant; recalcPricing(); }
  });

  $('pLoadProduct').addEventListener('change', () => {
    if ($('pLoadProduct').value) loadProductIntoPricing($('pLoadProduct').value, true);
  });
}

function renderPrecificacao() {
  PRICING_VARIANTS = buildPricingVariants();
  $('pTax').value = yalcaNum(DATA.settings.defaultTaxPct, 6);
  $('pShipping').value = yalcaNum(DATA.settings.defaultShippingCost, 12);
  if (YALCA_SCHEMA.settingsV7) $('pMargin').value = yalcaNum(DATA.settings.targetMarginPct, 20);

  $('pLoadProduct').innerHTML = '<option value="">— preencher manualmente —</option>' +
    DATA.products.map(p => `<option value="${p.id}">${yalcaEscapeHtml(p.sku)} · ${yalcaEscapeHtml(p.name)}</option>`).join('');

  renderFeeEditor();
  recalcPricing();
}

function loadProductIntoPricing(productId, keepSection) {
  const p = DATA.products.find(x => String(x.id) === String(productId));
  if (!p) return;
  if (!keepSection) {
    UI.dirty.add('precificacao');
    goToSection('precificacao');
  }
  $('pLoadProduct').value = p.id;
  $('pCost').value = p.cost;
  $('pShipping').value = yalcaProductShipping(p, DATA.settings);
  $('pTax').value = yalcaNum(DATA.settings.defaultTaxPct, 6);
  $('pManualPrice').value = p.price;
  recalcPricing();
  toast(`Carregado: ${p.name}. A tabela mostra a margem deste preço em cada canal.`, 'info');
}

function pricingBracketRangeLabel(brackets, index) {
  const min = index === 0 ? 0 : brackets[index - 1].maxPrice;
  const b = brackets[index];
  if (b.maxPrice === Infinity) return `Acima de ${yalcaFormatCurrency(min)}`;
  return index === 0 ? `Até ${yalcaFormatCurrency(b.maxPrice)}` : `${yalcaFormatCurrency(min)} a ${yalcaFormatCurrency(b.maxPrice)}`;
}

function renderFeeEditor() {
  const editor = $('feeEditor');
  editor.innerHTML = PRICING_VARIANTS.map(v => {
    const fields = v.brackets.map((b, i) => `
      <div><label>${pricingBracketRangeLabel(v.brackets, i)} — comissão (%)</label><input type="number" inputmode="decimal" min="0" step="0.1" value="${b.pct}" data-field="pct" data-bracket-index="${i}"></div>
      <div><label>Taxa fixa nessa faixa (R$)</label><input type="number" inputmode="decimal" min="0" step="0.01" value="${b.fixedFee || 0}" data-field="fixedFee" data-bracket-index="${i}"></div>
    `).join('');
    const source = v.sourceUrl ? `<a href="${v.sourceUrl}" target="_blank" rel="noopener">Ver fonte oficial ↗</a>` : '';
    const badge = v.custom
      ? '<span class="badge badge--pausado">Canal seu</span>'
      : (v.verified ? '<span class="badge badge--ativo">Confirmado na fonte oficial</span>' : '<span class="badge badge--pending">Não confirmado ao vivo</span>');
    return `
      <div class="fee-editor-row" data-key="${v.key}">
        <div class="fee-editor-row__title">${yalcaEscapeHtml(v.channel)}${v.planLabel ? ' — ' + yalcaEscapeHtml(v.planLabel) : ''} ${badge}</div>
        <div class="fee-editor-row__fields">${fields}</div>
        <details class="fee-editor-row__note"><summary>Como chegamos nesses números</summary><p>${yalcaEscapeHtml(v.note)} ${source}</p></details>
      </div>`;
  }).join('') + `
    <div class="fee-editor__actions">
      <button type="button" class="btn btn--primary btn--sm" id="saveFeeEditor">Salvar minhas taxas</button>
      <button type="button" class="btn btn--ghost btn--sm" id="resetFeeEditor">Restaurar padrão</button>
    </div>`;

  $$('input', editor).forEach(input => {
    input.addEventListener('input', () => {
      const key = input.closest('.fee-editor-row').dataset.key;
      const variant = PRICING_VARIANTS.find(v => v.key === key);
      variant.brackets[Number(input.dataset.bracketIndex)][input.dataset.field] = parseFloat(input.value) || 0;
      recalcPricing();
    });
  });

  $('saveFeeEditor').addEventListener('click', async () => {
    const overrides = {};
    PRICING_VARIANTS.forEach(v => { overrides[v.key] = v.brackets.map(b => ({ pct: b.pct, fixedFee: b.fixedFee || 0 })); });
    try {
      await yalcaSavePricingOverrides(overrides);
      DATA.settings.pricingOverrides = overrides;
      toast(YALCA_SCHEMA.settingsV7 ? 'Taxas salvas na sua conta.' : 'Taxas salvas neste navegador (rode a migração v7 para salvar na conta).', 'success');
    } catch (err) {
      toast('Não foi possível salvar as taxas: ' + err.message, 'error');
    }
  });

  $('resetFeeEditor').addEventListener('click', async () => {
    const ok = await confirmDialog('Restaurar todas as taxas para os valores padrão pesquisados pela Yalca?', { okLabel: 'Restaurar' });
    if (!ok) return;
    DATA.settings.pricingOverrides = null;
    try { localStorage.removeItem('yalca_pricing_overrides'); } catch (e) { /* modo privado */ }
    await yalcaSavePricingOverrides(null);
    PRICING_VARIANTS = buildPricingVariants();
    renderFeeEditor();
    recalcPricing();
    toast('Taxas restauradas.', 'success');
  });
}

function getBracketFor(variant, price) {
  return variant.brackets.find(b => price <= b.maxPrice) || variant.brackets[variant.brackets.length - 1];
}

function feeForPrice(variant, price) {
  const b = getBracketFor(variant, price);
  return price * (b.pct / 100) + (b.fixedFee || 0);
}

/* Procura a faixa em que o preço resultante realmente cai — sem isso o
   cálculo devolveria um preço de uma faixa com taxa de outra. */
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
  const last = variant.brackets[variant.brackets.length - 1];
  const denom = 1 - (last.pct + tax + marginDesired) / 100;
  if (denom <= 0) return null;
  return (cost + shipping + (last.fixedFee || 0)) / denom;
}

function calcPricingVariant(variant, inputs) {
  const { cost, shipping, tax, marginDesired, manualPrice } = inputs;

  const breakdown = (price) => {
    const feeValue = feeForPrice(variant, price);
    const taxValue = price * (tax / 100);
    const netProfit = price - cost - shipping - feeValue - taxValue;
    return {
      key: variant.key, label: variant.label, channel: variant.channel, planLabel: variant.planLabel,
      verified: variant.verified, custom: variant.custom, sourceUrl: variant.sourceUrl,
      price, feeValue, taxValue, netProfit,
      marginPct: price > 0 ? (netProfit / price) * 100 : 0
    };
  };

  if (manualPrice !== null && manualPrice > 0) return { mode: 'reverse', ...breakdown(manualPrice) };

  const price = solveForwardPrice(variant, cost, shipping, tax, marginDesired);
  if (price === null) return { mode: 'invalid', key: variant.key, label: variant.label };
  return { mode: 'forward', ...breakdown(price) };
}

function recalcPricing() {
  const body = $('pricingComparisonBody');
  if (!body || !PRICING_VARIANTS.length) return;

  const inputs = {
    cost: parseFloat($('pCost').value) || 0,
    shipping: parseFloat($('pShipping').value) || 0,
    tax: parseFloat($('pTax').value) || 0,
    marginDesired: parseFloat($('pMargin').value) || 0,
    manualPrice: $('pManualPrice').value !== '' ? parseFloat($('pManualPrice').value) : null
  };

  const results = PRICING_VARIANTS.map(v => calcPricingVariant(v, inputs));
  const valid = results.filter(r => r.mode !== 'invalid');

  if (!valid.length) {
    body.innerHTML = emptyRow(5, 'A soma de comissão, imposto e margem desejada passa de 100% em todas as opções. Reduza a margem desejada ou o imposto.');
    $('pricingWaterfall').innerHTML = '';
    $('pricingBreakdown').innerHTML = '';
    $('pricingDetailTitle').textContent = 'Detalhamento';
    $('pricingDetailConfidence').innerHTML = '';
    return;
  }

  const bestMargin = Math.max(...valid.map(r => r.marginPct));
  const bestKey = valid.find(r => r.marginPct === bestMargin).key;
  const cheapestPrice = Math.min(...valid.map(r => r.price));
  const cheapestKey = valid.find(r => r.price === cheapestPrice).key;

  if (!FOCUSED_VARIANT_KEY || !valid.some(r => r.key === FOCUSED_VARIANT_KEY)) FOCUSED_VARIANT_KEY = bestKey;

  const sorted = [...valid].sort((a, b) => inputs.manualPrice ? b.marginPct - a.marginPct : a.price - b.price);

  body.innerHTML = sorted.map(r => {
    const tags = [];
    if (r.key === bestKey) tags.push('<span class="best-tag">Melhor margem</span>');
    if (r.key === cheapestKey && !inputs.manualPrice && r.key !== bestKey) tags.push('<span class="best-tag best-tag--alt">Preço mais competitivo</span>');
    return `
    <tr class="${r.key === FOCUSED_VARIANT_KEY ? 'comparison-row--selected' : ''}" data-variant="${r.key}" tabindex="0">
      ${td('Canal', `<div class="marketplace-cell">${channelBadge(r.channel)}<div class="marketplace-cell__text">
          <strong>${yalcaEscapeHtml(r.channel)}${!r.verified && !r.custom ? ' <span class="warn-dot" title="Taxa não confirmada ao vivo na fonte oficial">⚠</span>' : ''}</strong>
          ${r.planLabel ? `<span class="marketplace-cell__plan">${yalcaEscapeHtml(r.planLabel)}</span>` : ''}
          ${tags.join('')}
        </div></div>`, '', true)}
      ${td('Preço', `<strong>${yalcaFormatCurrency(r.price)}</strong>`, 'num')}
      ${td('Lucro', yalcaFormatCurrency(r.netProfit), 'num ' + (r.netProfit < 0 ? 'text-critical' : ''))}
      ${td('Margem', yalcaFormatPct(r.marginPct), 'num ' + marginClass(r.marginPct, yalcaNum(DATA.settings.targetMarginPct, 20)))}
      <td class="row-actions col-actions">
        <button class="icon-btn" title="Cadastrar como produto" aria-label="Cadastrar como produto" data-action="saveAsProduct" data-channel="${yalcaEscapeHtml(r.channel)}" data-price="${r.price.toFixed(2)}" data-cost="${inputs.cost}" data-shipping="${inputs.shipping}">＋</button>
      </td>
    </tr>`;
  }).join('');

  renderPricingDetail(results.find(r => r.key === FOCUSED_VARIANT_KEY), inputs);
}

function renderPricingDetail(result, inputs) {
  $('pricingDetailTitle').textContent = 'Detalhamento — ' + result.label;

  if (result.mode === 'invalid') {
    $('pricingDetailConfidence').innerHTML = '';
    $('pricingWaterfall').innerHTML = '<p class="alert-empty text-critical">Configuração impossível para esta opção: comissão + imposto + margem desejada passa de 100%.</p>';
    $('pricingBreakdown').innerHTML = '';
    return;
  }

  $('pricingDetailConfidence').innerHTML = result.custom
    ? '<span class="badge badge--pausado">Canal cadastrado por você</span>'
    : (result.verified
      ? '<span class="badge badge--ativo">Taxa confirmada na fonte oficial</span>'
      : `<span class="badge badge--pending">Taxa não confirmada ao vivo</span>${result.sourceUrl ? ` <a href="${result.sourceUrl}" target="_blank" rel="noopener" class="source-link">conferir fonte ↗</a>` : ''}`);

  yalcaRenderWaterfallBar($('pricingWaterfall'), {
    segments: [
      { label: 'Custo do produto', value: inputs.cost, color: YALCA_WATERFALL_COLORS.custo },
      { label: 'Frete', value: inputs.shipping, color: YALCA_WATERFALL_COLORS.frete },
      { label: 'Comissão do canal', value: result.feeValue, color: YALCA_WATERFALL_COLORS.taxa },
      { label: 'Imposto', value: result.taxValue, color: YALCA_WATERFALL_COLORS.imposto },
      { label: 'Lucro líquido', value: Math.max(result.netProfit, 0), color: YALCA_WATERFALL_COLORS.lucro }
    ],
    formatValue: yalcaFormatCurrency
  });

  const tone = result.marginPct < 0 ? 'text-critical' : (result.marginPct < yalcaNum(DATA.settings.targetMarginPct, 20) ? 'text-warning' : 'text-good');
  $('pricingBreakdown').innerHTML = `
    <div class="calc-result__row"><span>Custo do produto</span><strong>${yalcaFormatCurrency(inputs.cost)}</strong></div>
    <div class="calc-result__row"><span>Frete</span><strong>${yalcaFormatCurrency(inputs.shipping)}</strong></div>
    <div class="calc-result__row"><span>Comissão do canal</span><strong>${yalcaFormatCurrency(result.feeValue)}</strong></div>
    <div class="calc-result__row"><span>Imposto</span><strong>${yalcaFormatCurrency(result.taxValue)}</strong></div>
    <div class="calc-result__row"><span>Lucro líquido</span><strong class="${tone}">${yalcaFormatCurrency(result.netProfit)}</strong></div>
    <div class="calc-result__row total"><span>Preço de venda${result.mode === 'reverse' ? ' (informado)' : ' sugerido'}</span><strong>${yalcaFormatCurrency(result.price)}</strong></div>
    <div class="calc-result__row"><span>Margem líquida</span><strong class="${tone}">${yalcaFormatPct(result.marginPct)}</strong></div>`;
}

/* ============================================================
   7. AÇÕES GLOBAIS
   ============================================================ */

function initGlobalActions() {
  $('logoutBtn').addEventListener('click', doLogout);
  $('refreshBtn').addEventListener('click', reloadData);
  $('quickAddBtn').addEventListener('click', () => openModal('quickAddModal'));
  $('seedDemoBtn').addEventListener('click', seedDemo);
  $('resetDemoBtn').addEventListener('click', seedDemo);
  $('clearDataBtn').addEventListener('click', clearData);
  $('backupBtn').addEventListener('click', downloadBackup);

  $$('#quickAddModal [data-quick]').forEach(btn => btn.addEventListener('click', () => {
    closeModal('quickAddModal');
    setTimeout(() => {
      if (btn.dataset.quick === 'transaction') openTransactionModal();
      if (btn.dataset.quick === 'product') openProductModal();
      if (btn.dataset.quick === 'planned') openPlannedModal();
    }, 120);
  }));
}

async function reloadData() {
  const btn = $('refreshBtn');
  btn.classList.add('is-spinning');
  try {
    DATA = await yalcaFetchAll(PROFILE);
    refreshUI();
    toast('Dados atualizados.', 'success');
  } catch (err) {
    toast('Não foi possível atualizar: ' + err.message, 'error');
  } finally {
    btn.classList.remove('is-spinning');
  }
}

async function seedDemo() {
  const isEmpty = DATA.products.length === 0 && DATA.transactions.length === 0;
  const message = isEmpty
    ? 'Vamos preencher sua conta com produtos e lançamentos de exemplo para você conhecer as ferramentas. Você pode apagar tudo depois.'
    : 'Isso apaga TODOS os seus produtos, lançamentos e lançamentos futuros e coloca dados de exemplo no lugar. Não dá para desfazer.';
  const ok = await confirmDialog(message, { danger: !isEmpty, okLabel: isEmpty ? 'Carregar exemplo' : 'Substituir tudo' });
  if (!ok) return;

  try {
    toast('Preparando os dados…', 'info');
    if (!isEmpty) await yalcaClearAllData();
    await yalcaSeedDemoData();
    DATA = await yalcaFetchAll(PROFILE);
    refreshUI();
    toast('Dados de exemplo carregados.', 'success');
  } catch (err) {
    toast('Não foi possível carregar os dados de exemplo: ' + err.message, 'error');
  }
}

async function clearData() {
  const ok = await confirmDialog(
    'Isso apaga todos os seus produtos, lançamentos e lançamentos futuros desta conta. Suas configurações são mantidas. Não dá para desfazer.',
    { danger: true, okLabel: 'Apagar tudo' }
  );
  if (!ok) return;
  try {
    await yalcaClearAllData();
    DATA = await yalcaFetchAll(PROFILE);
    refreshUI();
    toast('Dados apagados.', 'success');
  } catch (err) {
    toast('Não foi possível apagar: ' + err.message, 'error');
  }
}

function downloadBackup() {
  const s = DATA.settings;
  const rows = [['secao', 'campo1', 'campo2', 'campo3', 'campo4', 'campo5', 'campo6', 'campo7', 'campo8']];
  rows.push(['CONFIG', 'nome_loja', s.clientName, 'saldo_caixa', s.cashBalance, 'imposto_pct', s.defaultTaxPct, 'frete_padrao', s.defaultShippingCost]);
  rows.push(['PRODUTOS', 'sku', 'nome', 'canal', 'custo', 'preco', 'estoque', 'estoque_min', 'vendidos_mes']);
  DATA.products.forEach(p => rows.push(['PRODUTO', p.sku, p.name, p.marketplace, p.cost, p.price, p.stock, p.minStock, p.unitsSoldMonth]));
  rows.push(['LANCAMENTOS', 'data', 'tipo', 'categoria', 'canal', 'descricao', 'valor', '', '']);
  DATA.transactions.forEach(t => rows.push(['LANCAMENTO', t.date, t.type, t.category, t.marketplace, t.description, t.amount, '', '']));
  rows.push(['FUTUROS', 'data', 'descricao', 'valor', 'repete_meses', '', '', '', '']);
  DATA.plannedEntries.forEach(e => rows.push(['FUTURO', e.date, e.description, e.amount, e.repeatMonths || 0, '', '', '', '']));
  downloadCsv(`backup-yalca-${yalcaTodayKey()}.csv`, rows);
  toast('Backup baixado.', 'success');
}

/* Desabilita o botão e mostra "Salvando…" durante a requisição. */
async function withBusy(btn, fn, errorPrefix) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    await fn();
  } catch (err) {
    toast(`${errorPrefix}: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function populateChannelSelect(selectId, includeNone, includeAll) {
  const sel = $(selectId);
  if (!sel) return;
  const current = sel.value;
  const channels = yalcaChannels(DATA.settings);
  const options = [];
  if (includeAll) options.push('<option value="todos">Todos os canais</option>');
  if (includeNone) options.push('<option value="-">Não se aplica</option>');
  options.push(...channels.map(c => `<option value="${yalcaEscapeHtml(c)}">${yalcaEscapeHtml(c)}</option>`));
  sel.innerHTML = options.join('');
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

/* ============================================================
   8. CONFIGURAÇÕES
   ============================================================ */

function initSettingsSection() {
  $('settingsForm').addEventListener('submit', submitSettings);
  $('addChannelForm').addEventListener('submit', addChannel);
  $('passwordForm').addEventListener('submit', submitPassword);
  $('channelList').addEventListener('click', onChannelAction);
  $('channelList').addEventListener('change', onChannelFeeChange);
}

function renderConfig() {
  const s = DATA.settings;
  $('migrationNotice').hidden = YALCA_SCHEMA.settingsV7 && YALCA_SCHEMA.productsV7 && YALCA_SCHEMA.plannedV7;

  $('setClientName').value = s.clientName;
  $('setCashBalance').value = s.cashBalance;
  $('setTaxPct').value = s.defaultTaxPct;
  $('setShipping').value = s.defaultShippingCost;
  $('setTargetMargin').value = s.targetMarginPct;
  $('setRevenueGoal').value = s.monthlyRevenueGoal;
  $('setProfitGoal').value = s.monthlyProfitGoal;
  $('setFixedCosts').value = s.fixedCostsMonthly;
  $('setLeadTime').value = s.stockLeadTimeDays;
  $('setCoverDays').value = s.stockCoverDays;

  $('accountEmail').textContent = (USER && USER.email) || '—';
  const status = IS_ADMIN ? 'Administrador Yalca' : (PROFILE && PROFILE.status === 'approved' ? 'Acesso liberado' : 'Em análise');
  $('accountStatus').textContent = status;

  $('resetDemoBtn').textContent = (DATA.products.length === 0 && DATA.transactions.length === 0)
    ? '✨ Carregar dados de exemplo'
    : '↺ Substituir por dados de exemplo';

  renderChannelList();
}

function renderChannelList() {
  const fees = DATA.settings.marketplaceFees || {};
  const channels = yalcaChannels(DATA.settings);
  const used = new Map();
  DATA.products.forEach(p => used.set(p.marketplace, (used.get(p.marketplace) || 0) + 1));

  $('channelList').innerHTML = channels.map(c => `
    <div class="channel-row" data-channel="${yalcaEscapeHtml(c)}">
      ${channelBadge(c)}
      <div class="channel-row__name">
        <strong>${yalcaEscapeHtml(c)}</strong>
        <span>${used.get(c) ? `${used.get(c)} produto(s)` : 'nenhum produto ainda'}</span>
      </div>
      <div class="channel-row__fee">
        <label class="visually-hidden" for="fee_${yalcaEscapeHtml(c).replace(/\W/g, '')}">Comissão de ${yalcaEscapeHtml(c)}</label>
        <input type="number" id="fee_${yalcaEscapeHtml(c).replace(/\W/g, '')}" inputmode="decimal" min="0" step="0.1" value="${yalcaNum(fees[c])}" data-fee-for="${yalcaEscapeHtml(c)}">
        <span>%</span>
      </div>
      <button class="icon-btn icon-btn--danger" data-remove-channel="${yalcaEscapeHtml(c)}" title="Remover canal" aria-label="Remover ${yalcaEscapeHtml(c)}">🗑</button>
    </div>`).join('');
}

async function onChannelFeeChange(e) {
  const input = e.target.closest('[data-fee-for]');
  if (!input) return;
  const channel = input.dataset.feeFor;
  const fees = { ...DATA.settings.marketplaceFees, [channel]: parseFloat(input.value) || 0 };
  await persistSettings({ ...DATA.settings, marketplaceFees: fees }, 'Comissão atualizada.');
}

async function addChannel(e) {
  e.preventDefault();
  const name = $('newChannelName').value.trim();
  const fee = parseFloat($('newChannelFee').value) || 0;
  if (!name) return;
  if (DATA.settings.marketplaceFees[name] !== undefined) {
    return toast('Esse canal já está cadastrado.', 'error');
  }
  const fees = { ...DATA.settings.marketplaceFees, [name]: fee };
  await persistSettings({ ...DATA.settings, marketplaceFees: fees }, `Canal “${name}” adicionado.`);
  $('addChannelForm').reset();
  $('newChannelFee').value = 0;
}

async function onChannelAction(e) {
  const btn = e.target.closest('[data-remove-channel]');
  if (!btn) return;
  const channel = btn.dataset.removeChannel;
  const count = DATA.products.filter(p => p.marketplace === channel).length;
  if (count) {
    return toast(`Não dá para remover “${channel}”: ${count} produto(s) ainda usam esse canal.`, 'error');
  }
  if (Object.keys(DATA.settings.marketplaceFees).length <= 1) {
    return toast('Você precisa manter pelo menos um canal de venda.', 'error');
  }
  const ok = await confirmDialog(`Remover o canal “${channel}”?`, { danger: true, okLabel: 'Remover' });
  if (!ok) return;
  const fees = { ...DATA.settings.marketplaceFees };
  delete fees[channel];
  await persistSettings({ ...DATA.settings, marketplaceFees: fees }, `Canal “${channel}” removido.`);
}

async function persistSettings(next, successMessage) {
  try {
    DATA.settings = await yalcaSaveSettings(next);
    refreshUI();
    if (successMessage) toast(successMessage, 'success');
  } catch (err) {
    toast('Não foi possível salvar: ' + err.message, 'error');
  }
}

async function submitSettings(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const next = {
    ...DATA.settings,
    clientName: $('setClientName').value.trim() || 'Minha Loja',
    cashBalance: parseFloat($('setCashBalance').value) || 0,
    defaultTaxPct: parseFloat($('setTaxPct').value) || 0,
    defaultShippingCost: parseFloat($('setShipping').value) || 0,
    targetMarginPct: parseFloat($('setTargetMargin').value) || 0,
    monthlyRevenueGoal: parseFloat($('setRevenueGoal').value) || 0,
    monthlyProfitGoal: parseFloat($('setProfitGoal').value) || 0,
    fixedCostsMonthly: parseFloat($('setFixedCosts').value) || 0,
    stockLeadTimeDays: parseInt($('setLeadTime').value, 10) || 15,
    stockCoverDays: parseInt($('setCoverDays').value, 10) || 30
  };
  await withBusy(btn, async () => {
    DATA.settings = await yalcaSaveSettings(next);
    refreshUI();
    const msg = $('settingsSuccess');
    msg.classList.add('is-visible');
    setTimeout(() => msg.classList.remove('is-visible'), 4000);
  }, 'Não foi possível salvar as configurações');
}

async function submitPassword(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const pass = $('newPassword').value;
  const confirmPass = $('newPasswordConfirm').value;
  if (pass !== confirmPass) return toast('As senhas não são iguais.', 'error');
  if (pass.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.', 'error');

  await withBusy(btn, async () => {
    const result = await yalcaUpdatePassword(pass);
    if (!result.ok) throw new Error(result.error);
    e.target.reset();
    const msg = $('passwordSuccess');
    msg.classList.add('is-visible');
    setTimeout(() => msg.classList.remove('is-visible'), 4000);
    toast('Senha alterada com sucesso.', 'success');
  }, 'Não foi possível trocar a senha');
}
