/* =========================================
   Yalca Portal — camada de dados (Supabase)
   Cada consulta é automaticamente filtrada pelas
   políticas de RLS: um cliente só vê e edita as
   próprias linhas (products, transactions, etc.).
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

function yalcaCheck(result) {
  if (result.error) throw new Error(result.error.message || 'Erro ao acessar o banco de dados.');
  return result.data;
}

/* ---------- Mapeamento banco (snake_case) <-> app (camelCase) ---------- */

function dbToProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    marketplace: row.marketplace,
    category: row.category,
    cost: Number(row.cost),
    price: Number(row.price),
    stock: row.stock,
    minStock: row.min_stock,
    unitsSoldMonth: row.units_sold_month,
    status: row.status
  };
}

function productToDb(p) {
  return {
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
}

function dbToSettings(row) {
  return {
    clientName: row.client_name,
    cashBalance: Number(row.cash_balance),
    defaultTaxPct: Number(row.default_tax_pct),
    defaultShippingCost: Number(row.default_shipping_cost),
    marketplaceFees: row.marketplace_fees || { ...MARKETPLACE_FEES_DEFAULT }
  };
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
    const inserted = yalcaCheck(await supabaseClient.from('client_settings').insert(initial).select().single());
    settingsRow = inserted;
  }

  return {
    products: products.map(dbToProduct),
    transactions,
    plannedEntries,
    settings: dbToSettings(settingsRow)
  };
}

/* ---------- Transações ---------- */

async function yalcaAddTransaction(record) {
  return yalcaCheck(await supabaseClient.from('transactions').insert(record).select().single());
}
async function yalcaUpdateTransaction(id, record) {
  return yalcaCheck(await supabaseClient.from('transactions').update(record).eq('id', id).select().single());
}
async function yalcaDeleteTransaction(id) {
  return yalcaCheck(await supabaseClient.from('transactions').delete().eq('id', id));
}

/* ---------- Produtos ---------- */

async function yalcaAddProduct(product) {
  return yalcaCheck(await supabaseClient.from('products').insert(productToDb(product)).select().single());
}
async function yalcaUpdateProduct(id, product) {
  return yalcaCheck(await supabaseClient.from('products').update(productToDb(product)).eq('id', id).select().single());
}
async function yalcaDeleteProduct(id) {
  return yalcaCheck(await supabaseClient.from('products').delete().eq('id', id));
}

/* ---------- Configurações do cliente ---------- */

async function yalcaUpdateSettings(patch) {
  const user = await yalcaCurrentUser();
  return yalcaCheck(await supabaseClient.from('client_settings').update(patch).eq('user_id', user.id).select().single());
}

/* ---------- Lançamentos futuros (fluxo de caixa) ---------- */

async function yalcaAddPlannedEntry(entry) {
  return yalcaCheck(await supabaseClient.from('planned_entries').insert(entry).select().single());
}
async function yalcaDeletePlannedEntry(id) {
  return yalcaCheck(await supabaseClient.from('planned_entries').delete().eq('id', id));
}

/* ---------- Compras & Concorrência (Keepa) ---------- */

async function yalcaFetchTrackedAsins() {
  return yalcaCheck(await supabaseClient.from('keepa_tracked_asins').select('*').eq('active', true).order('created_at')) || [];
}
async function yalcaAddTrackedAsin({ asin, label, ownSellerName }) {
  return yalcaCheck(await supabaseClient.from('keepa_tracked_asins').insert({
    asin: asin.toUpperCase(),
    label: label || '',
    own_seller_name: ownSellerName || ''
  }).select().single());
}
async function yalcaDeleteTrackedAsin(id) {
  return yalcaCheck(await supabaseClient.from('keepa_tracked_asins').delete().eq('id', id));
}
async function yalcaFetchKeepaCache(asins) {
  if (!asins || asins.length === 0) return [];
  return yalcaCheck(await supabaseClient.from('keepa_asin_cache').select('*').in('asin', asins)) || [];
}
async function yalcaFetchKeepaAlerts(asins, limit) {
  if (!asins || asins.length === 0) return [];
  return yalcaCheck(await supabaseClient.from('keepa_asin_alerts').select('*').in('asin', asins).order('created_at', { ascending: false }).limit(limit || 10)) || [];
}
// API própria em Node (keepa-api.yalca.com.br), não mais Edge Function do
// Supabase — motivo: o edge-runtime self-hosted causou vários problemas
// reais (auth manual porque @supabase/server não funcionava nesse deploy,
// respostas OPTIONS quebradas, e o SDK supabase-js descartando a mensagem
// de erro customizada pra qualquer status não-2xx). Um fetch() direto não
// tem nenhuma dessas pegadinhas: o corpo JSON vem completo em qualquer
// status, então nem precisa de tratamento especial de erro aqui.
const KEEPA_API_URL = 'https://keepa-api.yalca.com.br';

