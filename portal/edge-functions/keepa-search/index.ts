// Yalca Portal — Edge Function: keepa-search
// Consulta sob demanda de um produto na Amazon via Keepa, com cache
// compartilhado (chaveado só pelo ASIN) e controle de orçamento de
// tokens, já que o plano Keepa usado aqui é o Pro de consumidor
// (1 token/minuto — pensado só pra testar integração, não produção).
//
// Roda em: https://api.yalca.com.br/functions/v1/keepa-search
//
// v8: expande o parser pra aproveitar campos que já vêm na mesma
// resposta (vendas estimadas/mês, taxas reais, ofertas de cada
// vendedor, rotatividade de buybox, ranking por categoria) — zero
// custo extra de token, só não estava sendo lido antes. Reputação de
// vendedor (nome/avaliação) é uma função separada (keepa-seller-lookup)
// porque isso sim custa token à parte.
//
// IMPORTANTE sobre autenticação: neste deploy self-hosted,
// FUNCTIONS_VERIFY_JWT=false (confirmado em docker/.env), então o
// roteador principal (main/index.ts) NÃO valida o JWT do chamador
// antes de despachar pra esta função. Este arquivo NÃO usa o
// pacote @supabase/server (withSupabase) — ele assume as chaves
// "opacas" novas (publishable/secret), que este projeto nunca
// configurou (usa só as chaves legadas ANON_KEY/SERVICE_ROLE_KEY
// no formato JWT), e falha com "No default publishable key found"
// mesmo em modo auth:"none". Em vez disso, usamos o
// @supabase/supabase-js puro pra criar um client de serviço
// (bypassa RLS) e fazemos a verificação do JWT do usuário
// manualmente via supabaseAdmin.auth.getUser(token).
//
// Deploy: copiar este arquivo pra
//   /opt/supabase-src/docker/volumes/functions/keepa-search/index.ts
// na VPS, depois `docker restart supabase-edge-functions`.
// Variáveis de ambiente novas (KEEPA_API_KEY, KEEPA_MOCK) exigem
// `docker compose up -d functions` (recriar), não só restart.

import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const KEEPA_API_KEY = Deno.env.get("KEEPA_API_KEY")
const KEEPA_MOCK = Deno.env.get("KEEPA_MOCK") === "true"
const ALLOWED_ORIGIN = Deno.env.get("PORTAL_ORIGIN") || "https://www.yalca.com.br"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const ASIN_RE = /^[A-Z0-9]{10}$/

// Custo estimado de uma pesquisa completa (base + buybox + offers + stats + rating).
// PLACEHOLDER até o primeiro teste real — corrigir com o tokens_consumed
// observado em keepa_token_usage_log (ver seção de verificação do plano).
const ESTIMATED_SEARCH_COST = 15

function jsonResponse(status: number, body: unknown) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
  // status 204 (No Content) proíbe body — usado pelo preflight OPTIONS
  if (status === 204) return new Response(null, { status, headers })
  return new Response(JSON.stringify(body), { status, headers })
}

// ---------------------------------------------------------
// Conversão de campos do Keepa (confirmados no código-fonte oficial
// do backend do Keepa no GitHub, não suposição):
// - domain=12 é com.br; preços em centavos (-1 = sem dado)
// - csv[0]=AMAZON, csv[1]=NEW, csv[2]=USED, csv[3]=SALES (BSR),
//   csv[16]=RATING, csv[17]=COUNT_REVIEWS, cada entrada no formato
//   [keepaTime, valor, ...]; keepaTime -> unix ms é
//   (keepaTime + 21564000) * 60000
// - monthlySold: unidades compradas nos últimos 30 dias (dado da
//   Amazon, não estimativa — a maioria dos ASINs não tem, null é
//   o caso comum)
// - referralFeePercentage: comissão real (%), sem conversão de centavos
// - fbaFees.pickAndPackFee(Tax)/.storageFee(Tax): taxas reais de FBA,
//   em centavos
// - offers[]: cada oferta tem sellerId, offerCSV ([tempo,preço,frete,...]
//   mais recente por último), condition (código 0-10, tabela abaixo),
//   isFBA/isAmazon/isPrime/isWarehouseDeal/isMAP/isPreorder/shipsFromChina,
//   stockCSV ([tempo,estoque,...]), minOrderQty, coupon (positivo=valor
//   fixo em centavos, negativo=percentual), lastSeen. NÃO tem nome nem
//   avaliação do vendedor — só o ID (isso é keepa-seller-lookup)
// - buyBoxSellerIdHistory: [tempo,sellerId,tempo,sellerId,...] — usado
//   pra calcular rotatividade da buybox
// - salesRanks: mapa categoryId -> histórico de rank; salesRankReference
//   é a categoria principal
// ---------------------------------------------------------
const KEEPA_EPOCH_OFFSET_MIN = 21564000

