#!/usr/bin/env node
// Yalca Portal — job agendado: atualização em lote de "Meus Anúncios" (Keepa)
//
// Roda de hora em hora (crontab), mas só gasta token de verdade nos ASINs
// que realmente venceram a cadência configurada em keepa_config — a
// checagem em si (ver o que está velho) é gratuita, são leituras REST.
//
// Fala com a REST API do PostgREST (a mesma que o navegador já usa) usando
// a service_role key, em vez de bash + docker exec + psql: não tem jq na
// VPS, e o Postgres não tem porta exposta pra fora do container — então
// montar SQL à mão pra dado vindo de uma API de terceiro (títulos com
// aspas etc.) seria um risco real de escaping. fetch() + JSON já resolve
// isso de graça.
//
// Deploy: copiar pra /root/keepa/refresh-keepa-cache.js na VPS, criar
// /root/keepa/.env (chmod 600) com KEEPA_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_URL, e opcionalmente KEEPA_MOCK=true pra testar sem gastar token.
// Crontab: 0 * * * * /usr/bin/node /root/keepa/refresh-keepa-cache.js >> /var/log/keepa-refresh.log 2>&1

const fs = require('fs');
const path = require('path');

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
const SUPABASE_URL = env.SUPABASE_URL || 'https://api.yalca.com.br';
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const KEEPA_API_KEY = env.KEEPA_API_KEY;
const KEEPA_MOCK = env.KEEPA_MOCK === 'true';

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY não configurada em .env — abortando.');
  process.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function restGet(table, query) {
  const res = await fetch(`${REST}/${table}?${query}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${table} falhou: ${res.status} ${await res.text()}`);
  return res.json();
}
async function restUpsert(table, rows, onConflict) {
  const res = await fetch(`${REST}/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`UPSERT ${table} falhou: ${res.status} ${await res.text()}`);
  return res.json();
}
async function restInsert(table, rows) {
  const res = await fetch(`${REST}/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`INSERT ${table} falhou: ${res.status} ${await res.text()}`);
}
async function restUpdate(table, query, patch) {
  const res = await fetch(`${REST}/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`UPDATE ${table} falhou: ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------
// Conversão de campos do Keepa — mesma lógica da Edge Function
// keepa-search (portal/edge-functions/keepa-search/index.ts),
// mantida em sincronia manualmente já que são runtimes diferentes
// (Node aqui, Deno lá) sem um jeito simples de compartilhar módulo.
// v8 acrescentou: monthlySold, referralFeePercentage, fbaFees,
// offers[], buyBoxSellerIdHistory (rotatividade), salesRanks — se
// mexer num, mexer no outro também.
// ---------------------------------------------------------
const KEEPA_EPOCH_OFFSET_MIN = 21564000;
function keepaTimeToIso(keepaTime) {
  return new Date((keepaTime + KEEPA_EPOCH_OFFSET_MIN) * 60000).toISOString();
}
function nowKeepaTime() {
  return Math.floor(Date.now() / 60000) - KEEPA_EPOCH_OFFSET_MIN;
}
function centsToReais(cents) {
  if (cents === null || cents === undefined || cents < 0) return null;
  return Math.round(cents) / 100;
}
function extractCsvSeries(csv, typeIndex, isPrice) {
  const series = csv && csv[typeIndex];
  if (!Array.isArray(series)) return [];
  const points = [];
  for (let i = 0; i + 1 < series.length; i += 2) {
    const rawValue = series[i + 1];
    if (rawValue === -1 || rawValue === null || rawValue === undefined) continue;
    points.push({ date: keepaTimeToIso(series[i]), value: isPrice ? (centsToReais(rawValue) ?? 0) : rawValue });
  }
  return points;
}
function lastValue(points) { return points.length > 0 ? points[points.length - 1].value : null; }
const AVAILABILITY_LABELS = { '-1': 'sem oferta', 0: 'em estoque', 1: 'pré-venda', 2: 'desconhecido', 3: 'sob encomenda', 4: 'atrasado' };
const CONDITION_LABELS = {
  0: 'Desconhecida', 1: 'Novo', 2: 'Usado - Como novo', 3: 'Usado - Muito bom', 4: 'Usado - Bom',
  5: 'Usado - Aceitável', 6: 'Recondicionado', 7: 'Coleção - Como novo', 8: 'Coleção - Muito bom',
  9: 'Coleção - Bom', 10: 'Coleção - Aceitável',
};

function parseOffers(offers) {
  if (!Array.isArray(offers)) return [];
  const parsed = offers.map((o) => {
    const csv = Array.isArray(o.offerCSV) ? o.offerCSV : [];
    const last3 = csv.length >= 3 ? csv.slice(-3) : null;
    const price = last3 ? centsToReais(last3[1]) : null;
    const shipping = last3 ? centsToReais(last3[2]) : null;
    const stockCsv = Array.isArray(o.stockCSV) ? o.stockCSV : [];
    const stock = stockCsv.length >= 2 ? stockCsv[stockCsv.length - 1] : null;
    let coupon = null;
    if (typeof o.coupon === 'number' && o.coupon !== 0) {
      coupon = o.coupon > 0 ? { type: 'amount', value: centsToReais(o.coupon) ?? 0 } : { type: 'percent', value: Math.abs(o.coupon) };
    }
    return {
      sellerId: o.sellerId ?? null, price, shipping,
      condition: CONDITION_LABELS[o.condition] ?? `Condição #${o.condition}`,
      isFBA: !!o.isFBA, isAmazon: !!o.isAmazon, isPrime: !!o.isPrime, isWarehouseDeal: !!o.isWarehouseDeal,
      stock: typeof stock === 'number' ? stock : null,
      minOrderQty: typeof o.minOrderQty === 'number' ? o.minOrderQty : null,
      coupon, lastSeen: typeof o.lastSeen === 'number' ? keepaTimeToIso(o.lastSeen) : null,
    };
  });
  parsed.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return parsed;
}

function computeBuyboxRotation(history, windowDays) {
  let flat = [];
  if (typeof history === 'string' && history.length > 0) flat = history.split(',');
  else if (Array.isArray(history)) flat = history;
  else return null;
  if (flat.length < 4) return 0;
  const cutoff = nowKeepaTime() - windowDays * 1440;
  let prevSeller = null;
  let transitions = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const time = Number(flat[i]);
    const seller = String(flat[i + 1]);
    if (Number.isNaN(time) || time < cutoff) continue;
    if (prevSeller !== null && seller !== prevSeller) transitions++;
    prevSeller = seller;
  }
  return transitions;
}

function parseCategoryRanks(salesRanks, salesRankReference, categoryTree, primaryCategoryName) {
  if (!salesRanks || typeof salesRanks !== 'object') return [];
  const treeById = new Map();
  if (Array.isArray(categoryTree)) {
    for (const c of categoryTree) {
      if (c && c.catId !== undefined && c.catId !== null && c.name) treeById.set(String(c.catId), c.name);
    }
  }
  const rows = [];
  for (const [categoryId, history] of Object.entries(salesRanks)) {
    if (!Array.isArray(history) || history.length < 2) continue;
    const rank = history[history.length - 1];
    if (rank === -1 || rank === undefined) continue;
    const isPrimary = String(salesRankReference) === categoryId;
    const categoryName = treeById.get(categoryId) ?? (isPrimary ? primaryCategoryName : null) ?? `Categoria #${categoryId}`;
    rows.push({ categoryId, categoryName, rank, isPrimary });
  }
  rows.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  return rows;
}

function parseKeepaProduct(p) {
  const priceHistoryNew = extractCsvSeries(p.csv, 1, true);
  const priceHistoryAmazon = extractCsvSeries(p.csv, 0, true);
  const bsrHistory = extractCsvSeries(p.csv, 3, false);
  const ratingHistory = extractCsvSeries(p.csv, 16, false);
  const reviewCountHistory = extractCsvSeries(p.csv, 17, false);
  const buyboxPrice = centsToReais(p.buyBoxPrice);
  const currentPrice = buyboxPrice ?? lastValue(priceHistoryNew) ?? lastValue(priceHistoryAmazon);
  const priceHistory = [...priceHistoryAmazon, ...priceHistoryNew].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  const category = Array.isArray(p.categoryTree) && p.categoryTree.length > 0 ? p.categoryTree[p.categoryTree.length - 1]?.name ?? null : null;
  const fbaFees = p.fbaFees ? {
    pickAndPack: centsToReais(p.fbaFees.pickAndPackFee),
    pickAndPackTax: centsToReais(p.fbaFees.pickAndPackFeeTax),
    storage: centsToReais(p.fbaFees.storageFee),
    storageTax: centsToReais(p.fbaFees.storageFeeTax),
  } : null;
  return {
    title: p.title ?? null,
    currentPrice,
    bsr: lastValue(bsrHistory),
    category,
    rating: lastValue(ratingHistory) !== null ? lastValue(ratingHistory) / 10 : null,
    reviewCount: lastValue(reviewCountHistory),
    buyboxSeller: p.buyBoxSellerId ?? null,
    buyboxIsAmazon: !!p.buyBoxIsAmazon,
    buyboxPrice,
    offersCount: typeof p.offersCount === 'number' ? p.offersCount : (Array.isArray(p.offers) ? p.offers.length : null),
    availabilityStatus: AVAILABILITY_LABELS[String(p.availabilityAmazon)] ?? null,
    priceHistory,
    monthlySold: typeof p.monthlySold === 'number' ? p.monthlySold : null,
    referralFeePct: typeof p.referralFeePercentage === 'number' ? p.referralFeePercentage : null,
    fbaFees,
    offers: parseOffers(p.offers),
    buyboxRotation90d: computeBuyboxRotation(p.buyBoxSellerIdHistory, 90),
    categoryRanks: parseCategoryRanks(p.salesRanks, p.salesRankReference, p.categoryTree, category),
  };
}

function mockKeepaResponse(asin) {
  const now = nowKeepaTime();
  // Alterna o vendedor da buybox pra sempre gerar um alerta de teste
  const seller = Math.random() > 0.5 ? 'A1MOCKSELLER' : 'A2OUTROSELLER';
  return {
    asin,
    title: `Produto de teste (mock) ${asin}`,
    buyBoxSellerId: seller,
    buyBoxIsAmazon: false,
    buyBoxPrice: 10000 + Math.floor(Math.random() * 5000),
    offersCount: 3,
    availabilityAmazon: 0,
    categoryTree: [{ catId: 100, name: 'Categoria Mock' }],
    monthlySold: 200,
    referralFeePercentage: 15.0,
    fbaFees: { pickAndPackFee: 605, pickAndPackFeeTax: 0, storageFee: 40, storageFeeTax: 0 },
    salesRankReference: 100,
    salesRanks: { '100': [now - 60 * 24 * 2, 18000] },
    buyBoxSellerIdHistory: [now - 60 * 24 * 10, 'A1MOCKSELLER', now - 60 * 24 * 5, 'A2OUTROSELLER', now, seller],
    offers: [
      { sellerId: 'A1MOCKSELLER', condition: 1, isFBA: true, isAmazon: false, isPrime: true, offerCSV: [now, 10500, 0], stockCSV: [now, 50], lastSeen: now, coupon: 0 },
      { sellerId: 'A2OUTROSELLER', condition: 1, isFBA: false, isAmazon: false, isPrime: false, offerCSV: [now, 11200, 15], stockCSV: [now, 12], lastSeen: now, coupon: 0 },
    ],
    csv: [
      null,
      [now - 60 * 24 * 2, 11500, now, 12500],
      null,
      [now - 60 * 24 * 2, 20000, now, 18000],
      null, null, null, null, null, null, null, null, null, null, null, null,
      [now, 42],
      [now, 210],
    ],
  };
}

async function callKeepa(asin) {
  if (KEEPA_MOCK) {
    return { product: mockKeepaResponse(asin), tokensLeft: 999, tokensConsumed: 0 };
  }
  if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY não configurada');
  const url = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=12&asin=${asin}&stats=180&buybox=1&offers=20&rating=1`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Keepa: ${json.error.message || JSON.stringify(json.error)}`);
  if (!json.products || !json.products[0]) throw new Error('Produto não encontrado no Keepa.');
  return { product: json.products[0], tokensLeft: json.tokensLeft ?? null, tokensConsumed: json.tokensConsumed ?? null };
}

