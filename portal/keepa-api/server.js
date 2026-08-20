#!/usr/bin/env node
// Yalca Portal — API Node pura pro Keepa (substitui as Edge Functions Deno
// keepa-search e keepa-seller-lookup, que rodavam no edge-runtime
// self-hosted do Supabase). Motivo da troca: o edge-runtime self-hosted
// causou vários problemas reais nessa mesma sessão — autenticação manual
// porque @supabase/server não funcionava nesse deploy, respostas OPTIONS
// quebradas (204 com corpo), e principalmente o SDK supabase-js do
// navegador descartando a mensagem de erro customizada pra qualquer status
// não-2xx. Rodando como app Node comum (mesmo padrão já usado e testado no
// amazon-deals-bot), nada disso se aplica — é só um servidor HTTP normal.
//
// O que NÃO muda: Postgres, autenticação (GoTrue) e RLS continuam sendo o
// Supabase self-hosted, do jeito que já funcionava bem — só a camada de
// Edge Functions saiu.
//
// Deploy: site Node.js no CloudPanel (keepa-api.yalca.com.br, usuário
// keepaapi, porta 3001), pasta htdocs/keepa-api.yalca.com.br/ com todo
// esse diretório keepa-api/ dentro. .env (chmod 600) com KEEPA_API_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL,
// PORTAL_ORIGIN, KEEPA_MOCK.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeRestClient } = require('./lib/rest-client');
const { makeAuthClient } = require('./lib/auth');
const {
  parseKeepaProduct, mockKeepaResponse,
  normalizeSellersResponse, parseSeller, mockSellerResponse,
} = require('./lib/keepa-parser');

function loadEnv(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}
const env = { ...loadEnv(path.join(__dirname, '.env')), ...process.env };

const PORT = Number(env.PORT || 3001);
const SUPABASE_URL = env.SUPABASE_URL || 'https://api.yalca.com.br';
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;
const KEEPA_API_KEY = env.KEEPA_API_KEY;
const KEEPA_MOCK = env.KEEPA_MOCK === 'true';
const ALLOWED_ORIGIN = env.PORTAL_ORIGIN || 'https://www.yalca.com.br';
const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_SELLER_IDS_PER_REQUEST = 50;

// Custo estimado de uma pesquisa completa — pré-checagem de orçamento
// (usada só ANTES de saber o custo real da chamada em andamento). Testes
// reais em 2026-08-20 mostraram variação de ~2 a ~12 tokens pro mesmo
// produto (plano Keepa Pro consumidor, saldo baixo/reposição lenta) — fica
// no teto observado + margem, pra nunca deixar passar uma chamada que
// estoura o orçamento diário.
const ESTIMATED_SEARCH_COST = 15;

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY e/ou SUPABASE_ANON_KEY não configuradas em .env — abortando.');
  process.exit(1);
}