function keepaTimeToIso(keepaTime: number): string {
  return new Date((keepaTime + KEEPA_EPOCH_OFFSET_MIN) * 60000).toISOString()
}

function nowKeepaTime(): number {
  return Math.floor(Date.now() / 60000) - KEEPA_EPOCH_OFFSET_MIN
}

function centsToReais(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined || cents < 0) return null
  return Math.round(cents) / 100
}

function extractCsvSeries(csv: (number[] | null)[] | undefined, typeIndex: number, isPrice: boolean): { date: string; value: number }[] {
  const series = csv?.[typeIndex]
  if (!Array.isArray(series)) return []
  const points: { date: string; value: number }[] = []
  for (let i = 0; i + 1 < series.length; i += 2) {
    const rawValue = series[i + 1]
    if (rawValue === -1 || rawValue === null || rawValue === undefined) continue
    points.push({
      date: keepaTimeToIso(series[i]),
      value: isPrice ? (centsToReais(rawValue) ?? 0) : rawValue,
    })
  }
  return points
}

function lastValue(points: { date: string; value: number }[]): number | null {
  return points.length > 0 ? points[points.length - 1].value : null
}

const AVAILABILITY_LABELS: Record<number, string> = {
  [-1]: "sem oferta",
  0: "em estoque",
  1: "pré-venda",
  2: "desconhecido",
  3: "sob encomenda",
  4: "atrasado",
}

// Tabela de condição confirmada no enum OfferCondition do backend oficial do Keepa.
const CONDITION_LABELS: Record<number, string> = {
  0: "Desconhecida",
  1: "Novo",
  2: "Usado - Como novo",
  3: "Usado - Muito bom",
  4: "Usado - Bom",
  5: "Usado - Aceitável",
  6: "Recondicionado",
  7: "Coleção - Como novo",
  8: "Coleção - Muito bom",
  9: "Coleção - Bom",
  10: "Coleção - Aceitável",
}

function parseOffers(offers: any[] | undefined): any[] {
  if (!Array.isArray(offers)) return []
  const parsed = offers.map((o) => {
    const csv = Array.isArray(o.offerCSV) ? o.offerCSV : []
    const last3 = csv.length >= 3 ? csv.slice(-3) : null
    const price = last3 ? centsToReais(last3[1]) : null
    const shipping = last3 ? centsToReais(last3[2]) : null
    const stockCsv = Array.isArray(o.stockCSV) ? o.stockCSV : []
    const stock = stockCsv.length >= 2 ? stockCsv[stockCsv.length - 1] : null

    let coupon: { type: "amount" | "percent"; value: number } | null = null
    if (typeof o.coupon === "number" && o.coupon !== 0) {
      coupon = o.coupon > 0
        ? { type: "amount", value: centsToReais(o.coupon) ?? 0 }
        : { type: "percent", value: Math.abs(o.coupon) }
    }

    return {
      sellerId: o.sellerId ?? null,
      price,
      shipping,
      condition: CONDITION_LABELS[o.condition] ?? `Condição #${o.condition}`,
      isFBA: !!o.isFBA,
      isAmazon: !!o.isAmazon,
      isPrime: !!o.isPrime,
      isWarehouseDeal: !!o.isWarehouseDeal,
      stock: typeof stock === "number" ? stock : null,
      minOrderQty: typeof o.minOrderQty === "number" ? o.minOrderQty : null,
      coupon,
      lastSeen: typeof o.lastSeen === "number" ? keepaTimeToIso(o.lastSeen) : null,
    }
  })
  parsed.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
  return parsed
}