// Compara o snapshot novo com o antigo e devolve os alertas a gerar
// (mensagem NEUTRA — quem vê a tela decide se personaliza pra "você",
// comparando com o own_seller_name do próprio ASIN rastreado; o cache
// é compartilhado entre clientes, então não dá pra saber aqui de quem
// é a loja).
function diffAlerts(asin, oldRow, newData, priceAlertThresholdPct) {
  const alerts = [];
  if (!oldRow) return alerts; // primeira vez que vemos esse ASIN, nada a comparar

  const oldSeller = oldRow.buybox_seller;
  const newSeller = newData.buyboxSeller;
  if (oldSeller !== newSeller) {
    if (oldSeller && !newSeller) {
      alerts.push({ asin, alert_type: 'buybox_lost', message: `Ninguém está ganhando a buybox agora (antes era ${oldSeller}).`, previous_value: { seller: oldSeller }, new_value: null });
    } else if (!oldSeller && newSeller) {
      alerts.push({ asin, alert_type: 'buybox_regained', message: `${newSeller} passou a ganhar a buybox.`, previous_value: null, new_value: { seller: newSeller } });
    } else if (oldSeller && newSeller) {
      alerts.push({ asin, alert_type: 'buybox_changed', message: `A buybox mudou de ${oldSeller} para ${newSeller}.`, previous_value: { seller: oldSeller }, new_value: { seller: newSeller } });
    }
  }

  const oldPrice = oldRow.buybox_price ?? oldRow.current_price;
  const newPrice = newData.buyboxPrice ?? newData.currentPrice;
  if (oldPrice && newPrice) {
    const pctChange = ((newPrice - oldPrice) / oldPrice) * 100;
    if (Math.abs(pctChange) >= (priceAlertThresholdPct || 5)) {
      alerts.push({
        asin,
        alert_type: pctChange < 0 ? 'price_drop' : 'price_increase',
        message: `Preço ${pctChange < 0 ? 'caiu' : 'subiu'} ${Math.abs(pctChange).toFixed(1)}% (de R$ ${oldPrice.toFixed(2)} para R$ ${newPrice.toFixed(2)}).`,
        previous_value: { price: oldPrice },
        new_value: { price: newPrice },
      });
    }
  }

  if (oldRow.availability_status === 'em estoque' && newData.availabilityStatus !== 'em estoque') {
    alerts.push({ asin, alert_type: 'out_of_stock', message: 'Produto ficou sem estoque na Amazon.', previous_value: null, new_value: null });
  } else if (oldRow.availability_status && oldRow.availability_status !== 'em estoque' && newData.availabilityStatus === 'em estoque') {
    alerts.push({ asin, alert_type: 'back_in_stock', message: 'Produto voltou a ter estoque na Amazon.', previous_value: null, new_value: null });
  }

  if (oldRow.rating !== null && newData.rating !== null && newData.rating < oldRow.rating - 0.1) {
    alerts.push({ asin, alert_type: 'rating_drop', message: `Avaliação caiu de ${oldRow.rating.toFixed(1)} para ${newData.rating.toFixed(1)}.`, previous_value: { rating: oldRow.rating }, new_value: { rating: newData.rating } });
  }

  return alerts;
}

