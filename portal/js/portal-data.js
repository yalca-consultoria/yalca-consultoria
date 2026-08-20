/* =========================================
   Yalca Portal — camada de dados e regras de negócio
   Todas as consultas são filtradas pelas políticas de RLS:
   cada cliente só vê e edita as próprias linhas.

   As colunas da migração v7 são OPCIONAIS. No boot o painel
   detecta o que existe (YALCA_SCHEMA) e degrada sem quebrar.
   ========================================= */

const MARKETPLACES = ['Mercado Livre', 'Amazon', 'Shopee', 'TikTok', 'Temu', 'Droga Raia'];

const MARKETPLACE_FEES_DEFAULT = {
  'Mercado Livre': 14,
  'Amazon': 15,
  'Shopee': 16,
  'TikTok': 12,
  'Temu': 10,
  'Droga Raia': 0
};

const SETTINGS_DEFAULT = {
  clientName: 'Minha Loja',
  cashBalance: 0,
  defaultTaxPct: 6,
  defaultShippingCost: 12,
  marketplaceFees: { ...MARKETPLACE_FEES_DEFAULT },
  monthlyRevenueGoal: 0,
  monthlyProfitGoal: 0,
  fixedCostsMonthly: 0,
  targetMarginPct: 20,
  stockLeadTimeDays: 15,
  stockCoverDays: 30,
  pricingOverrides: null
};

/* Recursos disponíveis no banco deste cliente. Preenchido por yalcaDetectSchema(). */
const YALCA_SCHEMA = {
  settingsV7: false,   // metas, custos fixos, margem alvo, reposição
  productsV7: false,   // frete e comissão por produto
  plannedV7: false     // lançamentos futuros recorrentes
};

function yalcaCheck(result) {
  if (result.error) throw new Error(result.error.message || 'Erro ao acessar o banco de dados.');
  return result.data;
}

function yalcaNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback || 0);
}

/* ---------- Mapeamento banco (snake_case) <-> app (camelCase) ---------- */

function dbToProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    marketplace: row.marketplace,
    category: row.category || '',
    cost: yalcaNum(row.cost),
    price: yalcaNum(row.price),
    stock: yalcaNum(row.stock),
    minStock: yalcaNum(row.min_stock),
    unitsSoldMonth: yalcaNum(row.units_sold_month),
    status: row.status || 'Ativo',
    // v7 — null significa "usar o padrão da loja"
    shippingCost: row.shipping_cost === null || row.shipping_cost === undefined ? null : Number(row.shipping_cost),
    feePct: row.fee_pct === null || row.fee_pct === undefined ? null : Number(row.fee_pct)
  };
}

function productToDb(p) {
  const row = {
    sku: p.sku,
    name: p.name,
    marketplace: p.marketplace,
    category: p.category,
    cost: p.cost,
    price: p.price,
    stock: p.stock,
    min_stock: p.minStock,
    units_sold_month: p.unitsSoldMonth,
    status: p.status
  };
  if (YALCA_SCHEMA.productsV7) {
    row.shipping_cost = p.shippingCost === null || p.shippingCost === '' ? null : Number(p.shippingCost);
    row.fee_pct = p.feePct === null || p.feePct === '' ? null : Number(p.feePct);
  }
  return row;
}

function dbToSettings(row) {
  const fees = row.marketplace_fees && Object.keys(row.marketplace_fees).length
    ? row.marketplace_fees
    : { ...MARKETPLACE_FEES_DEFAULT };
  return {
    clientName: row.client_name || SETTINGS_DEFAULT.clientName,
    cashBalance: yalcaNum(row.cash_balance),
    defaultTaxPct: yalcaNum(row.default_tax_pct, 6),
    defaultShippingCost: yalcaNum(row.default_shipping_cost, 12),
    marketplaceFees: fees,
    monthlyRevenueGoal: yalcaNum(row.monthly_revenue_goal),
    monthlyProfitGoal: yalcaNum(row.monthly_profit_goal),
    fixedCostsMonthly: yalcaNum(row.fixed_costs_monthly),
    targetMarginPct: yalcaNum(row.target_margin_pct, 20),
    stockLeadTimeDays: yalcaNum(row.stock_lead_time_days, 15),
    stockCoverDays: yalcaNum(row.stock_cover_days, 30),
    pricingOverrides: row.pricing_overrides || null
  };
}