// buyBoxSellerIdHistory pode chegar como string separada por vírgula ou já
// como array achatado — tratamos os dois casos defensivamente, já que essa
// forma específica não foi confirmada ao vivo (será no primeiro teste real).
function computeBuyboxRotation(history: unknown, windowDays: number): number | null {
  let flat: unknown[] = []
  if (typeof history === "string" && history.length > 0) flat = history.split(",")
  else if (Array.isArray(history)) flat = history
  else return null
  if (flat.length < 4) return 0

  const cutoff = nowKeepaTime() - windowDays * 1440
  let prevSeller: string | null = null
  let transitions = 0
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const time = Number(flat[i])
    const seller = String(flat[i + 1])
    if (Number.isNaN(time) || time < cutoff) continue
    if (prevSeller !== null && seller !== prevSeller) transitions++
    prevSeller = seller
  }
  return transitions
}

// Nome da categoria: só a categoria PRIMÁRIA tem nome garantido hoje (o
// parser já resolve p.categoryTree pra ela). Pras secundárias, tentamos
// bater o catId em categoryTree; se não bater, fica só "Categoria #<id>"
// — não confirmado se catId sempre existe em categoryTree, best-effort.
function parseCategoryRanks(salesRanks: any, salesRankReference: any, categoryTree: any[] | undefined, primaryCategoryName: string | null): any[] {
  if (!salesRanks || typeof salesRanks !== "object") return []
  const treeById = new Map<string, string>()
  if (Array.isArray(categoryTree)) {
    for (const c of categoryTree) {
      if (c && c.catId !== undefined && c.catId !== null && c.name) treeById.set(String(c.catId), c.name)
    }
  }
  const rows: { categoryId: string; categoryName: string | null; rank: number; isPrimary: boolean }[] = []
  for (const [categoryId, history] of Object.entries(salesRanks)) {
    if (!Array.isArray(history) || history.length < 2) continue
    const rank = history[history.length - 1] as number
    if (rank === -1 || rank === undefined) continue
    const isPrimary = String(salesRankReference) === categoryId
    const categoryName = treeById.get(categoryId) ?? (isPrimary ? primaryCategoryName : null) ?? `Categoria #${categoryId}`
    rows.push({ categoryId, categoryName, rank, isPrimary })
  }
  rows.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
  return rows
}

// stats.avg30/avg90/avg180/min/max/isLowest/isLowest90/outOfStockPercentage*
// são todos indexados por CsvType (confirmado no enum oficial do backend
// Keepa no GitHub). Usamos o índice 18 (BUY_BOX_SHIPPING) porque é o que
// reflete o preço que o comprador realmente pagaria — o mesmo preço que já
// mostramos como "buybox" em outro lugar da tela.
const CSV_TYPE_BUYBOX_SHIPPING = 18

function parseBuyBoxStats(buyBoxStats: any): any[] {
  if (!buyBoxStats || typeof buyBoxStats !== "object") return []
  return Object.entries(buyBoxStats).map(([sellerId, s]: [string, any]) => ({
    sellerId,
    percentageWon: typeof s?.percentageWon === "number" ? Math.round(s.percentageWon) : null,
    avgPrice: centsToReais(s?.avgPrice),
    avgNewOfferCount: typeof s?.avgNewOfferCount === "number" ? s.avgNewOfferCount : null,
    isFBA: !!s?.isFBA,
    lastSeen: typeof s?.lastSeen === "number" ? keepaTimeToIso(s.lastSeen) : null,
  })).sort((a, b) => (b.percentageWon ?? 0) - (a.percentageWon ?? 0))
}

function parseStats(stats: any) {
  if (!stats || typeof stats !== "object") return null
  const idx = CSV_TYPE_BUYBOX_SHIPPING
  const avgAt = (arr: unknown) => Array.isArray(arr) && typeof arr[idx] === "number" && arr[idx] >= 0 ? centsToReais(arr[idx] as number) : null
  const extremeAt = (arr: unknown) => {
    const entry = Array.isArray(arr) ? (arr as any[])[idx] : null
    if (!Array.isArray(entry) || entry.length < 2) return null
    return { date: keepaTimeToIso(entry[0]), price: centsToReais(entry[1]) }
  }
  const pctAt = (arr: unknown) => Array.isArray(arr) && typeof arr[idx] === "number" && arr[idx] >= 0 ? arr[idx] as number : null
  const dropsOrNull = (v: unknown) => typeof v === "number" && v >= 0 ? v : null

  return {
    avg30: avgAt(stats.avg30),
    avg90: avgAt(stats.avg90),
    avg180: avgAt(stats.avg180),
    lowestEver: extremeAt(stats.min),
    highestEver: extremeAt(stats.max),
    isLowestEver: Array.isArray(stats.isLowest) ? !!stats.isLowest[idx] : null,
    isLowest90d: Array.isArray(stats.isLowest90) ? !!stats.isLowest90[idx] : null,
    outOfStockPct30: pctAt(stats.outOfStockPercentage30),
    outOfStockPct90: pctAt(stats.outOfStockPercentage90),
    salesRankDrops30: dropsOrNull(stats.salesRankDrops30),
    salesRankDrops90: dropsOrNull(stats.salesRankDrops90),
    salesRankDrops180: dropsOrNull(stats.salesRankDrops180),
    buyBoxStats: parseBuyBoxStats(stats.buyBoxStats),
  }
}