async function main() {
  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] iniciando refresh-keepa-cache${KEEPA_MOCK ? ' (MOCK)' : ''}`);

  const [config] = await restGet('keepa_config', 'id=eq.1&select=*');
  const [budgetRow] = await restGet('keepa_token_budget', 'id=eq.1&select=*');
  if (!config || !budgetRow) throw new Error('keepa_config ou keepa_token_budget não encontrado — rodou a migração v7?');

  const todayStr = new Date().toISOString().slice(0, 10);
  let spentToday = budgetRow.spend_day === todayStr ? (budgetRow.tokens_spent_today || 0) : 0;
  let lastKnownTokensLeft = budgetRow.last_known_tokens_left;
  const cap = config.daily_token_cap ?? 200;

  const tracked = await restGet('keepa_tracked_asins', 'active=eq.true&select=asin');
  const asins = [...new Set(tracked.map(r => r.asin))];
  if (asins.length === 0) {
    console.log('nenhum ASIN monitorado ativo — nada a fazer.');
    return;
  }

  const cacheRows = await restGet('keepa_asin_cache', `asin=in.(${asins.join(',')})&select=*`);
  const cacheByAsin = Object.fromEntries(cacheRows.map(r => [r.asin, r]));

  const nowMs = Date.now();
  const cheapCadenceMs = (config.cheap_refresh_cadence_hours ?? 12) * 3600 * 1000;
  const buyboxCadenceMs = (config.buybox_refresh_cadence_hours ?? 48) * 3600 * 1000;

  const queue = [];
  for (const asin of asins) {
    const cache = cacheByAsin[asin];
    const cheapAge = cache?.cheap_data_updated_at ? nowMs - new Date(cache.cheap_data_updated_at).getTime() : Infinity;
    const buyboxAge = cache?.buybox_data_updated_at ? nowMs - new Date(cache.buybox_data_updated_at).getTime() : Infinity;
    if (buyboxAge >= buyboxCadenceMs) queue.push({ asin, priority: 0, staleness: buyboxAge }); // buybox vencido é o mais "importante" de resolver logo
    else if (cheapAge >= cheapCadenceMs) queue.push({ asin, priority: 1, staleness: cheapAge });
  }
  queue.sort((a, b) => a.priority - b.priority || b.staleness - a.staleness);

  console.log(`${asins.length} ASIN(s) monitorados, ${queue.length} vencido(s) nesta rodada.`);

  let processed = 0;
  let alertsGenerated = 0;
  for (const item of queue) {
    if (spentToday + (item.priority === 0 ? 5 : 1) > cap) {
      console.log(`orçamento diário esgotado (${spentToday}/${cap}) — parando, ${queue.length - processed} ASIN(s) ficam pra próxima rodada.`);
      break;
    }

    const asin = item.asin;
    const triggeredBy = item.priority === 0 ? 'cron_buybox' : 'cron_cheap';
    try {
      const { product, tokensLeft, tokensConsumed } = await callKeepa(asin);
      const parsed = parseKeepaProduct(product);
      const oldRow = cacheByAsin[asin] || null;

      const alerts = diffAlerts(asin, oldRow, parsed, config.price_alert_threshold_pct);
      if (alerts.length > 0) {
        await restInsert('keepa_asin_alerts', alerts);
        alertsGenerated += alerts.length;
      }

      const nowIso = new Date().toISOString();
      await restUpsert('keepa_asin_cache', [{
        asin,
        title: parsed.title,
        current_price: parsed.currentPrice,
        bsr: parsed.bsr,
        category: parsed.category,
        rating: parsed.rating,
        review_count: parsed.reviewCount,
        buybox_seller: parsed.buyboxSeller,
        buybox_is_amazon: parsed.buyboxIsAmazon,
        buybox_price: parsed.buyboxPrice,
        offers_count: parsed.offersCount,
        availability_status: parsed.availabilityStatus,
        price_history: parsed.priceHistory,
        monthly_sold: parsed.monthlySold,
        referral_fee_pct: parsed.referralFeePct,
        fba_pick_pack_fee: parsed.fbaFees?.pickAndPack ?? null,
        fba_pick_pack_fee_tax: parsed.fbaFees?.pickAndPackTax ?? null,
        fba_storage_fee: parsed.fbaFees?.storage ?? null,
        fba_storage_fee_tax: parsed.fbaFees?.storageTax ?? null,
        offers: parsed.offers,
        buybox_rotation_90d: parsed.buyboxRotation90d,
        category_ranks: parsed.categoryRanks,
        cheap_data_updated_at: nowIso,
        buybox_data_updated_at: item.priority === 0 ? nowIso : (oldRow?.buybox_data_updated_at ?? nowIso),
        last_synced_by: 'cron',
        last_error: null,
      }], 'asin');

      const consumed = tokensConsumed ?? (item.priority === 0 ? 5 : 1);
      spentToday += consumed;
      lastKnownTokensLeft = tokensLeft;
      await restUpdate('keepa_token_budget', 'id=eq.1', {
        last_known_tokens_left: lastKnownTokensLeft,
        last_checked_at: nowIso,
        tokens_spent_today: spentToday,
        spend_day: todayStr,
      });
      await restInsert('keepa_token_usage_log', [{
        triggered_by: triggeredBy, asin, tokens_after: tokensLeft, tokens_consumed: tokensConsumed, success: true,
      }]);

      cacheByAsin[asin] = { ...oldRow, ...parsed, buybox_seller: parsed.buyboxSeller, current_price: parsed.currentPrice, availability_status: parsed.availabilityStatus };
      processed++;
    } catch (err) {
      console.error(`erro ao atualizar ${asin}:`, err.message);
      await restInsert('keepa_token_usage_log', [{ triggered_by: triggeredBy, asin, success: false, error_message: String(err.message || err) }]).catch(() => {});
    }
  }

  console.log(`concluído: ${processed} ASIN(s) atualizados, ${alertsGenerated} alerta(s) gerados, ${spentToday} tokens gastos hoje (limite ${cap}).`);
}

main().catch(err => { console.error('erro fatal:', err); process.exit(1); });