function settingsToDb(s) {
  const row = {
    client_name: s.clientName,
    cash_balance: s.cashBalance,
    default_tax_pct: s.defaultTaxPct,
    default_shipping_cost: s.defaultShippingCost,
    marketplace_fees: s.marketplaceFees
  };
  if (YALCA_SCHEMA.settingsV7) {
    row.monthly_revenue_goal = s.monthlyRevenueGoal;
    row.monthly_profit_goal = s.monthlyProfitGoal;
    row.fixed_costs_monthly = s.fixedCostsMonthly;
    row.target_margin_pct = s.targetMarginPct;
    row.stock_lead_time_days = Math.round(s.stockLeadTimeDays);
    row.stock_cover_days = Math.round(s.stockCoverDays);
  }
  return row;
}

/* Os canais de venda do cliente saem das chaves de marketplace_fees:
   assim ele adiciona/remove canais sem precisar de migração. */
function yalcaChannels(settings) {
  const keys = Object.keys(settings.marketplaceFees || {});
  return keys.length ? keys : [...MARKETPLACES];
}

/* ---------- Detecção de schema ---------- */

async function yalcaDetectSchema() {
  const probe = async (table, column) => {
    try {
      const { error } = await supabaseClient.from(table).select(column).limit(1);
      return !error;
    } catch (e) {
      return false;
    }
  };
  const [settingsV7, productsV7, plannedV7] = await Promise.all([
    probe('client_settings', 'monthly_revenue_goal'),
    probe('products', 'shipping_cost'),
    probe('planned_entries', 'repeat_months')
  ]);
  YALCA_SCHEMA.settingsV7 = settingsV7;
  YALCA_SCHEMA.productsV7 = productsV7;
  YALCA_SCHEMA.plannedV7 = plannedV7;
  return YALCA_SCHEMA;
}

/* ---------- Carregamento ---------- */

async function yalcaFetchAll(profile) {
  const uid = profile && profile.user_id;
  const [productsRes, transactionsRes, plannedRes, settingsRes] = await Promise.all([
    supabaseClient.from('products').select('*').eq('user_id', uid).order('created_at'),
    supabaseClient.from('transactions').select('*').eq('user_id', uid).order('date'),
    supabaseClient.from('planned_entries').select('*').eq('user_id', uid).order('date'),
    supabaseClient.from('client_settings').select('*').eq('user_id', uid).maybeSingle()
  ]);

  const products = yalcaCheck(productsRes) || [];
  const transactions = yalcaCheck(transactionsRes) || [];
  const plannedEntries = yalcaCheck(plannedRes) || [];
  let settingsRow = yalcaCheck(settingsRes);

  if (!settingsRow) {
    const initial = profile && profile.store_name ? { client_name: profile.store_name } : {};
    settingsRow = yalcaCheck(await supabaseClient.from('client_settings').insert(initial).select().single());
  }

  return {
    products: products.map(dbToProduct),
    transactions: transactions.map(t => ({ ...t, amount: yalcaNum(t.amount) })),
    plannedEntries: plannedEntries.map(e => ({ ...e, amount: yalcaNum(e.amount), repeatMonths: yalcaNum(e.repeat_months) })),
    settings: dbToSettings(settingsRow)
  };
}

/* ---------- Transações ---------- */