function mmToCm(mm: number | null | undefined): number | null {
  if (mm === null || mm === undefined || mm <= 0) return null
  return Math.round((mm / 10) * 10) / 10
}

function gToKg(g: number | null | undefined): number | null {
  if (g === null || g === undefined || g <= 0) return null
  return Math.round((g / 1000) * 100) / 100
}

function parseKeepaProduct(p: any) {
  const priceHistoryNew = extractCsvSeries(p.csv, 1, true)
  const priceHistoryAmazon = extractCsvSeries(p.csv, 0, true)
  const priceHistoryBuyBox = extractCsvSeries(p.csv, CSV_TYPE_BUYBOX_SHIPPING, true)
  const bsrHistory = extractCsvSeries(p.csv, 3, false)
  const ratingHistory = extractCsvSeries(p.csv, 16, false)
  const reviewCountHistory = extractCsvSeries(p.csv, 17, false)

  const buyboxPrice = centsToReais(p.buyBoxPrice)
  const currentPrice = buyboxPrice ?? lastValue(priceHistoryNew) ?? lastValue(priceHistoryAmazon)

  // Três séries SEPARADAS (Amazon / outros vendedores / buybox), não uma
  // única linha combinada — é isso que faz o gráfico parecer o do Keepa de
  // verdade (cada linha com sua própria cor e significado) em vez de uma
  // linha genérica sem contexto. Cada série já limitada aos últimos 90 pontos.
  const priceHistory = {
    amazon: priceHistoryAmazon.slice(-90),
    new: priceHistoryNew.slice(-90),
    buybox: priceHistoryBuyBox.slice(-90),
  }

  const category = Array.isArray(p.categoryTree) && p.categoryTree.length > 0 ? p.categoryTree[p.categoryTree.length - 1]?.name ?? null : null

  const fbaFees = p.fbaFees ? {
    pickAndPack: centsToReais(p.fbaFees.pickAndPackFee),
    pickAndPackTax: centsToReais(p.fbaFees.pickAndPackFeeTax),
    storage: centsToReais(p.fbaFees.storageFee),
    storageTax: centsToReais(p.fbaFees.storageFeeTax),
  } : null

  return {
    title: p.title ?? null,
    imageUrl: Array.isArray(p.imagesCSV) && p.imagesCSV.length > 0
      ? `https://images-na.ssl-images-amazon.com/images/I/${String(p.imagesCSV).split(",")[0]}`
      : null,
    currentPrice,
    bsr: lastValue(bsrHistory),
    category,
    rating: lastValue(ratingHistory) !== null ? (lastValue(ratingHistory) as number) / 10 : null, // Keepa guarda nota x10
    reviewCount: lastValue(reviewCountHistory),
    buybox: p.buyBoxSellerId ? {
      seller: p.buyBoxSellerId,
      isAmazon: !!p.buyBoxIsAmazon,
      price: buyboxPrice,
    } : null,
    offersCount: typeof p.offersCount === "number" ? p.offersCount : (Array.isArray(p.offers) ? p.offers.length : null),
    availabilityStatus: AVAILABILITY_LABELS[p.availabilityAmazon] ?? null,
    priceHistory,
    bsrHistory: bsrHistory.slice(-90),
    // --- campos v8, tudo já vem na mesma resposta ---
    monthlySold: typeof p.monthlySold === "number" ? p.monthlySold : null,
    referralFeePct: typeof p.referralFeePercentage === "number" ? p.referralFeePercentage : null,
    fbaFees,
    offers: parseOffers(p.offers),
    buyboxRotation90d: computeBuyboxRotation(p.buyBoxSellerIdHistory, 90),
    categoryRanks: parseCategoryRanks(p.salesRanks, p.salesRankReference, p.categoryTree, category),
    // --- campos v9: estatísticas comparativas (stats.*) e ficha técnica ---
    stats: parseStats(p.stats),
    brand: typeof p.brand === "string" ? p.brand : null,
    listedSince: typeof p.listedSince === "number" && p.listedSince > 0 ? keepaTimeToIso(p.listedSince) : null,
    packageWeightKg: gToKg(p.packageWeight),
    packageDimensionsCm: (p.packageLength > 0 && p.packageWidth > 0 && p.packageHeight > 0)
      ? { length: mmToCm(p.packageLength), width: mmToCm(p.packageWidth), height: mmToCm(p.packageHeight) }
      : null,
  }
}

