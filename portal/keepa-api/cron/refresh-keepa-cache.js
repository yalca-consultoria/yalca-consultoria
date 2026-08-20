#!/usr/bin/env node
// Yalca Portal — job agendado: atualização em lote de "Meus Anúncios" (Keepa)
//
// Roda de hora em hora (crontab), mas só gasta token de verdade nos ASINs
// que realmente venceram a cadência configurada em keepa_config — a
// checagem em si (ver o que está velho) é gratuita, são leituras REST.
//
// Movido pra dentro de keepa-api/ (antes vivia sozinho em portal/cron/)
// pra poder compartilhar lib/keepa-parser.js com o server.js — antes essa
// lógica de parsing estava duplicada entre esse arquivo e a Edge Function
// Deno, e um bug real (trinca do BUY_BOX_SHIPPING) precisou ser corrigido
// nos dois lugares manualmente. Agora que os dois rodam em Node, um só
// módulo compartilhado resolve isso de vez.
//
// Deploy: dentro do mesmo diretório keepa-api/ já publicado na VPS
// (htdocs/keepa-api.yalca.com.br/), usa o MESMO .env do server.js.
// Crontab: 0 * * * * /usr/bin/node /home/keepaapi/htdocs/keepa-api.yalca.com.br/cron/refresh-keepa-cache.js >> /home/keepaapi/logs/keepa-refresh.log 2>&1

const fs = require('fs');
const path = require('path');
const { makeRestClient } = require('../lib/rest-client');
const { parseKeepaProduct, mockKeepaResponse } = require('../lib/keepa-parser');

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

const env = { ...loadEnv(path.join(__dirname, '..', '.env')), ...process.env };
const SUPABASE_URL = env.SUPABASE_URL || 'https://api.yalca.com.br';
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const KEEPA_API_KEY = env.KEEPA_API_KEY;
const KEEPA_MOCK = env.KEEPA_MOCK === 'true';

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY não configurada em .env — abortando.');
  process.exit(1);
}

const { restGet, restUpsert, restInsert, restUpdate } = makeRestClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });

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
        bsr_history: parsed.bsrHistory,
        brand: parsed.brand,
        listed_since: parsed.listedSince,
        package_weight_kg: parsed.packageWeightKg,
        package_length_cm: parsed.packageDimensionsCm?.length ?? null,
        package_width_cm: parsed.packageDimensionsCm?.width ?? null,
        package_height_cm: parsed.packageDimensionsCm?.height ?? null,
        price_avg_30: parsed.stats?.avg30 ?? null,
        price_avg_90: parsed.stats?.avg90 ?? null,
        price_avg_180: parsed.stats?.avg180 ?? null,
        price_lowest_ever: parsed.stats?.lowestEver ?? null,
        price_highest_ever: parsed.stats?.highestEver ?? null,
        is_lowest_ever: parsed.stats?.isLowestEver ?? null,
        is_lowest_90d: parsed.stats?.isLowest90d ?? null,
        out_of_stock_pct_30: parsed.stats?.outOfStockPct30 ?? null,
        out_of_stock_pct_90: parsed.stats?.outOfStockPct90 ?? null,
        sales_rank_drops_30: parsed.stats?.salesRankDrops30 ?? null,
        sales_rank_drops_90: parsed.stats?.salesRankDrops90 ?? null,
        sales_rank_drops_180: parsed.stats?.salesRankDrops180 ?? null,
        buybox_stats: parsed.stats?.buyBoxStats ?? [],
        cheap_data_updated_at: nowIso,
        buybox_data_updated_at: item.priority === 0 ? nowIso : (oldRow?.buybox_data_updated_at ?? nowIso),
        last_synced_by: KEEPA_MOCK ? 'cron_mock' : 'cron',
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