async function yalcaAddTransaction(record) {
  const row = yalcaCheck(await supabaseClient.from('transactions').insert(record).select().single());
  return { ...row, amount: yalcaNum(row.amount) };
}
async function yalcaAddTransactionsBulk(records) {
  if (!records.length) return [];
  const rows = [];
  // Lotes de 200 evitam payloads grandes demais em conexões móveis.
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    const inserted = yalcaCheck(await supabaseClient.from('transactions').insert(chunk).select());
    rows.push(...(inserted || []));
  }
  return rows.map(r => ({ ...r, amount: yalcaNum(r.amount) }));
}
async function yalcaUpdateTransaction(id, record) {
  const row = yalcaCheck(await supabaseClient.from('transactions').update(record).eq('id', id).select().single());
  return { ...row, amount: yalcaNum(row.amount) };
}
async function yalcaDeleteTransaction(id) {
  return yalcaCheck(await supabaseClient.from('transactions').delete().eq('id', id));
}

/* ---------- Produtos ---------- */

async function yalcaAddProduct(product) {
  return dbToProduct(yalcaCheck(await supabaseClient.from('products').insert(productToDb(product)).select().single()));
}
async function yalcaUpdateProduct(id, product) {
  return dbToProduct(yalcaCheck(await supabaseClient.from('products').update(productToDb(product)).eq('id', id).select().single()));
}
async function yalcaUpdateProductPrice(id, price) {
  return dbToProduct(yalcaCheck(await supabaseClient.from('products').update({ price }).eq('id', id).select().single()));
}
async function yalcaDeleteProduct(id) {
  return yalcaCheck(await supabaseClient.from('products').delete().eq('id', id));
}

/* ---------- Configurações do cliente ---------- */

async function yalcaSaveSettings(settings) {
  const user = await yalcaCurrentUser();
  const row = yalcaCheck(await supabaseClient.from('client_settings').update(settingsToDb(settings)).eq('user_id', user.id).select().single());
  return dbToSettings(row);
}

async function yalcaSavePricingOverrides(overrides) {
  // Sem a migração v7 a personalização de taxas fica só neste navegador.
  if (!YALCA_SCHEMA.settingsV7) {
    try { localStorage.setItem('yalca_pricing_overrides', JSON.stringify(overrides)); } catch (e) { /* modo privado */ }
    return;
  }
  const user = await yalcaCurrentUser();
  yalcaCheck(await supabaseClient.from('client_settings').update({ pricing_overrides: overrides }).eq('user_id', user.id).select().single());
}

function yalcaLocalPricingOverrides() {
  try { return JSON.parse(localStorage.getItem('yalca_pricing_overrides') || 'null'); } catch (e) { return null; }
}

/* ---------- Lançamentos futuros (fluxo de caixa) ---------- */

async function yalcaAddPlannedEntry(entry) {
  const record = { date: entry.date, description: entry.description, amount: entry.amount };
  if (YALCA_SCHEMA.plannedV7) record.repeat_months = Math.max(0, Math.round(entry.repeatMonths || 0));
  const row = yalcaCheck(await supabaseClient.from('planned_entries').insert(record).select().single());
  return { ...row, amount: yalcaNum(row.amount), repeatMonths: yalcaNum(row.repeat_months) };
}
async function yalcaDeletePlannedEntry(id) {
  return yalcaCheck(await supabaseClient.from('planned_entries').delete().eq('id', id));
}

/* ---------- Dados de exemplo ---------- */

async function yalcaSeedDemoData() {
  const seed = yalcaDemoSeed();
  const products = YALCA_SCHEMA.productsV7
    ? seed.products
    : seed.products.map(({ shipping_cost, fee_pct, ...rest }) => rest);
  const planned = YALCA_SCHEMA.plannedV7
    ? seed.plannedEntries
    : seed.plannedEntries.map(({ repeat_months, ...rest }) => rest);
  yalcaCheck(await supabaseClient.from('products').insert(products));
  yalcaCheck(await supabaseClient.from('transactions').insert(seed.transactions));
  yalcaCheck(await supabaseClient.from('planned_entries').insert(planned));
}