function mockKeepaResponse(asin: string) {
  const now = nowKeepaTime()
  return {
    asin,
    title: `Produto de teste (mock) ${asin}`,
    buyBoxSellerId: "A1MOCKSELLER",
    buyBoxIsAmazon: false,
    buyBoxPrice: 12990, // R$ 129,90
    offersCount: 4,
    availabilityAmazon: 0,
    categoryTree: [{ catId: 100, name: "Categoria Mock" }],
    imagesCSV: "",
    monthlySold: 340,
    referralFeePercentage: 15.0,
    fbaFees: { pickAndPackFee: 605, pickAndPackFeeTax: 0, storageFee: 40, storageFeeTax: 0 },
    salesRankReference: 100,
    salesRanks: {
      "100": [now - 60 * 24 * 5, 15000, now - 60 * 24 * 2, 12000],
      "200": [now - 60 * 24 * 5, 300, now - 60 * 24 * 2, 250], // categoria secundária sem nome em categoryTree — exercita o fallback "Categoria #200"
    },
    buyBoxSellerIdHistory: [
      now - 60 * 24 * 10, "A1MOCKSELLER",
      now - 60 * 24 * 6, "A2OUTROSELLER",
      now - 60 * 24 * 2, "A1MOCKSELLER",
    ],
    offers: [
      {
        sellerId: "A1MOCKSELLER", condition: 1, isFBA: true, isAmazon: false, isPrime: true,
        offerCSV: [now - 60 * 24 * 2, 12990, 0], stockCSV: [now - 60 * 24 * 2, 117], lastSeen: now, coupon: 0,
      },
      {
        sellerId: "A2OUTROSELLER", condition: 1, isFBA: true, isAmazon: false, isPrime: true,
        offerCSV: [now - 60 * 24 * 1, 13500, 0], stockCSV: [now - 60 * 24 * 1, 44], lastSeen: now, coupon: -10, // 10% de cupom, exercita o branch percent
      },
      {
        sellerId: "A3TERCEIRO", condition: 2, isFBA: false, isAmazon: false, isPrime: false,
        offerCSV: [now, 11800, 1200], stockCSV: [now, 8], lastSeen: now, coupon: 500, // R$5 de cupom fixo, exercita o branch amount
      },
      {
        sellerId: "A4QUARTOVENDEDOR", condition: 1, isFBA: true, isAmazon: false, isPrime: true,
        offerCSV: [now, 14500, 0], stockCSV: [now, 30], lastSeen: now, coupon: 0, // 4º vendedor: exercita o botão "ver os outros" (auto-load carrega só 3)
      },
      {
        sellerId: "AMAZON", condition: 1, isFBA: true, isAmazon: true, isPrime: true,
        offerCSV: [now, 13990, 0], stockCSV: [now, 999], lastSeen: now, coupon: 0,
      },
    ],
    // Histórico com vários pontos (não só 2) pra exercitar de verdade o
    // gráfico multi-série — cada linha (Amazon/New/BuyBox) com sua própria
    // trajetória, do mesmo jeito que o gráfico real do Keepa mostra.
    csv: [
      [now - 60 * 24 * 60, 14990, now - 60 * 24 * 40, 14990, now - 60 * 24 * 20, 13990, now - 60 * 24 * 5, 13990], // AMAZON
      [now - 60 * 24 * 60, 14500, now - 60 * 24 * 45, 13800, now - 60 * 24 * 30, 13990, now - 60 * 24 * 15, 12990, now - 60 * 24 * 2, 12990], // NEW
      null, // USED
      [now - 60 * 24 * 60, 22000, now - 60 * 24 * 45, 18500, now - 60 * 24 * 30, 16000, now - 60 * 24 * 15, 13500, now - 60 * 24 * 2, 12000], // SALES (BSR) — melhorando (caindo)
      null, null, null, null, null, null, null, null, null, null, null, null,
      [now - 60 * 24 * 5, 45], // RATING (x10 -> 4.5)
      [now - 60 * 24 * 5, 320], // COUNT_REVIEWS
      [now - 60 * 24 * 60, 14200, now - 60 * 24 * 40, 13990, now - 60 * 24 * 20, 12990, now - 60 * 24 * 2, 12990], // BUY_BOX_SHIPPING (índice 18)
    ],
    // --- campos v9: estatísticas (stats.*) e ficha técnica ---
    brand: "Marca Mock",
    listedSince: now - 60 * 24 * 900, // ~2.5 anos no mercado
    packageWeight: 250, packageHeight: 50, packageLength: 120, packageWidth: 80,
    stats: {
      avg30: buildStatsArray(12990),
      avg90: buildStatsArray(13400),
      avg180: buildStatsArray(13800),
      min: buildStatsExtremeArray(now - 60 * 24 * 200, 10990),
      max: buildStatsExtremeArray(now - 60 * 24 * 500, 16990),
      isLowest: buildStatsBoolArray(false),
      isLowest90: buildStatsBoolArray(true), // exercita o selo "menor preço em 90 dias"
      outOfStockPercentage30: buildStatsArray(2),
      outOfStockPercentage90: buildStatsArray(5),
      salesRankDrops30: 47,
      salesRankDrops90: 118,
      salesRankDrops180: 210,
      buyBoxStats: {
        A1MOCKSELLER: { percentageWon: 62, avgPrice: 12990, avgNewOfferCount: 4, isFBA: true, lastSeen: now },
        A2OUTROSELLER: { percentageWon: 31, avgPrice: 13600, avgNewOfferCount: 4, isFBA: true, lastSeen: now - 60 * 24 * 6 },
        A3TERCEIRO: { percentageWon: 7, avgPrice: 11800, avgNewOfferCount: 4, isFBA: false, lastSeen: now - 60 * 24 * 20 },
      },
    },
  }
}