const db = makeRestClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const authClient = makeAuthClient({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

function sendJson(res, status, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  res.writeHead(status, headers);
  // status 204 (No Content) proíbe body — usado pelo preflight OPTIONS.
  if (status === 204) { res.end(); return; }
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function requireUser(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) { sendJson(res, 401, { ok: false, reason: 'unauthenticated', message: 'Sessão inválida. Faça login novamente.' }); return null; }
  const user = await authClient.getUserFromToken(token);
  if (!user) { sendJson(res, 401, { ok: false, reason: 'unauthenticated', message: 'Sessão inválida. Faça login novamente.' }); return null; }
  return user;
}

async function requireApprovedClient(userId, res) {
  const [profile, adminRow] = await Promise.all([
    db.restGetOne('client_profiles', `user_id=eq.${userId}&select=status`),
    db.restGetOne('admins', `user_id=eq.${userId}&select=user_id`),
  ]);
  if (profile?.status !== 'approved' && !adminRow) {
    sendJson(res, 200, { ok: false, reason: 'not_approved', message: 'Seu acesso ainda não foi aprovado pela Yalca.' });
    return false;
  }
  return true;
}

function formatResult(cache) {
  return {
    asin: cache.asin,
    title: cache.title,
    imageUrl: cache.image_url,
    currentPrice: cache.current_price,
    bsr: cache.bsr,
    category: cache.category,
    rating: cache.rating,
    reviewCount: cache.review_count,
    buybox: cache.buybox_seller ? { seller: cache.buybox_seller, isAmazon: cache.buybox_is_amazon, price: cache.buybox_price } : null,
    offersCount: cache.offers_count,
    availabilityStatus: cache.availability_status,
    priceHistory: cache.price_history ?? { amazon: [], new: [], buybox: [] },
    bsrHistory: cache.bsr_history ?? [],
    monthlySold: cache.monthly_sold ?? null,
    referralFeePct: cache.referral_fee_pct ?? null,
    fbaFees: (cache.fba_pick_pack_fee ?? cache.fba_storage_fee) != null ? {
      pickAndPack: cache.fba_pick_pack_fee ?? null, pickAndPackTax: cache.fba_pick_pack_fee_tax ?? null,
      storage: cache.fba_storage_fee ?? null, storageTax: cache.fba_storage_fee_tax ?? null,
    } : null,
    fbaFeeTotal: [cache.fba_pick_pack_fee, cache.fba_pick_pack_fee_tax, cache.fba_storage_fee, cache.fba_storage_fee_tax]
      .filter((v) => typeof v === 'number')
      .reduce((sum, v) => (sum ?? 0) + v, null),
    offers: cache.offers ?? [],
    buyboxRotation90d: cache.buybox_rotation_90d ?? null,
    categoryRanks: cache.category_ranks ?? [],
    brand: cache.brand ?? null,
    listedSince: cache.listed_since ?? null,
    packageWeightKg: cache.package_weight_kg ?? null,
    packageDimensionsCm: cache.package_length_cm != null ? { length: cache.package_length_cm, width: cache.package_width_cm, height: cache.package_height_cm } : null,
    stats: {
      avg30: cache.price_avg_30 ?? null, avg90: cache.price_avg_90 ?? null, avg180: cache.price_avg_180 ?? null,
      lowestEver: cache.price_lowest_ever ?? null, highestEver: cache.price_highest_ever ?? null,
      isLowestEver: cache.is_lowest_ever ?? null, isLowest90d: cache.is_lowest_90d ?? null,
      outOfStockPct30: cache.out_of_stock_pct_30 ?? null, outOfStockPct90: cache.out_of_stock_pct_90 ?? null,
      salesRankDrops30: cache.sales_rank_drops_30 ?? null, salesRankDrops90: cache.sales_rank_drops_90 ?? null, salesRankDrops180: cache.sales_rank_drops_180 ?? null,
      buyBoxStats: cache.buybox_stats ?? [],
    },
    cheapDataAgeMinutes: cache.cheap_data_updated_at ? Math.round((Date.now() - new Date(cache.cheap_data_updated_at).getTime()) / 60000) : null,
    buyboxDataAgeMinutes: cache.buybox_data_updated_at ? Math.round((Date.now() - new Date(cache.buybox_data_updated_at).getTime()) / 60000) : null,
    isMockData: typeof cache.last_synced_by === 'string' && cache.last_synced_by.endsWith('_mock'),
  };
}

// Monta a linha completa pro upsert em keepa_asin_cache a partir do
// resultado já parseado — um campo novo só precisa ser adicionado AQUI
// (formatResult lê as mesmas chaves de volta).
function buildCacheRow(asin, parsed, nowIso) {
  return {
    asin, title: parsed.title, image_url: parsed.imageUrl, current_price: parsed.currentPrice, bsr: parsed.bsr,
    category: parsed.category, rating: parsed.rating, review_count: parsed.reviewCount,
    buybox_seller: parsed.buyboxSeller ?? null, buybox_is_amazon: parsed.buyboxIsAmazon ?? null, buybox_price: parsed.buyboxPrice ?? null,
    offers_count: parsed.offersCount, availability_status: parsed.availabilityStatus,
    price_history: parsed.priceHistory, monthly_sold: parsed.monthlySold, referral_fee_pct: parsed.referralFeePct,
    fba_pick_pack_fee: parsed.fbaFees?.pickAndPack ?? null, fba_pick_pack_fee_tax: parsed.fbaFees?.pickAndPackTax ?? null,
    fba_storage_fee: parsed.fbaFees?.storage ?? null, fba_storage_fee_tax: parsed.fbaFees?.storageTax ?? null,
    offers: parsed.offers, buybox_rotation_90d: parsed.buyboxRotation90d, category_ranks: parsed.categoryRanks,
    bsr_history: parsed.bsrHistory, brand: parsed.brand, listed_since: parsed.listedSince,
    package_weight_kg: parsed.packageWeightKg,
    package_length_cm: parsed.packageDimensionsCm?.length ?? null, package_width_cm: parsed.packageDimensionsCm?.width ?? null, package_height_cm: parsed.packageDimensionsCm?.height ?? null,
    price_avg_30: parsed.stats?.avg30 ?? null, price_avg_90: parsed.stats?.avg90 ?? null, price_avg_180: parsed.stats?.avg180 ?? null,
    price_lowest_ever: parsed.stats?.lowestEver ?? null, price_highest_ever: parsed.stats?.highestEver ?? null,
    is_lowest_ever: parsed.stats?.isLowestEver ?? null, is_lowest_90d: parsed.stats?.isLowest90d ?? null,
    out_of_stock_pct_30: parsed.stats?.outOfStockPct30 ?? null, out_of_stock_pct_90: parsed.stats?.outOfStockPct90 ?? null,
    sales_rank_drops_30: parsed.stats?.salesRankDrops30 ?? null, sales_rank_drops_90: parsed.stats?.salesRankDrops90 ?? null, sales_rank_drops_180: parsed.stats?.salesRankDrops180 ?? null,
    buybox_stats: parsed.stats?.buyBoxStats ?? [],
    cheap_data_updated_at: nowIso, buybox_data_updated_at: nowIso,
    // Sufixo "_mock" marca a linha como dado fictício de teste — o
    // front-end usa isso pra mostrar um aviso bem visível.
    last_synced_by: KEEPA_MOCK ? 'search_mock' : 'search',
    last_error: null,
  };
}

async function handleKeepaSearch(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  let body;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const asin = (body.asin || '').trim().toUpperCase();
  if (!ASIN_RE.test(asin)) { sendJson(res, 400, { ok: false, reason: 'invalid_asin', message: 'ASIN inválido — deve ter 10 letras/números (ex: B0EXAMPLE1).' }); return; }

  if (!(await requireApprovedClient(user.id, res))) return;

  const config = await db.restGetOne('keepa_config', 'id=eq.1&select=*');
  const cacheMaxAgeMs = (config?.search_cache_max_age_hours ?? 24) * 3600 * 1000;

  // --- cache primeiro: sempre grátis, nunca passa por checagem de cota ---
  const cached = await db.restGetOne('keepa_asin_cache', `asin=eq.${asin}&select=*`);
  const cacheAgeMs = cached?.cheap_data_updated_at ? Date.now() - new Date(cached.cheap_data_updated_at).getTime() : Infinity;
  if (cached && cacheAgeMs < cacheMaxAgeMs) {
    await db.restInsert('keepa_search_log', [{ user_id: user.id, asin, resulted_in_live_call: false }]);
    sendJson(res, 200, { ok: true, source: 'cache', ...formatResult(cached) });
    return;
  }

  // --- limite diário de pesquisas do cliente ---
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const searchesToday = await db.restCount('keepa_search_log', `user_id=eq.${user.id}&resulted_in_live_call=eq.true&searched_at=gte.${startOfDay.toISOString()}`);
  if (searchesToday >= (config?.max_searches_per_client_per_day ?? 5)) {
    sendJson(res, 200, { ok: false, reason: 'client_cap', message: 'Você atingiu o limite de pesquisas de hoje. Tente novamente amanhã.' });
    return;
  }

  // --- orçamento global de tokens ---
  const budget = await db.restGetOne('keepa_token_budget', 'id=eq.1&select=*');
  const todayStr = new Date().toISOString().slice(0, 10);
  const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0;
  const cap = config?.daily_token_cap ?? 200;
  if (spentToday + ESTIMATED_SEARCH_COST > cap) {
    sendJson(res, 200, { ok: false, reason: 'no_budget', message: 'Sem cota de consultas disponível hoje. Tente novamente amanhã.' });
    return;
  }

  // --- chamada real ao Keepa (ou mock) ---
  let parsed, tokensLeft = null, tokensConsumed = null, lowBudget = false;
  try {
    let rawProduct;
    if (KEEPA_MOCK) {
      rawProduct = mockKeepaResponse(asin);
      tokensLeft = 999; tokensConsumed = 0;
    } else {
      if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY não configurada no ambiente do servidor');
      const url = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=12&asin=${asin}&stats=180&buybox=1&offers=20&rating=1`;
      const kres = await fetch(url);
      const json = await kres.json();
      // Captura tokensLeft/tokensConsumed ANTES de checar erro/produto vazio
      // — senão um "produto não encontrado" causado por saldo insuficiente
      // fica sem nenhuma pista do saldo real (bug real encontrado 2026-08-20).
      tokensLeft = typeof json.tokensLeft === 'number' ? json.tokensLeft : null;
      tokensConsumed = typeof json.tokensConsumed === 'number' ? json.tokensConsumed : null;
      if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`);
      if (!json.products || !json.products[0]) {
        lowBudget = tokensLeft !== null && tokensLeft <= 0;
        throw new Error(lowBudget ? `Produto não encontrado no Keepa para esse ASIN (saldo de tokens baixo no momento: ${tokensLeft}).` : 'Produto não encontrado no Keepa para esse ASIN.');
      }
      rawProduct = json.products[0];
    }
    parsed = parseKeepaProduct(rawProduct);
  } catch (err) {
    await db.restInsert('keepa_token_usage_log', [{ triggered_by: 'on_demand_search', asin, success: false, error_message: String(err.message || err) }]);
    if (tokensLeft !== null) {
      await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: new Date().toISOString() });
    }
    sendJson(res, 502, {
      ok: false,
      reason: lowBudget ? 'keepa_low_budget' : 'keepa_error',
      message: lowBudget ? 'A cota de consultas está baixa no momento (reposição é lenta). Tente novamente em alguns minutos.' : 'Não foi possível consultar a Amazon agora. Tente novamente em instantes.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const cacheRow = buildCacheRow(asin, parsed, nowIso);
  await db.restUpsert('keepa_asin_cache', [cacheRow], 'asin');

  const consumedForBudget = tokensConsumed ?? ESTIMATED_SEARCH_COST;
  await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: nowIso, tokens_spent_today: spentToday + consumedForBudget, spend_day: todayStr });
  await db.restInsert('keepa_token_usage_log', [{
    triggered_by: 'on_demand_search', asin,
    tokens_before: tokensLeft !== null && tokensConsumed !== null ? tokensLeft + tokensConsumed : null,
    tokens_after: tokensLeft, tokens_consumed: tokensConsumed, success: true,
  }]);
  await db.restInsert('keepa_search_log', [{ user_id: user.id, asin, resulted_in_live_call: true }]);

  sendJson(res, 200, { ok: true, source: 'live', ...formatResult(cacheRow) });
}