async function yalcaClearAllData() {
  const user = await yalcaCurrentUser();
  if (!user) return;
  await supabaseClient.from('products').delete().eq('user_id', user.id);
  await supabaseClient.from('transactions').delete().eq('user_id', user.id);
  await supabaseClient.from('planned_entries').delete().eq('user_id', user.id);
}

/* Os dados de exemplo são ancorados no mês atual do usuário, para que
   "últimos 6 meses" e as projeções façam sentido em qualquer data. */
function yalcaSeedMonthKey(monthsAgo) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function yalcaDemoSeed() {
  const meses = [5, 4, 3, 2, 1, 0].map(yalcaSeedMonthKey);
  const receitaBase = [
    { ml: 18000, az: 9000, sp: 6000 },
    { ml: 20000, az: 10500, sp: 7500 },
    { ml: 23000, az: 12000, sp: 8500 },
    { ml: 26500, az: 14000, sp: 10000 },
    { ml: 29000, az: 16500, sp: 12000 },
    { ml: 21000, az: 12500, sp: 9000 }
  ];
  const despesaBase = [
    { anuncios: 3800, taxas: 4200, fornecedor: 14000, frete: 1500, fixos: 2400, impostos: 2000 },
    { anuncios: 4300, taxas: 4900, fornecedor: 16000, frete: 1700, fixos: 2400, impostos: 2300 },
    { anuncios: 5000, taxas: 5600, fornecedor: 18000, frete: 1900, fixos: 2500, impostos: 2600 },
    { anuncios: 5600, taxas: 6500, fornecedor: 20500, frete: 2200, fixos: 2500, impostos: 3000 },
    { anuncios: 6200, taxas: 7400, fornecedor: 23000, frete: 2500, fixos: 2600, impostos: 3400 },
    { anuncios: 4500, taxas: 5500, fornecedor: 17000, frete: 1800, fixos: 2600, impostos: 2200 }
  ];

  const transactions = [];
  meses.forEach((mes, i) => {
    const r = receitaBase[i];
    transactions.push(
      { date: `${mes}-05`, type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: r.ml },
      { date: `${mes}-05`, type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: r.az },
      { date: `${mes}-05`, type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: r.sp }
    );
    const d = despesaBase[i];
    transactions.push(
      { date: `${mes}-10`, type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: d.anuncios },
      { date: `${mes}-12`, type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: d.taxas },
      { date: `${mes}-15`, type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: d.fornecedor },
      { date: `${mes}-18`, type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: d.frete },
      { date: `${mes}-20`, type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: d.fixos },
      { date: `${mes}-25`, type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: d.impostos }
    );
  });

  return {
    products: [
      { sku: 'VEST-001', name: 'Vestido Midi Floral', marketplace: 'Mercado Livre', category: 'Moda', cost: 45, price: 129.90, stock: 8, min_stock: 15, units_sold_month: 34, status: 'Ativo', shipping_cost: 14, fee_pct: null },
      { sku: 'TENIS-002', name: 'Tênis Casual Unissex', marketplace: 'Amazon', category: 'Calçados', cost: 68, price: 179.90, stock: 42, min_stock: 20, units_sold_month: 21, status: 'Ativo', shipping_cost: 19, fee_pct: null },
      { sku: 'FONE-003', name: 'Fone Bluetooth TWS', marketplace: 'Mercado Livre', category: 'Eletrônicos', cost: 32, price: 89.90, stock: 3, min_stock: 25, units_sold_month: 58, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'BOLS-004', name: 'Bolsa Transversal Couro Sintético', marketplace: 'Shopee', category: 'Acessórios', cost: 38, price: 99.90, stock: 0, min_stock: 10, units_sold_month: 12, status: 'Pausado', shipping_cost: null, fee_pct: null },
      { sku: 'SERUM-005', name: 'Sérum Facial Vitamina C', marketplace: 'Mercado Livre', category: 'Beleza', cost: 18, price: 59.90, stock: 60, min_stock: 20, units_sold_month: 3, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'RELOG-006', name: 'Relógio Smartwatch Fit', marketplace: 'Amazon', category: 'Eletrônicos', cost: 95, price: 219.90, stock: 15, min_stock: 10, units_sold_month: 27, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'BATOM-007', name: 'Kit Batom Líquido Matte (3un)', marketplace: 'Shopee', category: 'Beleza', cost: 22, price: 49.90, stock: 5, min_stock: 20, units_sold_month: 40, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'MOCHI-008', name: 'Mochila Notebook Impermeável', marketplace: 'Mercado Livre', category: 'Acessórios', cost: 55, price: 139.90, stock: 30, min_stock: 15, units_sold_month: 19, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'CARREG-009', name: 'Carregador Turbo 30W', marketplace: 'Amazon', category: 'Eletrônicos', cost: 15, price: 34.90, stock: 90, min_stock: 30, units_sold_month: 5, status: 'Ativo', shipping_cost: null, fee_pct: null },
      { sku: 'SHORT-010', name: 'Short Fitness Feminino', marketplace: 'Shopee', category: 'Moda', cost: 32, price: 39.90, stock: 25, min_stock: 15, units_sold_month: 22, status: 'Ativo', shipping_cost: null, fee_pct: null }
    ],
    transactions,
    plannedEntries: [
      { date: `${yalcaSeedMonthKey(-1)}-05`, description: 'Compra de estoque — reposição Fone Bluetooth', amount: -8000, repeat_months: 0 },
      { date: `${yalcaSeedMonthKey(-1)}-15`, description: 'Investimento em tráfego pago (campanha sazonal)', amount: -3000, repeat_months: 0 },
      { date: `${yalcaSeedMonthKey(-2)}-10`, description: 'Repasse extra Amazon (liquidação de pendências)', amount: 2500, repeat_months: 0 }
    ]
  };
}