// Monta um array de 36 posições (tamanho do enum CsvType) só com o índice
// 18 (BUY_BOX_SHIPPING) preenchido — os outros ficam -1 ("sem dado"), igual
// o Keepa faz de verdade. Usado pros campos de stats.* do mock.
function buildStatsArray(valueAtBuyboxIdx: number): number[] {
  const arr = new Array(36).fill(-1)
  arr[CSV_TYPE_BUYBOX_SHIPPING] = valueAtBuyboxIdx
  return arr
}
function buildStatsBoolArray(valueAtBuyboxIdx: boolean): boolean[] {
  const arr = new Array(36).fill(false)
  arr[CSV_TYPE_BUYBOX_SHIPPING] = valueAtBuyboxIdx
  return arr
}
function buildStatsExtremeArray(time: number, value: number): (number[] | null)[] {
  const arr: (number[] | null)[] = new Array(36).fill(null)
  arr[CSV_TYPE_BUYBOX_SHIPPING] = [time, value]
  return arr
}

function formatResult(cache: any) {
  return {
    asin: cache.asin,
    title: cache.title,
    imageUrl: cache.image_url,
    currentPrice: cache.current_price,
    bsr: cache.bsr,
    category: cache.category,
    rating: cache.rating,
    reviewCount: cache.review_count,
    buybox: cache.buybox_seller ? {
      seller: cache.buybox_seller,
      isAmazon: cache.buybox_is_amazon,
      price: cache.buybox_price,
    } : null,
    offersCount: cache.offers_count,
    availabilityStatus: cache.availability_status,
    priceHistory: cache.price_history ?? { amazon: [], new: [], buybox: [] },
    bsrHistory: cache.bsr_history ?? [],
    monthlySold: cache.monthly_sold ?? null,
    referralFeePct: cache.referral_fee_pct ?? null,
    fbaFees: (cache.fba_pick_pack_fee ?? cache.fba_storage_fee) != null ? {
      pickAndPack: cache.fba_pick_pack_fee ?? null,
      pickAndPackTax: cache.fba_pick_pack_fee_tax ?? null,
      storage: cache.fba_storage_fee ?? null,
      storageTax: cache.fba_storage_fee_tax ?? null,
    } : null,
    fbaFeeTotal: [cache.fba_pick_pack_fee, cache.fba_pick_pack_fee_tax, cache.fba_storage_fee, cache.fba_storage_fee_tax]
      .filter((v) => typeof v === "number")
      .reduce((sum: number | null, v: number) => (sum ?? 0) + v, null as number | null),
    offers: cache.offers ?? [],
    buyboxRotation90d: cache.buybox_rotation_90d ?? null,
    categoryRanks: cache.category_ranks ?? [],
    brand: cache.brand ?? null,
    listedSince: cache.listed_since ?? null,
    packageWeightKg: cache.package_weight_kg ?? null,
    packageDimensionsCm: (cache.package_length_cm != null) ? {
      length: cache.package_length_cm, width: cache.package_width_cm, height: cache.package_height_cm,
    } : null,
    stats: {
      avg30: cache.price_avg_30 ?? null,
      avg90: cache.price_avg_90 ?? null,
      avg180: cache.price_avg_180 ?? null,
      lowestEver: cache.price_lowest_ever ?? null,
      highestEver: cache.price_highest_ever ?? null,
      isLowestEver: cache.is_lowest_ever ?? null,
      isLowest90d: cache.is_lowest_90d ?? null,
      outOfStockPct30: cache.out_of_stock_pct_30 ?? null,
      outOfStockPct90: cache.out_of_stock_pct_90 ?? null,
      salesRankDrops30: cache.sales_rank_drops_30 ?? null,
      salesRankDrops90: cache.sales_rank_drops_90 ?? null,
      salesRankDrops180: cache.sales_rank_drops_180 ?? null,
      buyBoxStats: cache.buybox_stats ?? [],
    },
    cheapDataAgeMinutes: cache.cheap_data_updated_at
      ? Math.round((Date.now() - new Date(cache.cheap_data_updated_at).getTime()) / 60000)
      : null,
    buyboxDataAgeMinutes: cache.buybox_data_updated_at
      ? Math.round((Date.now() - new Date(cache.buybox_data_updated_at).getTime()) / 60000)
      : null,
  }
}

