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
  parseSellerStorefront, mockSellerStorefrontResponse,
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
const KEEPA_FETCH_TIMEOUT_MS = 15_000;

// Custo estimado de uma pesquisa completa — pré-checagem de orçamento
// (usada só ANTES de saber o custo real da chamada em andamento). Testes
// reais em 2026-08-20 mostraram variação de ~2 a ~12 tokens pro mesmo
// produto (plano Keepa Pro consumidor, saldo baixo/reposição lenta) — fica
// no teto observado + margem, pra nunca deixar passar uma chamada que
// estoura o orçamento diário. Subiu de 15 pra 25 em 2026-08-21 ao ligar
// stock=1 (necessário pra popular a coluna "Estoque" da tabela de
// ofertas) — esse parâmetro cobra tokens extras por cima do custo base.
const ESTIMATED_SEARCH_COST = 25;

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

// Corpo grande demais devolve 413 explícito em vez de só destruir a conexão
// (req.destroy() sozinho derruba o socket sem resposta HTTP nenhuma — o
// cliente via um erro de rede cru em vez de uma mensagem tratável).
function readJsonBody(req, res, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (data.length > maxBytes) {
        tooLarge = true;
        sendJson(res, 413, { ok: false, reason: 'payload_too_large', message: 'Requisição grande demais.' });
        req.destroy();
        const err = new Error('payload_too_large'); err.alreadyResponded = true;
        reject(err);
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', (err) => { if (!tooLarge) reject(err); });
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

async function requireAdmin(userId, res) {
  const adminRow = await db.restGetOne('admins', `user_id=eq.${userId}&select=user_id`);
  if (!adminRow) { sendJson(res, 403, { ok: false, reason: 'forbidden', message: 'Acesso restrito a administradores.' }); return false; }
  return true;
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
    ratingHistory: cache.rating_history ?? [],
    reviewCountHistory: cache.review_count_history ?? [],
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
    color: cache.color ?? null,
    size: cache.size ?? null,
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
      offerCountFBA: cache.offer_count_fba ?? null, offerCountFBM: cache.offer_count_fbm ?? null,
      totalOfferCount: cache.total_offer_count ?? null,
      deltaPct90MonthlySold: cache.delta_pct_90_monthly_sold ?? null,
      buyBoxIsUnqualified: cache.buybox_is_unqualified ?? null, buyBoxIsMAP: cache.buybox_is_map ?? null,
      savingBasis: cache.saving_basis ?? null, savingPct: cache.saving_pct ?? null,
    },
    returnRate: cache.return_rate ?? null,
    isRedirectAsin: cache.is_redirect_asin ?? false,
    parentAsin: cache.parent_asin ?? null,
    variationsCount: cache.variations_count ?? null,
    competitivePriceThreshold: cache.competitive_price_threshold ?? null,
    suggestedLowerPrice: cache.suggested_lower_price ?? null,
    categoryBreadcrumb: cache.category_breadcrumb ?? [],
    ean: cache.ean ?? null,
    description: cache.description ?? null,
    features: cache.features ?? [],
    manufacturer: cache.manufacturer ?? null,
    model: cache.model ?? null,
    numberOfItems: cache.number_of_items ?? null,
    listPrice: cache.list_price ?? null,
    batteriesRequired: cache.batteries_required ?? null,
    batteriesIncluded: cache.batteries_included ?? null,
    isAdultProduct: cache.is_adult_product ?? null,
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
    bsr_history: parsed.bsrHistory, rating_history: parsed.ratingHistory, review_count_history: parsed.reviewCountHistory,
    brand: parsed.brand, color: parsed.color, size: parsed.size, listed_since: parsed.listedSince,
    package_weight_kg: parsed.packageWeightKg,
    package_length_cm: parsed.packageDimensionsCm?.length ?? null, package_width_cm: parsed.packageDimensionsCm?.width ?? null, package_height_cm: parsed.packageDimensionsCm?.height ?? null,
    price_avg_30: parsed.stats?.avg30 ?? null, price_avg_90: parsed.stats?.avg90 ?? null, price_avg_180: parsed.stats?.avg180 ?? null,
    price_lowest_ever: parsed.stats?.lowestEver ?? null, price_highest_ever: parsed.stats?.highestEver ?? null,
    is_lowest_ever: parsed.stats?.isLowestEver ?? null, is_lowest_90d: parsed.stats?.isLowest90d ?? null,
    out_of_stock_pct_30: parsed.stats?.outOfStockPct30 ?? null, out_of_stock_pct_90: parsed.stats?.outOfStockPct90 ?? null,
    sales_rank_drops_30: parsed.stats?.salesRankDrops30 ?? null, sales_rank_drops_90: parsed.stats?.salesRankDrops90 ?? null, sales_rank_drops_180: parsed.stats?.salesRankDrops180 ?? null,
    buybox_stats: parsed.stats?.buyBoxStats ?? [],
    offer_count_fba: parsed.stats?.offerCountFBA ?? null, offer_count_fbm: parsed.stats?.offerCountFBM ?? null,
    total_offer_count: parsed.stats?.totalOfferCount ?? null,
    delta_pct_90_monthly_sold: parsed.stats?.deltaPct90MonthlySold ?? null,
    buybox_is_unqualified: parsed.stats?.buyBoxIsUnqualified ?? null, buybox_is_map: parsed.stats?.buyBoxIsMAP ?? null,
    saving_basis: parsed.stats?.savingBasis ?? null, saving_pct: parsed.stats?.savingPct ?? null,
    return_rate: parsed.returnRate ?? null,
    is_redirect_asin: parsed.isRedirectAsin ?? false,
    parent_asin: parsed.parentAsin ?? null,
    variations_count: parsed.variationsCount ?? null,
    competitive_price_threshold: parsed.competitivePriceThreshold ?? null,
    suggested_lower_price: parsed.suggestedLowerPrice ?? null,
    category_breadcrumb: parsed.categoryBreadcrumb ?? [],
    ean: parsed.ean ?? null,
    description: parsed.description ?? null,
    features: parsed.features ?? [],
    manufacturer: parsed.manufacturer ?? null,
    model: parsed.model ?? null,
    number_of_items: parsed.numberOfItems ?? null,
    list_price: parsed.listPrice ?? null,
    batteries_required: parsed.batteriesRequired ?? null,
    batteries_included: parsed.batteriesIncluded ?? null,
    is_adult_product: parsed.isAdultProduct ?? null,
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
  try { body = await readJsonBody(req, res); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  // Aceita um ASIN direto OU um código de barras (EAN/UPC/ISBN, 8-14
  // dígitos) — o front-end (portal/js/keepa.js) já extrai o ASIN de um
  // link colado da Amazon antes de chegar aqui, então "code" só existe
  // quando o cliente colou um código de barras de verdade.
  const asinInput = typeof body.asin === 'string' ? body.asin.trim().toUpperCase() : '';
  const codeInput = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const hasAsin = ASIN_RE.test(asinInput);
  const hasCode = !hasAsin && /^\d{8,14}$/.test(codeInput);
  if (!hasAsin && !hasCode) {
    sendJson(res, 400, { ok: false, reason: 'invalid_asin', message: 'Informe um ASIN válido (10 letras/números, ex: B0EXAMPLE1), um link de produto da Amazon, ou o código de barras (EAN/UPC) do produto.' });
    return;
  }

  if (!(await requireApprovedClient(user.id, res))) return;

  const config = await db.restGetOne('keepa_config', 'id=eq.1&select=*');
  const cacheMaxAgeMs = (config?.search_cache_max_age_hours ?? 24) * 3600 * 1000;

  // --- cache primeiro: só é possível quando já sabemos o ASIN exato —
  // uma busca por código de barras só revela o ASIN DEPOIS de uma chamada
  // real ao Keepa, então não tem como checar o cache antes disso. ---
  if (hasAsin) {
    const cached = await db.restGetOne('keepa_asin_cache', `asin=eq.${asinInput}&select=*`);
    const cacheAgeMs = cached?.cheap_data_updated_at ? Date.now() - new Date(cached.cheap_data_updated_at).getTime() : Infinity;
    // Linhas vindas de import em massa (admin_upload) só têm o snapshot do
    // export do Keepa (preço/BSR/rating atuais) — sem histórico de preço,
    // ofertas, buybox stats ou ranking por categoria (o export não traz
    // isso, só a API completa do Keepa traz). Tratar essas linhas como
    // "cache completo" fazia a busca devolver um resultado com todos os
    // gráficos vazios, bem diferente do que a Keepa mostra de verdade (bug
    // real encontrado comparando com prints da tela do Keepa, 2026-08-31).
    // Por isso: a primeira busca real de um ASIN importado sempre passa
    // pela chamada ao vivo (gasta 1 token, só nesse produto específico, só
    // uma vez) — depois disso last_synced_by vira 'search' e o cache normal
    // volta a valer.
    const hasFullData = cached && cached.last_synced_by !== 'admin_upload';
    if (hasFullData && cacheAgeMs < cacheMaxAgeMs) {
      await db.restInsert('keepa_search_log', [{ user_id: user.id, asin: asinInput, resulted_in_live_call: false }]);
      sendJson(res, 200, { ok: true, source: 'cache', ...formatResult(cached) });
      return;
    }
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
  // resolvedAsin começa como o ASIN informado (se houver) e vira o ASIN
  // de verdade devolvido pelo Keepa quando a busca foi por código de
  // barras — é essa versão resolvida que vale pra cache/log a partir daqui.
  let parsed, tokensLeft = null, tokensConsumed = null, lowBudget = false, resolvedAsin = asinInput;
  try {
    let rawProduct;
    if (KEEPA_MOCK) {
      rawProduct = mockKeepaResponse(hasAsin ? asinInput : 'B0MOCKCODE');
      tokensLeft = 999; tokensConsumed = 0;
    } else {
      if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY não configurada no ambiente do servidor');
      const identifierQuery = hasAsin ? `asin=${asinInput}` : `code=${codeInput}`;
      // stock=1 é o que faz o Keepa devolver stockCSV por oferta — sem ele
      // a coluna "Estoque" da tabela de ofertas fica sempre vazia (bug real:
      // faltava esse parâmetro). Só ligado aqui na busca sob demanda — o
      // refresh em lote do cron não mostra estoque por oferta, então não
      // vale gastar o token extra ali.
      const url = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=12&${identifierQuery}&stats=180&buybox=1&offers=20&rating=1&stock=1`;
      const kres = await fetch(url, { signal: AbortSignal.timeout(KEEPA_FETCH_TIMEOUT_MS) });
      const json = await kres.json();
      // Captura tokensLeft/tokensConsumed ANTES de checar erro/produto vazio
      // — senão um "produto não encontrado" causado por saldo insuficiente
      // fica sem nenhuma pista do saldo real (bug real encontrado 2026-08-20).
      tokensLeft = typeof json.tokensLeft === 'number' ? json.tokensLeft : null;
      tokensConsumed = typeof json.tokensConsumed === 'number' ? json.tokensConsumed : null;
      if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`);
      if (!json.products || !json.products[0]) {
        lowBudget = tokensLeft !== null && tokensLeft <= 0;
        const notFoundMsg = hasCode ? 'Nenhum produto encontrado na Amazon para esse código de barras.' : 'Produto não encontrado para esse ASIN.';
        throw new Error(lowBudget ? `${notFoundMsg} (saldo de tokens baixo no momento: ${tokensLeft})` : notFoundMsg);
      }
      rawProduct = json.products[0];
    }
    if (rawProduct.asin) resolvedAsin = String(rawProduct.asin).toUpperCase();
    parsed = parseKeepaProduct(rawProduct);
  } catch (err) {
    await db.restInsert('keepa_token_usage_log', [{ triggered_by: 'on_demand_search', asin: resolvedAsin || null, success: false, error_message: String(err.message || err) }]);
    if (tokensLeft !== null) {
      await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: new Date().toISOString() });
    }
    sendJson(res, 502, {
      ok: false,
      reason: lowBudget ? 'keepa_low_budget' : 'keepa_error',
      message: lowBudget
        ? 'Pesquisa temporariamente indisponível — a cota de consultas do dia está baixa e se recompõe aos poucos. Não é um erro no seu cadastro; tente de novo em alguns minutos.'
        : 'Não foi possível consultar a Amazon agora. Tente novamente em instantes.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const cacheRow = buildCacheRow(resolvedAsin, parsed, nowIso);
  await db.restUpsert('keepa_asin_cache', [cacheRow], 'asin');

  const consumedForBudget = tokensConsumed ?? ESTIMATED_SEARCH_COST;
  await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: nowIso, tokens_spent_today: spentToday + consumedForBudget, spend_day: todayStr });
  await db.restInsert('keepa_token_usage_log', [{
    triggered_by: 'on_demand_search', asin: resolvedAsin,
    tokens_before: tokensLeft !== null && tokensConsumed !== null ? tokensLeft + tokensConsumed : null,
    tokens_after: tokensLeft, tokens_consumed: tokensConsumed, success: true,
  }]);
  await db.restInsert('keepa_search_log', [{ user_id: user.id, asin: resolvedAsin, resulted_in_live_call: true }]);

  sendJson(res, 200, { ok: true, source: 'live', ...formatResult(cacheRow) });
}

async function handleKeepaSellerLookup(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  let body;
  try { body = await readJsonBody(req, res); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
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
      const kres = await fetch(url, { signal: AbortSignal.timeout(KEEPA_FETCH_TIMEOUT_MS) });
      const json = await kres.json();
      if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`);
      // Resposta sem a chave "sellers" não significa "nenhum desses
      // vendedores existe" — na prática acontece quando a cota de tokens
      // está esgotada no momento (ex: tokensLeft negativo). Tratar isso
      // como "não encontrado" fazia o cache guardar not_found_at_keepa por
      // até seller_reputation_cache_max_age_days (30 dias) pra vendedores
      // reais, então o nome nunca mais era buscado de novo mesmo depois da
      // cota se recompor — bug real encontrado em 2026-08-21. Lançando erro
      // aqui garante que essa rodada não escreve nada no cache, e a
      // próxima pesquisa tenta de novo do zero.
      if (json.sellers === undefined) {
        throw new Error(`Keepa não retornou dados de vendedor agora (cota de tokens provavelmente baixa; tokensLeft=${json.tokensLeft ?? 'desconhecido'}).`);
      }
      sellersRaw = normalizeSellersResponse(json);
      tokensLeft = typeof json.tokensLeft === 'number' ? json.tokensLeft : null;
      tokensConsumed = typeof json.tokensConsumed === 'number' ? json.tokensConsumed : null;
    }
  } catch (err) {
    await db.restInsert('keepa_token_usage_log', [{ triggered_by: 'on_demand_seller_lookup', user_id: user.id, success: false, error_message: String(err.message || err) }]);
    sendJson(res, 502, { ok: false, reason: 'keepa_error', message: 'Reputação dos vendedores temporariamente indisponível — a cota de consultas do dia está baixa. Não é um erro no seu cadastro; tente de novo em alguns minutos.', sellers: result });
    return;
  }

  const nowIso = new Date().toISOString();
  // BUG REAL encontrado em 2026-08-22: quando o lote tem uma MISTURA de
  // vendedores encontrados e não encontrados na Keepa (comum e esperado —
  // nem todo ID pedido existe de verdade), os objetos montados aqui tinham
  // conjuntos de chaves DIFERENTES (o "não encontrado" só tinha 4 campos, o
  // "encontrado" tinha 9) — o PostgREST recusa um upsert em lote assim
  // ("All object keys must match", código PGRST102), e como essa chamada
  // não estava dentro do try/catch de cima, o erro subia sem resposta
  // nenhuma pro cliente (aparecia como falha de CORS no navegador, sintoma
  // enganoso de uma exceção não tratada). Corrigido pra todo objeto ter
  // sempre as MESMAS chaves (null nos campos que não se aplicam).
  const upsertRows = missing.map((id) => {
    const raw = sellersRaw[id];
    if (!raw) {
      return {
        seller_id: id, seller_name: null, current_rating: null, current_rating_count: null,
        has_fba: null, rating_breakdown: null, tracked_since_raw: null,
        total_storefront_asins: null, fetched_at: nowIso, last_error: 'not_found_at_keepa',
      };
    }
    const parsed = parseSeller(raw);
    result[id] = { sellerName: parsed.sellerName, currentRating: parsed.currentRating, currentRatingCount: parsed.currentRatingCount, hasFBA: parsed.hasFBA, totalStorefrontAsins: parsed.totalStorefrontAsins };
    return {
      seller_id: id, seller_name: parsed.sellerName, current_rating: parsed.currentRating, current_rating_count: parsed.currentRatingCount,
      has_fba: parsed.hasFBA, rating_breakdown: parsed.ratingBreakdown, tracked_since_raw: parsed.trackedSinceRaw,
      total_storefront_asins: parsed.totalStorefrontAsins, fetched_at: nowIso, last_error: null,
    };
  });
  try {
    await db.restUpsert('keepa_seller_cache', upsertRows, 'seller_id');
  } catch (err) {
    // Não deixa um erro de escrita no cache derrubar a resposta inteira —
    // os vendedores já resolvidos (result) ainda são úteis pro cliente
    // mesmo que essa rodada não tenha conseguido salvar em cache.
    console.error('keepa_seller_cache upsert falhou (não fatal):', err.message || err);
  }

  const consumedForBudget = tokensConsumed ?? missing.length;
  await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: nowIso, tokens_spent_today: spentToday + consumedForBudget, spend_day: todayStr });
  await db.restInsert('keepa_token_usage_log', [{
    triggered_by: 'on_demand_seller_lookup', user_id: user.id,
    tokens_before: tokensLeft !== null ? tokensLeft + consumedForBudget : null,
    tokens_after: tokensLeft, tokens_consumed: consumedForBudget, success: true,
  }]);

  sendJson(res, 200, { ok: true, sellers: result });
}

// Saldo de tokens do Keepa em tempo real — admin only. O endpoint /token
// da Keepa é gratuito (não consome token nenhum pra consultar), então dá
// pra chamar ao vivo toda vez sem custo, em vez de mostrar só o último
// valor conhecido salvo no banco (que pode estar horas desatualizado).
async function handleKeepaTokenStatus(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireAdmin(user.id, res))) return;

  const [config, budget] = await Promise.all([
    db.restGetOne('keepa_config', 'id=eq.1&select=daily_token_cap'),
    db.restGetOne('keepa_token_budget', 'id=eq.1&select=*'),
  ]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0;
  const dailyCap = config?.daily_token_cap ?? 200;

  if (KEEPA_MOCK) {
    sendJson(res, 200, { ok: true, tokensLeft: 999, refillIn: 0, refillRate: 5, dailyCap, spentToday, isMockData: true });
    return;
  }
  if (!KEEPA_API_KEY) { sendJson(res, 500, { ok: false, reason: 'no_api_key', message: 'KEEPA_API_KEY não configurada no servidor.' }); return; }

  try {
    const kres = await fetch(`https://api.keepa.com/token?key=${KEEPA_API_KEY}`, { signal: AbortSignal.timeout(KEEPA_FETCH_TIMEOUT_MS) });
    const json = await kres.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    sendJson(res, 200, {
      ok: true,
      tokensLeft: typeof json.tokensLeft === 'number' ? json.tokensLeft : null,
      refillIn: typeof json.refillIn === 'number' ? json.refillIn : null,
      refillRate: typeof json.refillRate === 'number' ? json.refillRate : null,
      dailyCap, spentToday,
    });
  } catch (err) {
    sendJson(res, 502, { ok: false, reason: 'keepa_error', message: 'Não foi possível consultar o saldo agora: ' + String(err.message || err) });
  }
}

// Sincroniza a vitrine de um vendedor com "Meus Anúncios" de um cliente —
// só admin (é quem cadastra o seller ID no client_profiles.amazon_seller_id
// primeiro). storefront=1 no /seller não custa token por ASIN retornado
// (só o custo normal de um lookup de vendedor, ~1-2 tokens) — é o jeito
// barato de descobrir TODOS os produtos do vendedor de uma vez, sem
// precisar que o cliente cadastre ASIN por ASIN.
async function handleSyncSellerStorefront(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireAdmin(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req, res); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
  if (!targetUserId) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Cliente não informado.' }); return; }

  const profile = await db.restGetOne('client_profiles', `user_id=eq.${targetUserId}&select=amazon_seller_id`);
  const sellerId = profile?.amazon_seller_id;
  if (!sellerId) { sendJson(res, 400, { ok: false, reason: 'no_seller_id', message: 'Esse cliente ainda não tem um seller ID da Amazon cadastrado.' }); return; }

  const config = await db.restGetOne('keepa_config', 'id=eq.1&select=*');
  const budget = await db.restGetOne('keepa_token_budget', 'id=eq.1&select=*');
  const todayStr = new Date().toISOString().slice(0, 10);
  const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0;
  const cap = config?.daily_token_cap ?? 200;
  const ESTIMATED_STOREFRONT_COST = 2;
  if (spentToday + ESTIMATED_STOREFRONT_COST > cap) {
    sendJson(res, 200, { ok: false, reason: 'no_budget', message: 'Sem cota de consultas disponível hoje. Tente novamente amanhã.' });
    return;
  }

  let parsed, tokensLeft = null, tokensConsumed = null;
  try {
    let rawSeller;
    if (KEEPA_MOCK) {
      const mock = mockSellerStorefrontResponse(sellerId);
      rawSeller = mock.seller; tokensLeft = mock.tokensLeft; tokensConsumed = mock.tokensConsumed;
    } else {
      if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY não configurada no ambiente do servidor');
      const url = `https://api.keepa.com/seller?key=${KEEPA_API_KEY}&domain=12&seller=${encodeURIComponent(sellerId)}&storefront=1`;
      const kres = await fetch(url, { signal: AbortSignal.timeout(KEEPA_FETCH_TIMEOUT_MS) });
      const json = await kres.json();
      if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`);
      tokensLeft = typeof json.tokensLeft === 'number' ? json.tokensLeft : null;
      tokensConsumed = typeof json.tokensConsumed === 'number' ? json.tokensConsumed : null;
      const sellersMap = normalizeSellersResponse(json);
      rawSeller = sellersMap[sellerId];
      if (!rawSeller) throw new Error('Vendedor não encontrado no Keepa para esse seller ID — confirme se está correto.');
    }
    parsed = parseSellerStorefront(rawSeller);
  } catch (err) {
    await db.restInsert('keepa_token_usage_log', [{ triggered_by: 'seller_storefront_sync', user_id: targetUserId, success: false, error_message: String(err.message || err) }]);
    sendJson(res, 502, { ok: false, reason: 'keepa_error', message: String(err.message || err) });
    return;
  }

  const nowIso = new Date().toISOString();
  await db.restUpsert('keepa_seller_metrics', [{
    user_id: targetUserId, seller_id: sellerId, seller_name: parsed.sellerName,
    business_name: parsed.businessName, address: parsed.address, trade_number: parsed.tradeNumber,
    current_rating: parsed.currentRating, current_rating_count: parsed.currentRatingCount,
    has_fba: parsed.hasFBA, buybox_new_ownership_pct: parsed.buyBoxNewOwnershipPct,
    buybox_used_ownership_pct: parsed.buyBoxUsedOwnershipPct, avg_buybox_competitors: parsed.avgBuyBoxCompetitors,
    tracked_since: parsed.trackedSince, total_storefront_asins: parsed.totalStorefrontAsins,
    category_stats: parsed.categoryStats, brand_stats: parsed.brandStats,
    last_synced_at: nowIso, last_error: null,
  }], 'user_id');

  // Só ADICIONA ASINs novos da vitrine, respeitando o teto configurado —
  // não mexe em ASINs que o cliente/admin já tinha adicionado manualmente.
  // dedupe (Set) antes de tudo: um ASIN repetido dentro do próprio
  // asinList faria o INSERT em lote falhar por chave duplicada
  // (user_id, asin) — bug real reproduzido testando com dados de mock,
  // mas a mesma defesa vale contra qualquer duplicata vinda do Keepa real.
  const uniqueAsinList = [...new Set(parsed.asinList)];
  const capAsins = config?.max_tracked_asins_per_client ?? 15;
  const existing = await db.restGet('keepa_tracked_asins', `user_id=eq.${targetUserId}&active=eq.true&select=asin`);
  const existingSet = new Set((existing ?? []).map((r) => r.asin));
  const room = Math.max(0, capAsins - existingSet.size);
  const toAdd = uniqueAsinList.filter((a) => !existingSet.has(a)).slice(0, room);
  if (toAdd.length > 0) {
    await db.restInsert('keepa_tracked_asins', toAdd.map((asin) => ({ user_id: targetUserId, asin, label: '', own_seller_name: sellerId })));
  }
  const totalNewFromStorefront = uniqueAsinList.filter((a) => !existingSet.has(a)).length;

  await db.restUpdate('keepa_token_budget', 'id=eq.1', { last_known_tokens_left: tokensLeft, last_checked_at: nowIso, tokens_spent_today: spentToday + (tokensConsumed ?? ESTIMATED_STOREFRONT_COST), spend_day: todayStr });
  await db.restInsert('keepa_token_usage_log', [{
    triggered_by: 'seller_storefront_sync', user_id: targetUserId,
    tokens_after: tokensLeft, tokens_consumed: tokensConsumed ?? ESTIMATED_STOREFRONT_COST, success: true,
  }]);

  sendJson(res, 200, {
    ok: true, sellerName: parsed.sellerName, totalStorefrontAsins: parsed.totalStorefrontAsins,
    asinsAdded: toAdd.length, asinsSkippedCap: Math.max(0, totalNewFromStorefront - toAdd.length),
  });
}

// Import em massa de exports do Keepa (Localizador de Produtos / Lista de
// Vendedores), feitos manualmente pelo admin fora do orçamento de tokens
// do plano — o navegador já faz o parse do XLSX e manda só os campos
// mapeados (não o arquivo cru), em lotes. Aqui só valida e grava; marcar
// cheap_data_updated_at/buybox_data_updated_at como "agora" é o que faz
// handleKeepaSearch tratar isso como cache fresco e não gastar token na
// próxima busca por esse ASIN — esse é o ganho real da funcionalidade.
const MAX_IMPORT_BODY_BYTES = 20_000_000;
const IMPORT_CHUNK_SIZE = 500;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function handleKeepaImportProducts(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireAdmin(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req, res, MAX_IMPORT_BODY_BYTES); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Nenhuma linha pra importar.' }); return; }

  const nowIso = new Date().toISOString();
  const valid = [];
  let skipped = 0;
  for (const r of rows) {
    const asin = typeof r.asin === 'string' ? r.asin.trim().toUpperCase() : '';
    if (!ASIN_RE.test(asin)) { skipped += 1; continue; }
    valid.push({
      asin, title: r.title ?? null, image_url: r.image_url ?? null,
      current_price: r.current_price ?? null, buybox_price: r.buybox_price ?? null,
      buybox_seller: r.buybox_seller ?? null, buybox_is_amazon: r.buybox_is_amazon ?? null,
      bsr: r.bsr ?? null, category: r.category ?? null, category_breadcrumb: r.category_breadcrumb ?? [],
      rating: r.rating ?? null, review_count: r.review_count ?? null,
      offers_count: r.offers_count ?? null, total_offer_count: r.total_offer_count ?? null,
      brand: r.brand ?? null, manufacturer: r.manufacturer ?? null, model: r.model ?? null,
      color: r.color ?? null, size: r.size ?? null,
      description: r.description ?? null, features: r.features ?? [],
      ean: r.ean ?? null,
      package_weight_kg: r.package_weight_kg ?? null,
      package_length_cm: r.package_length_cm ?? null, package_width_cm: r.package_width_cm ?? null, package_height_cm: r.package_height_cm ?? null,
      batteries_required: r.batteries_required ?? null, batteries_included: r.batteries_included ?? null,
      is_adult_product: r.is_adult_product ?? null,
      listed_since: r.listed_since ?? null, list_price: r.list_price ?? null,
      competitive_price_threshold: r.competitive_price_threshold ?? null, suggested_lower_price: r.suggested_lower_price ?? null,
      parent_asin: r.parent_asin ?? null, variations_count: r.variations_count ?? null,
      cheap_data_updated_at: nowIso, buybox_data_updated_at: nowIso,
      last_synced_by: 'admin_upload', last_error: null,
    });
  }

  let imported = 0;
  for (const chunk of chunkArray(valid, IMPORT_CHUNK_SIZE)) {
    try {
      await db.restUpsert('keepa_asin_cache', chunk, 'asin');
      imported += chunk.length;
    } catch (err) {
      console.error('keepa_asin_cache import (lote) falhou:', err.message || err);
    }
  }

  sendJson(res, 200, { ok: true, imported, skipped, total: rows.length });
}

async function handleKeepaImportSellers(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireAdmin(user.id, res))) return;

  let body;
  try { body = await readJsonBody(req, res, MAX_IMPORT_BODY_BYTES); } catch (err) { if (!err.alreadyResponded) sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Requisição inválida.' }); return; }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) { sendJson(res, 400, { ok: false, reason: 'invalid_body', message: 'Nenhuma linha pra importar.' }); return; }

  const nowIso = new Date().toISOString();
  const valid = [];
  let skipped = 0;
  for (const r of rows) {
    const sellerId = typeof r.seller_id === 'string' ? r.seller_id.trim() : '';
    if (!sellerId) { skipped += 1; continue; }
    valid.push({
      seller_id: sellerId, seller_name: r.seller_name ?? null,
      current_rating: r.current_rating ?? null, current_rating_count: r.current_rating_count ?? null,
      has_fba: r.has_fba ?? null, rating_breakdown: r.rating_breakdown ?? null,
      total_storefront_asins: r.total_storefront_asins ?? null,
      fetched_at: nowIso, last_error: null,
    });
  }

  let imported = 0;
  for (const chunk of chunkArray(valid, IMPORT_CHUNK_SIZE)) {
    try {
      await db.restUpsert('keepa_seller_cache', chunk, 'seller_id');
      imported += chunk.length;
    } catch (err) {
      console.error('keepa_seller_cache import (lote) falhou:', err.message || err);
    }
  }

  sendJson(res, 200, { ok: true, imported, skipped, total: rows.length });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { sendJson(res, 204, null); return; }
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/keepa-search') { await handleKeepaSearch(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-seller-lookup') { await handleKeepaSellerLookup(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-sync-storefront') { await handleSyncSellerStorefront(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-token-status') { await handleKeepaTokenStatus(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-import-products') { await handleKeepaImportProducts(req, res); return; }
    if (req.method === 'POST' && url === '/keepa-import-sellers') { await handleKeepaImportSellers(req, res); return; }
    if (req.method === 'GET' && url === '/health') { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 404, { ok: false, reason: 'not_found', message: 'Rota não encontrada.' });
  } catch (err) {
    console.error('erro não tratado:', err);
    sendJson(res, 500, { ok: false, reason: 'internal_error', message: 'Erro interno. Tente novamente.' });
  }
});

server.listen(PORT, () => console.log(`keepa-api ouvindo na porta ${PORT}${KEEPA_MOCK ? ' (MOCK)' : ''}`));