/* ---------- Formatação ---------- */

function yalcaFormatCurrency(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* Versão compacta para KPIs no celular: R$ 29,0 mil / R$ 1,2 mi */
function yalcaFormatCurrencyShort(value) {
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}R$ ${(abs / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 10000) return `${sign}R$ ${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return yalcaFormatCurrency(v);
}

function yalcaFormatNumber(value, digits) {
  return (Number(value) || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits === undefined ? 0 : digits });
}

function yalcaFormatPct(value, digits) {
  return `${(Number(value) || 0).toFixed(digits === undefined ? 1 : digits)}%`;
}

function yalcaFormatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const YALCA_MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const YALCA_MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function yalcaMonthLabel(isoDate) {
  const [y, m] = String(isoDate).split('-').map(Number);
  return `${YALCA_MESES[m - 1]}/${String(y).slice(2)}`;
}

function yalcaMonthLabelLong(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number);
  return `${YALCA_MESES_LONGOS[m - 1]} de ${y}`;
}

function yalcaTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yalcaCurrentMonthKey() {
  return yalcaTodayKey().slice(0, 7);
}

function yalcaShiftMonth(monthKey, delta) {
  let [y, m] = monthKey.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ---------- Períodos ---------- */

const YALCA_PERIODS = [
  { key: 'thisMonth', label: 'Este mês', short: 'Este mês', months: 1, offset: 0 },
  { key: 'lastMonth', label: 'Mês passado', short: 'Mês passado', months: 1, offset: 1 },
  { key: 'last3', label: 'Últimos 3 meses', short: '3 meses', months: 3, offset: 0 },
  { key: 'last6', label: 'Últimos 6 meses', short: '6 meses', months: 6, offset: 0 },
  { key: 'last12', label: 'Últimos 12 meses', short: '12 meses', months: 12, offset: 0 },
  { key: 'all', label: 'Todo o período', short: 'Tudo', months: null, offset: 0 }
];

/* Devolve { from, to, months[], label } — chaves YYYY-MM inclusivas. */
function yalcaPeriodRange(periodKey, transactions) {
  const def = YALCA_PERIODS.find(p => p.key === periodKey) || YALCA_PERIODS[0];
  const keys = (transactions || []).map(t => String(t.date).slice(0, 7)).sort();

  if (def.months === null) {
    const from = keys.length ? keys[0] : yalcaCurrentMonthKey();
    const to = keys.length ? keys[keys.length - 1] : yalcaCurrentMonthKey();
    return { from, to, months: yalcaMonthsBetween(from, to), label: def.label, def };
  }
  const to = yalcaShiftMonth(yalcaCurrentMonthKey(), -def.offset);
  const from = yalcaShiftMonth(to, -(def.months - 1));
  return { from, to, months: yalcaMonthsBetween(from, to), label: def.label, def };
}

/* Período imediatamente anterior, de mesmo tamanho — base das variações %. */
function yalcaPreviousRange(range) {
  const size = range.months.length || 1;
  const to = yalcaShiftMonth(range.from, -1);
  const from = yalcaShiftMonth(to, -(size - 1));
  return { from, to, months: yalcaMonthsBetween(from, to) };
}

function yalcaMonthsBetween(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 240) { out.push(cur); cur = yalcaShiftMonth(cur, 1); guard++; }
  return out;
}

function yalcaFilterByRange(transactions, range) {
  return transactions.filter(t => {
    const k = String(t.date).slice(0, 7);
    return k >= range.from && k <= range.to;
  });
}

/* ---------- Cálculos de negócio ---------- */

/* Frete e comissão do produto caem para o padrão da loja quando não
   informados — assim o cliente só preenche o que é exceção. */
function yalcaProductShipping(product, settings) {
  return product.shippingCost === null || product.shippingCost === undefined
    ? yalcaNum(settings.defaultShippingCost)
    : Number(product.shippingCost);
}

function yalcaProductFeePct(product, settings) {
  if (product.feePct !== null && product.feePct !== undefined) return Number(product.feePct);
  const fees = settings.marketplaceFees || {};
  return yalcaNum(fees[product.marketplace]);
}

function yalcaProductMargin(product, settings) {
  const feePct = yalcaProductFeePct(product, settings);
  const taxPct = yalcaNum(settings.defaultTaxPct);
  const shipping = yalcaProductShipping(product, settings);
  const price = yalcaNum(product.price);
  const feeValue = price * (feePct / 100);
  const taxValue = price * (taxPct / 100);
  const netProfit = price - yalcaNum(product.cost) - feeValue - taxValue - shipping;
  const marginPct = price > 0 ? (netProfit / price) * 100 : 0;
  return { netProfit, marginPct, feeValue, taxValue, shipping, feePct, taxPct };
}

/* Preço mínimo para atingir a margem alvo, no mesmo modelo de custos. */
function yalcaSuggestedPrice(product, settings, targetMarginPct) {
  const feePct = yalcaProductFeePct(product, settings);
  const taxPct = yalcaNum(settings.defaultTaxPct);
  const shipping = yalcaProductShipping(product, settings);
  const denom = 1 - (feePct + taxPct + yalcaNum(targetMarginPct)) / 100;
  if (denom <= 0) return null;
  return (yalcaNum(product.cost) + shipping) / denom;
}

/* Lucro e receita do produto no mês, no ritmo de venda declarado. */
function yalcaProductMonthly(product, settings) {
  const { netProfit, marginPct } = yalcaProductMargin(product, settings);
  const units = yalcaNum(product.unitsSoldMonth);
  return {
    revenue: yalcaNum(product.price) * units,
    profit: netProfit * units,
    units,
    marginPct
  };
}

/* Cobertura de estoque: quantos dias o estoque atual aguenta no
   ritmo de venda do mês, e quanto comprar para não faltar. */
function yalcaStockCoverage(product, settings) {
  const perDay = yalcaNum(product.unitsSoldMonth) / 30;
  const stock = yalcaNum(product.stock);
  const leadTime = yalcaNum(settings.stockLeadTimeDays, 15);
  const coverTarget = yalcaNum(settings.stockCoverDays, 30);
  const daysLeft = perDay > 0 ? stock / perDay : Infinity;
  const reorderPoint = Math.ceil(perDay * leadTime);
  const idealStock = Math.ceil(perDay * (leadTime + coverTarget));
  const suggestedPurchase = Math.max(0, idealStock - stock);
  return { perDay, daysLeft, reorderPoint, idealStock, suggestedPurchase, leadTime, coverTarget };
}

/* Status de estoque em 6 níveis, do mais urgente ao menos:
   Esgotado > Crítico (acaba antes da reposição chegar) > Baixo >
   Parado (capital preso) > Excesso > OK */
function yalcaStockStatus(product, settings) {
  const s = settings || SETTINGS_DEFAULT;
  const stock = yalcaNum(product.stock);
  if (stock === 0) return 'Esgotado';
  const { daysLeft, leadTime, coverTarget, perDay } = yalcaStockCoverage(product, s);
  if (perDay > 0 && daysLeft <= leadTime) return 'Crítico';
  if (stock < yalcaNum(product.minStock)) return 'Baixo';
  if (perDay === 0 || daysLeft > (leadTime + coverTarget) * 3) {
    return yalcaNum(product.unitsSoldMonth) < 6 ? 'Parado' : 'Excesso';
  }
  return 'OK';
}

const YALCA_STOCK_STATUSES = ['Esgotado', 'Crítico', 'Baixo', 'OK', 'Excesso', 'Parado'];

function yalcaGroupTransactionsByMonth(transactions) {
  const map = new Map();
  transactions.forEach(t => {
    const key = String(t.date).slice(0, 7);
    if (!map.has(key)) map.set(key, { key, receita: 0, despesa: 0 });
    const bucket = map.get(key);
    if (t.type === 'receita') bucket.receita += yalcaNum(t.amount);
    else bucket.despesa += yalcaNum(t.amount);
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/* Série mensal completa (inclui meses sem lançamento como zero) —
   sem isso um mês vazio some do gráfico e distorce a leitura. */
function yalcaMonthlySeries(transactions, months) {
  const byMonth = new Map(yalcaGroupTransactionsByMonth(transactions).map(m => [m.key, m]));
  return months.map(key => {
    const m = byMonth.get(key) || { key, receita: 0, despesa: 0 };
    return { ...m, lucro: m.receita - m.despesa };
  });
}

function yalcaTotals(transactions) {
  let receita = 0, despesa = 0;
  transactions.forEach(t => {
    if (t.type === 'receita') receita += yalcaNum(t.amount);
    else despesa += yalcaNum(t.amount);
  });
  const lucro = receita - despesa;
  return { receita, despesa, lucro, margem: receita > 0 ? (lucro / receita) * 100 : 0 };
}

/* Variação percentual protegida contra divisão por zero. */
function yalcaDelta(current, previous) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* Ponto de equilíbrio: faturamento mensal mínimo para o negócio se pagar.
   Usa a margem de contribuição observada nos lançamentos do período
   (receita menos custos variáveis, ou seja, despesas fora dos custos fixos). */
function yalcaBreakEven(transactions, settings) {
  const fixedCosts = yalcaNum(settings.fixedCostsMonthly);
  const totals = yalcaTotals(transactions);
  const fixedCategories = ['custos fixos', 'custo fixo', 'salários', 'salarios', 'aluguel', 'pró-labore', 'pro-labore'];
  const variableCost = transactions
    .filter(t => t.type === 'despesa' && !fixedCategories.includes(String(t.category).toLowerCase()))
    .reduce((a, t) => a + yalcaNum(t.amount), 0);
  const contributionPct = totals.receita > 0 ? ((totals.receita - variableCost) / totals.receita) * 100 : 0;
  const monthsCount = new Set(transactions.map(t => String(t.date).slice(0, 7))).size || 1;
  const revenuePerMonth = totals.receita / monthsCount;
  const breakEvenRevenue = contributionPct > 0 ? (fixedCosts / (contributionPct / 100)) : null;
  return {
    fixedCosts,
    contributionPct,
    breakEvenRevenue,
    revenuePerMonth,
    coverage: breakEvenRevenue ? (revenuePerMonth / breakEvenRevenue) * 100 : null
  };
}

/* Curva ABC por receita mensal: A = 80% do faturamento, B = até 95%, C = cauda. */
function yalcaAbcCurve(products, settings) {
  const rows = products
    .map(p => ({ product: p, ...yalcaProductMonthly(p, settings) }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  let acc = 0;
  return rows.map(r => {
    acc += r.revenue;
    const accPct = total > 0 ? (acc / total) * 100 : 0;
    const classe = accPct <= 80 ? 'A' : (accPct <= 95 ? 'B' : 'C');
    return { ...r, sharePct: total > 0 ? (r.revenue / total) * 100 : 0, accPct, classe };
  });
}

/* Projeção de caixa: parte do saldo informado, soma o resultado
   recorrente (mediana dos meses fechados, mais estável que o último)
   e os lançamentos futuros — inclusive os recorrentes. */
function yalcaCashflowProjection(data, monthsAhead) {
  const horizon = monthsAhead || 6;
  const monthly = yalcaGroupTransactionsByMonth(data.transactions);
  const currentKey = yalcaCurrentMonthKey();
  const closed = monthly.filter(m => m.key < currentKey);
  const base = closed.length ? closed.slice(-3) : monthly.slice(-1);
  const nets = base.map(m => m.receita - m.despesa).sort((a, b) => a - b);
  const recurringNet = nets.length ? nets[Math.floor(nets.length / 2)] : 0;

  let saldo = yalcaNum(data.settings.cashBalance);
  const projection = [];
  for (let i = 1; i <= horizon; i++) {
    const key = yalcaShiftMonth(currentKey, i);
    const planned = yalcaPlannedForMonth(data.plannedEntries, key);
    saldo = saldo + recurringNet + planned.total;
    projection.push({ key, saldo, planned: planned.total, entries: planned.entries });
  }
  return { recurringNet, projection, currentBalance: yalcaNum(data.settings.cashBalance), currentKey };
}

/* Expande a recorrência: uma entrada com repeatMonths = 3 vale para
   o mês dela e os 3 seguintes. */
function yalcaPlannedForMonth(plannedEntries, monthKey) {
  const entries = [];
  let total = 0;
  plannedEntries.forEach(e => {
    const start = String(e.date).slice(0, 7);
    const repeat = Math.max(0, yalcaNum(e.repeatMonths));
    if (monthKey < start) return;
    const diff = yalcaMonthsBetween(start, monthKey).length - 1;
    if (diff <= repeat) {
      entries.push(e);
      total += yalcaNum(e.amount);
    }
  });
  return { total, entries };
}

/* Progresso de meta com projeção linear do mês corrente:
   "no ritmo atual você fecha o mês em X". */
function yalcaGoalProgress(current, goal, monthKey) {
  if (!goal) return null;
  const pct = (current / goal) * 100;
  const isCurrentMonth = monthKey === yalcaCurrentMonthKey();
  let pace = null;
  if (isCurrentMonth) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    pace = current * (daysInMonth / dayOfMonth);
  }
  return { pct, goal, current, pace, pacePct: pace === null ? null : (pace / goal) * 100 };
}