async function yalcaKeepaApiCall(path, body) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  const res = await fetch(`${KEEPA_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('Não foi possível consultar agora. Tente novamente em instantes.');
  return json;
}
async function yalcaKeepaSearch(asin) {
  return yalcaKeepaApiCall('/keepa-search', { asin: asin.toUpperCase() });
}
async function yalcaKeepaSellerLookup(sellerIds) {
  return yalcaKeepaApiCall('/keepa-seller-lookup', { sellerIds });
}

// IA (assistente/diagnóstico/suporte) — mesmo padrão do keepa-api, API Node
// própria rodando o Ollama local. Respostas demoram 20-70s (CPU, sem GPU),
// então quem chama isso precisa mostrar um estado de "gerando..." visível.
const IA_API_URL = 'https://ia-api.yalca.com.br';

async function yalcaIaApiCall(path, body) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  const res = await fetch(`${IA_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('Não foi possível consultar agora. Tente novamente em instantes.');
  return json;
}
async function yalcaIaAssistant(message, history) {
  return yalcaIaApiCall('/assistant', { message, history });
}
async function yalcaIaDiagnostico() {
  return yalcaIaApiCall('/diagnostico', {});
}
async function yalcaIaSuporte(message, history) {
  return yalcaIaApiCall('/suporte', { message, history });
}

/* ---------- Dados de exemplo ---------- */

async function yalcaSeedDemoData() {
  const seed = yalcaDemoSeed();
  await supabaseClient.from('products').insert(seed.products);
  await supabaseClient.from('transactions').insert(seed.transactions);
  await supabaseClient.from('planned_entries').insert(seed.plannedEntries);
}

async function yalcaClearAllData() {
  const user = await yalcaCurrentUser();
  if (!user) return;
  await supabaseClient.from('products').delete().eq('user_id', user.id);
  await supabaseClient.from('transactions').delete().eq('user_id', user.id);
  await supabaseClient.from('planned_entries').delete().eq('user_id', user.id);
}

function yalcaDemoSeed() {
  return {
    products: [
      { sku: 'VEST-001', name: 'Vestido Midi Floral', marketplace: 'Mercado Livre', category: 'Moda', cost: 45, price: 129.90, stock: 8, min_stock: 15, units_sold_month: 34, status: 'Ativo' },
      { sku: 'TENIS-002', name: 'Tênis Casual Unissex', marketplace: 'Amazon', category: 'Calçados', cost: 68, price: 179.90, stock: 42, min_stock: 20, units_sold_month: 21, status: 'Ativo' },
      { sku: 'FONE-003', name: 'Fone Bluetooth TWS', marketplace: 'Mercado Livre', category: 'Eletrônicos', cost: 32, price: 89.90, stock: 3, min_stock: 25, units_sold_month: 58, status: 'Ativo' },
      { sku: 'BOLS-004', name: 'Bolsa Transversal Couro Sintético', marketplace: 'Shopee', category: 'Acessórios', cost: 38, price: 99.90, stock: 0, min_stock: 10, units_sold_month: 12, status: 'Pausado' },
      { sku: 'SERUM-005', name: 'Sérum Facial Vitamina C', marketplace: 'Mercado Livre', category: 'Beleza', cost: 18, price: 59.90, stock: 60, min_stock: 20, units_sold_month: 3, status: 'Ativo' },
      { sku: 'RELOG-006', name: 'Relógio Smartwatch Fit', marketplace: 'Amazon', category: 'Eletrônicos', cost: 95, price: 219.90, stock: 15, min_stock: 10, units_sold_month: 27, status: 'Ativo' },
      { sku: 'BATOM-007', name: 'Kit Batom Líquido Matte (3un)', marketplace: 'Shopee', category: 'Beleza', cost: 22, price: 49.90, stock: 5, min_stock: 20, units_sold_month: 40, status: 'Ativo' },
      { sku: 'MOCHI-008', name: 'Mochila Notebook Impermeável', marketplace: 'Mercado Livre', category: 'Acessórios', cost: 55, price: 139.90, stock: 30, min_stock: 15, units_sold_month: 19, status: 'Ativo' },
      { sku: 'CARREG-009', name: 'Carregador Turbo 30W', marketplace: 'Amazon', category: 'Eletrônicos', cost: 15, price: 34.90, stock: 90, min_stock: 30, units_sold_month: 5, status: 'Ativo' },
      { sku: 'SHORT-010', name: 'Short Fitness Feminino', marketplace: 'Shopee', category: 'Moda', cost: 32, price: 39.90, stock: 25, min_stock: 15, units_sold_month: 22, status: 'Ativo' }
    ],
    transactions: [
      { date: '2026-02-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 18000 },
      { date: '2026-02-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 9000 },
      { date: '2026-02-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 6000 },
      { date: '2026-02-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 3800 },
      { date: '2026-02-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 4200 },
      { date: '2026-02-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 14000 },
      { date: '2026-02-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 1500 },
      { date: '2026-02-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2400 },
      { date: '2026-02-25', type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: 2000 },

      { date: '2026-03-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 20000 },
      { date: '2026-03-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 10500 },
      { date: '2026-03-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 7500 },
      { date: '2026-03-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 4300 },
      { date: '2026-03-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 4900 },
      { date: '2026-03-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 16000 },
      { date: '2026-03-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 1700 },
      { date: '2026-03-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2400 },
      { date: '2026-03-25', type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: 2300 },

      { date: '2026-04-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 23000 },
      { date: '2026-04-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 12000 },
      { date: '2026-04-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 8500 },
      { date: '2026-04-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 5000 },
      { date: '2026-04-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 5600 },
      { date: '2026-04-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 18000 },
      { date: '2026-04-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 1900 },
      { date: '2026-04-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2500 },
      { date: '2026-04-25', type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: 2600 },

      { date: '2026-05-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 26500 },
      { date: '2026-05-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 14000 },
      { date: '2026-05-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 10000 },
      { date: '2026-05-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 5600 },
      { date: '2026-05-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 6500 },
      { date: '2026-05-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 20500 },
      { date: '2026-05-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 2200 },
      { date: '2026-05-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2500 },
      { date: '2026-05-25', type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: 3000 },

      { date: '2026-06-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 29000 },
      { date: '2026-06-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 16500 },
      { date: '2026-06-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 12000 },
      { date: '2026-06-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 6200 },
      { date: '2026-06-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 7400 },
      { date: '2026-06-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 23000 },
      { date: '2026-06-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 2500 },
      { date: '2026-06-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2600 },
      { date: '2026-06-25', type: 'despesa', category: 'Impostos', marketplace: '-', description: 'Simples Nacional', amount: 3400 },

      { date: '2026-07-05', type: 'receita', category: 'Vendas', marketplace: 'Mercado Livre', description: 'Vendas do mês — Mercado Livre', amount: 21000 },
      { date: '2026-07-05', type: 'receita', category: 'Vendas', marketplace: 'Amazon', description: 'Vendas do mês — Amazon', amount: 12500 },
      { date: '2026-07-05', type: 'receita', category: 'Vendas', marketplace: 'Shopee', description: 'Vendas do mês — Shopee', amount: 9000 },
      { date: '2026-07-10', type: 'despesa', category: 'Anúncios', marketplace: '-', description: 'Tráfego pago (Google/Meta Ads)', amount: 4500 },
      { date: '2026-07-12', type: 'despesa', category: 'Taxa de Marketplace', marketplace: '-', description: 'Comissões dos marketplaces', amount: 5500 },
      { date: '2026-07-15', type: 'despesa', category: 'Fornecedor', marketplace: '-', description: 'Compra de mercadoria', amount: 17000 },
      { date: '2026-07-18', type: 'despesa', category: 'Frete', marketplace: '-', description: 'Frete e logística', amount: 1800 },
      { date: '2026-07-20', type: 'despesa', category: 'Custos Fixos', marketplace: '-', description: 'Software, contabilidade e taxas fixas', amount: 2600 }
    ],
    plannedEntries: [
      { date: '2026-08-05', description: 'Compra de estoque — reposição Fone Bluetooth', amount: -8000 },
      { date: '2026-08-15', description: 'Investimento em tráfego pago (campanha sazonal)', amount: -3000 },
      { date: '2026-09-10', description: 'Repasse extra Amazon (liquidação de pendências)', amount: 2500 }
    ]
  };
}

/* ---------- Formatação ---------- */

function yalcaFormatCurrency(value) {
  // toLocaleString insere um espaco nao-quebravel (U+00A0) entre "R$" e o
  // numero -- troca por espaco normal via regex para permitir quebra de
  // linha limpa (antes do numero inteiro, nunca no meio dele) quando o
  // valor nao cabe no card.
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(' ', ' ');
}

function yalcaFormatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function yalcaMonthLabel(isoDate) {
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [y, m] = isoDate.split('-').map(Number);
  return `${meses[m - 1]}/${String(y).slice(2)}`;
}

/* ---------- Cálculos de negócio ---------- */

function yalcaProductMargin(product, settings) {
  const feePct = settings.marketplaceFees[product.marketplace] ?? 0;
  const taxPct = settings.defaultTaxPct;
  const shipping = settings.defaultShippingCost;
  const feeValue = product.price * (feePct / 100);
  const taxValue = product.price * (taxPct / 100);
  const netProfit = product.price - product.cost - feeValue - taxValue - shipping;
  const marginPct = product.price > 0 ? (netProfit / product.price) * 100 : 0;
  return { netProfit, marginPct, feeValue, taxValue, shipping };
}

function yalcaStockStatus(product) {
  if (product.stock === 0) return 'Esgotado';
  if (product.stock < product.minStock) return 'Baixo';
  if (product.stock > product.minStock * 2 && product.unitsSoldMonth < 6) return 'Parado';
  return 'OK';
}

function yalcaGroupTransactionsByMonth(transactions) {
  const map = new Map();
  transactions.forEach(t => {
    const key = t.date.slice(0, 7); // YYYY-MM
    if (!map.has(key)) map.set(key, { key, receita: 0, despesa: 0 });
    const bucket = map.get(key);
    if (t.type === 'receita') bucket.receita += Number(t.amount);
    else bucket.despesa += Number(t.amount);
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}