// Monta a linha completa pro upsert em keepa_asin_cache a partir do
// resultado já parseado — usada tanto pra gravar quanto (via formatResult,
// que lê as mesmas chaves) pra montar a resposta, então um campo novo só
// precisa ser adicionado AQUI, nunca em dois lugares.
function buildCacheRow(asin: string, parsed: ReturnType<typeof parseKeepaProduct>, nowIso: string) {
  return {
    asin,
    title: parsed.title,
    image_url: parsed.imageUrl,
    current_price: parsed.currentPrice,
    bsr: parsed.bsr,
    category: parsed.category,
    rating: parsed.rating,
    review_count: parsed.reviewCount,
    buybox_seller: parsed.buybox?.seller ?? null,
    buybox_is_amazon: parsed.buybox?.isAmazon ?? null,
    buybox_price: parsed.buybox?.price ?? null,
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
    buybox_data_updated_at: nowIso,
    last_synced_by: "search",
    last_error: null,
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return jsonResponse(204, {})
    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, reason: "method_not_allowed", message: "Método não permitido." })
    }

    // --- autenticação explícita do usuário chamador (ver nota no topo do arquivo) ---
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!token) {
      return jsonResponse(401, { ok: false, reason: "unauthenticated", message: "Sessão inválida. Faça login novamente." })
    }
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) {
      return jsonResponse(401, { ok: false, reason: "unauthenticated", message: "Sessão inválida. Faça login novamente." })
    }
    const userId = userData.user.id

    let body: { asin?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse(400, { ok: false, reason: "invalid_body", message: "Requisição inválida." })
    }
    const asin = (body.asin || "").trim().toUpperCase()
    if (!ASIN_RE.test(asin)) {
      return jsonResponse(400, { ok: false, reason: "invalid_asin", message: "ASIN inválido — deve ter 10 letras/números (ex: B0EXAMPLE1)." })
    }

    // --- aprovação do cliente ---
    const { data: profile } = await supabaseAdmin.from("client_profiles").select("status").eq("user_id", userId).maybeSingle()
    const { data: adminRow } = await supabaseAdmin.from("admins").select("user_id").eq("user_id", userId).maybeSingle()
    if (profile?.status !== "approved" && !adminRow) {
      return jsonResponse(200, { ok: false, reason: "not_approved", message: "Seu acesso ainda não foi aprovado pela Yalca." })
    }

    const { data: config } = await supabaseAdmin.from("keepa_config").select("*").eq("id", 1).single()
    const cacheMaxAgeMs = (config?.search_cache_max_age_hours ?? 24) * 3600 * 1000

    // --- cache primeiro: sempre grátis, nunca passa por checagem de cota ---
    const { data: cached } = await supabaseAdmin.from("keepa_asin_cache").select("*").eq("asin", asin).maybeSingle()
    const cacheAgeMs = cached?.cheap_data_updated_at ? Date.now() - new Date(cached.cheap_data_updated_at).getTime() : Infinity
    if (cached && cacheAgeMs < cacheMaxAgeMs) {
      await supabaseAdmin.from("keepa_search_log").insert({ user_id: userId, asin, resulted_in_live_call: false })
      return jsonResponse(200, { ok: true, source: "cache", ...formatResult(cached) })
    }

    // --- limite diário de pesquisas do cliente (só as que realmente custam token) ---
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const { count: searchesToday } = await supabaseAdmin
      .from("keepa_search_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("resulted_in_live_call", true)
      .gte("searched_at", startOfDay.toISOString())
    if ((searchesToday ?? 0) >= (config?.max_searches_per_client_per_day ?? 5)) {
      return jsonResponse(200, { ok: false, reason: "client_cap", message: "Você atingiu o limite de pesquisas de hoje. Tente novamente amanhã." })
    }

    // --- orçamento global de tokens ---
    const { data: budget } = await supabaseAdmin.from("keepa_token_budget").select("*").eq("id", 1).single()
    const todayStr = new Date().toISOString().slice(0, 10)
    const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0
    const cap = config?.daily_token_cap ?? 200
    if (spentToday + ESTIMATED_SEARCH_COST > cap) {
      return jsonResponse(200, { ok: false, reason: "no_budget", message: "Sem cota de consultas disponível hoje. Tente novamente amanhã." })
    }

    // --- chamada real ao Keepa (ou mock, pra testar sem gastar token) ---
    let parsed: ReturnType<typeof parseKeepaProduct>
    let tokensLeft: number | null = null
    let tokensConsumed: number | null = null
    try {
      let rawProduct: any
      if (KEEPA_MOCK) {
        rawProduct = mockKeepaResponse(asin)
        tokensLeft = 999
        tokensConsumed = 0
      } else {
        if (!KEEPA_API_KEY) throw new Error("KEEPA_API_KEY não configurada no ambiente da função")
        const url = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=12&asin=${asin}&stats=180&buybox=1&offers=20&rating=1`
        const res = await fetch(url)
        const json = await res.json()
        if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`)
        if (!json.products || !json.products[0]) throw new Error("Produto não encontrado no Keepa para esse ASIN.")
        rawProduct = json.products[0]
        tokensLeft = typeof json.tokensLeft === "number" ? json.tokensLeft : null
        tokensConsumed = typeof json.tokensConsumed === "number" ? json.tokensConsumed : null
      }
      parsed = parseKeepaProduct(rawProduct)
    } catch (err) {
      await supabaseAdmin.from("keepa_token_usage_log").insert({
        triggered_by: "on_demand_search",
        asin,
        success: false,
        error_message: String(err instanceof Error ? err.message : err),
      })
      return jsonResponse(502, { ok: false, reason: "keepa_error", message: "Não foi possível consultar a Amazon agora. Tente novamente em instantes." })
    }

    const nowIso = new Date().toISOString()
    const cacheRow = buildCacheRow(asin, parsed, nowIso)
    await supabaseAdmin.from("keepa_asin_cache").upsert(cacheRow)

    const consumedForBudget = tokensConsumed ?? ESTIMATED_SEARCH_COST
    await supabaseAdmin.from("keepa_token_budget").update({
      last_known_tokens_left: tokensLeft,
      last_checked_at: nowIso,
      tokens_spent_today: spentToday + consumedForBudget,
      spend_day: todayStr,
    }).eq("id", 1)

    await supabaseAdmin.from("keepa_token_usage_log").insert({
      triggered_by: "on_demand_search",
      asin,
      tokens_before: tokensLeft !== null && tokensConsumed !== null ? tokensLeft + tokensConsumed : null,
      tokens_after: tokensLeft,
      tokens_consumed: tokensConsumed,
      success: true,
    })

    await supabaseAdmin.from("keepa_search_log").insert({ user_id: userId, asin, resulted_in_live_call: true })

    return jsonResponse(200, { ok: true, source: "live", ...formatResult(cacheRow) })
  },
}