async function handleKeepaSellerLookup(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  let body;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const requested = Array.isArray(body.sellerIds) ? [...new Set(body.sellerIds.filter((s) => typeof s === 'string' && s.length > 0))] : [];
  if (requested.length === 0) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Nenhum vendedor informado.' }); return; }
  if (requested.length > MAX_SELLER_IDS_PER_REQUEST) { sendJson(res, 400, { ok: false, reason: 'too_many', message: `Máximo de ${MAX_SELLER_IDS_PER_REQUEST} vendedores por vez.` }); return; }

  if (!(await requireApprovedClient(user.id, res))) return;

  const config = await db.restGetOne('keepa_config', 'id=eq.1&select=*');
  const cacheMaxAgeMs = (config?.seller_reputation_cache_max_age_days ?? 30) * 86400000;

  const cachedRows = await db.restGet('keepa_seller_cache', `seller_id=in.(${requested.join(',')})&select=*`);
  const cachedById = Object.fromEntries((cachedRows ?? []).map((r) => [r.seller_id, r]));
  const fresh = []; const missing = [];
  for (const id of requested) {
    const row = cachedById[id];
    const ageMs = row?.fetched_at ? Date.now() - new Date(row.fetched_at).getTime() : Infinity;
    if (row && ageMs < cacheMaxAgeMs) fresh.push(id); else missing.push(id);
  }

  const result = {};
  for (const id of fresh) {
    const row = cachedById[id];
    result[id] = { sellerName: row.seller_name, currentRating: row.current_rating, currentRatingCount: row.current_rating_count, hasFBA: row.has_fba, totalStorefrontAsins: row.total_storefront_asins ?? null };
  }

  if (missing.length === 0) { sendJson(res, 200, { ok: true, sellers: result }); return; }

  // --- limite diário de vendedores consultados por cliente ---
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const lookupsToday = await db.restGet('keepa_token_usage_log', `user_id=eq.${user.id}&triggered_by=eq.on_demand_seller_lookup&called_at=gte.${startOfDay.toISOString()}&select=tokens_consumed`);
  const sellersLookedUpToday = (lookupsToday ?? []).reduce((sum, r) => sum + (r.tokens_consumed ?? 0), 0);
  if (sellersLookedUpToday + missing.length > (config?.max_seller_lookups_per_client_per_day ?? 50)) {
    sendJson(res, 200, { ok: false, reason: 'client_cap', message: 'Você atingiu o limite diário de consultas de reputação de vendedor.', sellers: result });
    return;
  }

  // --- orçamento global de tokens (custo aqui é exato: 1 por vendedor) ---
  const budget = await db.restGetOne('keepa_token_budget', 'id=eq.1&select=*');
  const todayStr = new Date().toISOString().slice(0, 10);
  const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0;
  const cap = config?.daily_token_cap ?? 200;
  if (spentToday + missing.length > cap) {
    sendJson(res, 200, { ok: false, reason: 'no_budget', message: 'Sem cota de consultas disponível hoje. Tente novamente amanhã.', sellers: result });
    return;
  }

  let sellersRaw, tokensLeft = null, tokensConsumed = null;
  try {
    if (KEEPA_MOCK) {
      const mock = mockSellerResponse(missing);
      sellersRaw = mock.sellers; tokensLeft = mock.tokensLeft; tokensConsumed = mock.tokensConsumed;
    } else {
      if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY não configurada no ambiente do servidor');
      const url = `https://api.keepa.com/seller?key=${KEEPA_API_KEY}&domain=12&seller=${missing.join(',')}`;
      const kres = await fetch(url);
      const json = await kres.json();
      if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`);
      sellersRaw = normalizeSellersResponse(json);
      tokensLeft = typeof json.tokensLeft === 'number' ? json.tokensLeft : null;
      tokensConsumed = typeof json.tokensConsumed === 'number' ? json.tokensConsumed : null;
    }
  } catch (err) {
    await db.restInsert('keepa_token_usage_log', [{ triggered_by: 'on_demand_seller_lookup', user_id: user.id, success: false, error_message: String(err.message || err) }]);
    sendJson(res, 502, { ok: false, reason: 'keepa_error', message: 'Não foi possível consultar a reputação agora. Tente novamente em instantes.', sellers: result });
    return;
  }

  const nowIso = new Date().toISOString();
  const upsertRows = missing.map((id) => {
    const raw = sellersRaw[id];
    if (!raw) return { seller_id: id, seller_name: null, fetched_at: nowIso, last_error: 'not_found_at_keepa' };
    const parsed = parseSeller(raw);
    result[id] = { sellerName: parsed.sellerName, currentRating: parsed.currentRating, currentRatingCount: parsed.currentRatingCount, hasFBA: parsed.hasFBA, totalStorefrontAsins: parsed.totalStorefrontAsins };
    return {
      seller_id: id, seller_name: parsed.sellerName, current_rating: parsed.currentRating, current_rating_count: parsed.currentRatingCount,
      has_fba: parsed.hasFBA, rating_breakdown: parsed.ratingBreakdown, tracked_since_raw: parsed.trackedSinceRaw,
      total_storefront_asins: parsed.totalStorefrontAsins, fetched_at: nowIso, last_error: null,
    };
  });
  await db.restUpsert('keepa_seller_cache', upsertRows, 'seller_id');

  const consumedForBudget = tokensConsumed ?? missing.length;
  await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: nowIso, tokens_spent_today: spentToday + consumedForBudget, spend_day: todayStr });
  await db.restInsert('keepa_token_usage_log', [{
    triggered_by: 'on_demand_seller_lookup', user_id: user.id,
    tokens_before: tokensLeft !== null ? tokensLeft + consumedForBudget : null,
    tokens_after: tokensLeft, tokens_consumed: consumedForBudget, success: true,
  }]);

  sendJson(res, 200, { ok: true, sellers: result });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { sendJson(res, 204, null); return; }
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/keepa-search') { await handleKeepaSearch(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-seller-lookup') { await handleKeepaSellerLookup(req, res); return; }
    if (req.method === 'GET' && url === '/health') { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 404, { ok: false, reason: 'not_found', message: 'Rota não encontrada.' });
  } catch (err) {
    console.error('erro não tratado:', err);
    sendJson(res, 500, { ok: false, reason: 'internal_error', message: 'Erro interno. Tente novamente.' });
  }
});

server.listen(PORT, () => console.log(`keepa-api ouvindo na porta ${PORT}${KEEPA_MOCK ? ' (MOCK)' : ''}`));
