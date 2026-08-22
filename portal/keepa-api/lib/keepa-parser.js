// Yalca Portal — lógica de conversão de campos do Keepa.
// Módulo único compartilhado entre server.js (busca sob demanda) e
// cron/refresh-keepa-cache.js (atualização em lote) — antes essa lógica
// vivia duplicada numa Deno Edge Function e nesse cron Node, e um bug real
// (trinca [tempo,preço,frete] do BUY_BOX_SHIPPING lida como par) precisou
// ser corrigido nos dois lugares manualmente. Agora que os dois rodam em
// Node, não tem mais motivo pra duplicar: qualquer campo novo só precisa
// mudar AQUI.

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

// Formato confirmado no enum oficial CsvType do backend Keepa (campo
// isWithShipping, github.com/keepacom/api_backend): tipos "*_SHIPPING"
// (incluindo BUY_BOX_SHIPPING, índice 18) guardam TRINCAS
// [tempo, preço, frete, ...], não pares [tempo, valor] como os outros
// tipos — tratar como par lê o frete como próximo timestamp e o
// timestamp seguinte como preço, gerando picos absurdos (bug real
// encontrado no primeiro teste com chave de verdade, 2026-08-20).
function extractCsvSeries(csv, typeIndex, isPrice, hasShipping) {
  const series = csv && csv[typeIndex];
  if (!Array.isArray(series)) return [];
  const stride = hasShipping ? 3 : 2;
  const points = [];
  for (let i = 0; i + 1 < series.length; i += stride) {
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

// stats.avg30/avg90/avg180/min/max/isLowest/isLowest90/outOfStockPercentage*
// são indexados por CsvType — índice 18 (BUY_BOX_SHIPPING) é o preço que o
// comprador realmente pagaria, mesma referência usada como "buybox" em
// outro lugar da tela.
const CSV_TYPE_BUYBOX_SHIPPING = 18;

function parseBuyBoxStats(buyBoxStats) {
  if (!buyBoxStats || typeof buyBoxStats !== 'object') return [];
  return Object.entries(buyBoxStats).map(([sellerId, s]) => ({
    sellerId,
    percentageWon: typeof s?.percentageWon === 'number' ? Math.round(s.percentageWon) : null,
    avgPrice: centsToReais(s?.avgPrice),
    avgNewOfferCount: typeof s?.avgNewOfferCount === 'number' ? s.avgNewOfferCount : null,
    isFBA: !!s?.isFBA,
    lastSeen: typeof s?.lastSeen === 'number' ? keepaTimeToIso(s.lastSeen) : null,
  })).sort((a, b) => (b.percentageWon ?? 0) - (a.percentageWon ?? 0));
}

function parseStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const idx = CSV_TYPE_BUYBOX_SHIPPING;
  const avgAt = (arr) => Array.isArray(arr) && typeof arr[idx] === 'number' && arr[idx] >= 0 ? centsToReais(arr[idx]) : null;
  const extremeAt = (arr) => {
    const entry = Array.isArray(arr) ? arr[idx] : null;
    if (!Array.isArray(entry) || entry.length < 2) return null;
    return { date: keepaTimeToIso(entry[0]), price: centsToReais(entry[1]) };
  };
  const pctAt = (arr) => Array.isArray(arr) && typeof arr[idx] === 'number' && arr[idx] >= 0 ? arr[idx] : null;
  const dropsOrNull = (v) => typeof v === 'number' && v >= 0 ? v : null;
  return {
    avg30: avgAt(stats.avg30), avg90: avgAt(stats.avg90), avg180: avgAt(stats.avg180),
    lowestEver: extremeAt(stats.min), highestEver: extremeAt(stats.max),
    isLowestEver: Array.isArray(stats.isLowest) ? !!stats.isLowest[idx] : null,
    isLowest90d: Array.isArray(stats.isLowest90) ? !!stats.isLowest90[idx] : null,
    outOfStockPct30: pctAt(stats.outOfStockPercentage30), outOfStockPct90: pctAt(stats.outOfStockPercentage90),
    salesRankDrops30: dropsOrNull(stats.salesRankDrops30), salesRankDrops90: dropsOrNull(stats.salesRankDrops90), salesRankDrops180: dropsOrNull(stats.salesRankDrops180),
    buyBoxStats: parseBuyBoxStats(stats.buyBoxStats),
    // Split FBA/FBM das ofertas — dá a real "temperatura" da concorrência
    // (10 FBA brigando por buybox é bem diferente de 10 FBM), coisa que o
    // "ofertas ativas" total sozinho não mostra.
    offerCountFBA: typeof stats.offerCountFBA === 'number' ? stats.offerCountFBA : null,
    offerCountFBM: typeof stats.offerCountFBM === 'number' ? stats.offerCountFBM : null,
    // Contagem oficial que realmente bate com offerCountFBA+FBM — o campo
    // top-level "offersCount" do produto é uma métrica diferente (outra
    // condição/critério do Keepa) e pode não somar igual, o que parecia
    // inconsistente na tela ("9 ofertas" vs "2 FBA + 5 FBM").
    totalOfferCount: typeof stats.totalOfferCount === 'number' ? stats.totalOfferCount : null,
    // Preço "riscado" (de/por) — quando presente, é o sinal mais direto de
    // que o produto está com desconto ativo na Amazon nesse momento.
    savingBasis: centsToReais(stats.buyBoxSavingBasis),
    savingPct: typeof stats.buyBoxSavingPercentage === 'number' ? stats.buyBoxSavingPercentage : null,
    // % de variação do "vendido/mês" atual vs a média de 90 dias — sinal de
    // tendência (produto crescendo ou murchando), não só a foto do mês.
    deltaPct90MonthlySold: typeof stats.deltaPercent90_monthlySold === 'number' ? stats.deltaPercent90_monthlySold : null,
    // Ganhar a buybox sem estar "qualificado" (ex: preço fora da faixa
    // aceitável, MAP) é sinal de que a competição ali é instável/arriscada.
    buyBoxIsUnqualified: typeof stats.buyBoxIsUnqualified === 'boolean' ? stats.buyBoxIsUnqualified : null,
    buyBoxIsMAP: typeof stats.buyBoxIsMAP === 'boolean' ? stats.buyBoxIsMAP : null,
  };
}

const RETURN_RATE_LABELS = { 1: 'baixa', 2: 'alta' };
function mmToCm(mm) { return (mm === null || mm === undefined || mm <= 0) ? null : Math.round((mm / 10) * 10) / 10; }
function gToKg(g) { return (g === null || g === undefined || g <= 0) ? null : Math.round((g / 1000) * 100) / 100; }

function parseKeepaProduct(p) {
  const priceHistoryNew = extractCsvSeries(p.csv, 1, true);
  const priceHistoryAmazon = extractCsvSeries(p.csv, 0, true);
  const priceHistoryBuyBox = extractCsvSeries(p.csv, CSV_TYPE_BUYBOX_SHIPPING, true, true);
  const bsrHistory = extractCsvSeries(p.csv, 3, false);
  const ratingHistory = extractCsvSeries(p.csv, 16, false);
  const reviewCountHistory = extractCsvSeries(p.csv, 17, false);
  const buyboxPrice = centsToReais(p.buyBoxPrice);
  const currentPrice = buyboxPrice ?? lastValue(priceHistoryNew) ?? lastValue(priceHistoryAmazon);
  // Três séries separadas (Amazon/outros vendedores/buybox) — necessário
  // pro gráfico multi-série (cada linha com sua própria cor/significado,
  // igual ao gráfico real do Keepa).
  const priceHistory = {
    amazon: priceHistoryAmazon.slice(-90),
    new: priceHistoryNew.slice(-90),
    buybox: priceHistoryBuyBox.slice(-90),
  };
  const category = Array.isArray(p.categoryTree) && p.categoryTree.length > 0 ? p.categoryTree[p.categoryTree.length - 1]?.name ?? null : null;
  // Trilha completa (ex: "Saúde e Bem-Estar > Vitaminas e Suplementos"),
  // não só a última categoria — é como o Keepa mostra a árvore inteira.
  const categoryBreadcrumb = Array.isArray(p.categoryTree) ? p.categoryTree.map(c => c?.name).filter(Boolean) : [];
  const fbaFees = p.fbaFees ? {
    pickAndPack: centsToReais(p.fbaFees.pickAndPackFee),
    pickAndPackTax: centsToReais(p.fbaFees.pickAndPackFeeTax),
    storage: centsToReais(p.fbaFees.storageFee),
    storageTax: centsToReais(p.fbaFees.storageFeeTax),
  } : null;
  return {
    title: p.title ?? null,
    imageUrl: Array.isArray(p.imagesCSV) && p.imagesCSV.length > 0
      ? `https://images-na.ssl-images-amazon.com/images/I/${String(p.imagesCSV).split(",")[0]}`
      : null,
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
    bsrHistory: bsrHistory.slice(-90),
    monthlySold: typeof p.monthlySold === 'number' ? p.monthlySold : null,
    referralFeePct: typeof p.referralFeePercentage === 'number' ? p.referralFeePercentage : null,
    fbaFees,
    offers: parseOffers(p.offers),
    buyboxRotation90d: computeBuyboxRotation(p.buyBoxSellerIdHistory, 90),
    categoryRanks: parseCategoryRanks(p.salesRanks, p.salesRankReference, p.categoryTree, category),
    stats: parseStats(p.stats),
    brand: typeof p.brand === 'string' ? p.brand : null,
    color: typeof p.color === 'string' ? p.color : null,
    size: typeof p.size === 'string' ? p.size : null,
    listedSince: typeof p.listedSince === 'number' && p.listedSince > 0 ? keepaTimeToIso(p.listedSince) : null,
    packageWeightKg: gToKg(p.packageWeight),
    packageDimensionsCm: (p.packageLength > 0 && p.packageWidth > 0 && p.packageHeight > 0)
      ? { length: mmToCm(p.packageLength), width: mmToCm(p.packageWidth), height: mmToCm(p.packageHeight) }
      : null,
    // --- Sinais de risco/decisão pra quem quer comprar pra revender ---
    // "alta" taxa de devolução é um risco real de margem que nenhum outro
    // campo aqui mostra (o preço pode estar ótimo e o produto ainda assim
    // ser ruim pra revender por causa disso).
    returnRate: RETURN_RATE_LABELS[p.returnRate] ?? null,
    // ASIN redirecionado = a Amazon fundiu/descontinuou esse anúncio e
    // mandou pra outro — comprar estoque pra revender NESSE ASIN
    // específico seria comprar pra um anúncio que pode nem existir mais.
    isRedirectAsin: !!p.isRedirectASIN,
    // Presença de parentAsin/variations indica que esse produto compete
    // (e é comparado pela Amazon) junto com outras variações de
    // cor/tamanho — contexto que muda a leitura da concorrência.
    parentAsin: typeof p.parentAsin === 'string' ? p.parentAsin : null,
    variationsCount: Array.isArray(p.variations) ? p.variations.length : null,
    // Só vêm preenchidos quando a Amazon SUPRIME a buybox por preço fora
    // da faixa aceitável — quando presentes, são o sinal mais direto que
    // existe de "seu preço de venda planejado está alto/baixo demais".
    competitivePriceThreshold: centsToReais(p.competitivePriceThreshold),
    suggestedLowerPrice: centsToReais(p.suggestedLowerPrice),
    categoryBreadcrumb,
    ean: Array.isArray(p.eanList) && p.eanList.length > 0 ? p.eanList[0] : null,
    // --- Campos identificados na exportação completa do Keepa (arquivo do
    // cliente, "Grupo Fenelon", 2026-08-22) que faltavam: conteúdo
    // descritivo, ficha técnica (fabricante/modelo), e sinalizadores de
    // risco logístico (bateria/produto adulto) — todos já vêm no mesmo
    // request de sempre, sem custo extra de token. ---
    description: typeof p.description === 'string' ? p.description : null,
    features: Array.isArray(p.features) ? p.features.filter(f => typeof f === 'string' && f.trim()) : [],
    manufacturer: typeof p.manufacturer === 'string' ? p.manufacturer : null,
    model: typeof p.model === 'string' ? p.model : null,
    numberOfItems: typeof p.numberOfItems === 'number' ? p.numberOfItems : null,
    // Preço de lista (MSRP) — referência de desconto diferente da média de
    // 90 dias: é o preço "de fábrica" que a própria Amazon exibe riscado.
    listPrice: lastValue(extractCsvSeries(p.csv, 4, true)),
    // Baterias: exige embalagem/rotulagem especial e pode limitar frete
    // aéreo/FBA em alguns modais — risco logístico real na hora de decidir
    // importar/estocar.
    batteriesRequired: typeof p.batteriesRequired === 'boolean' ? p.batteriesRequired : null,
    batteriesIncluded: typeof p.batteriesIncluded === 'boolean' ? p.batteriesIncluded : null,
    isAdultProduct: typeof p.isAdultProduct === 'boolean' ? p.isAdultProduct : null,
  };
}

function mockKeepaResponse(asin) {
  const now = nowKeepaTime();
  const seller = Math.random() > 0.5 ? 'A1MOCKSELLER' : 'A2OUTROSELLER';
  return {
    asin,
    title: `Produto de teste (mock) ${asin}`,
    buyBoxSellerId: seller,
    buyBoxIsAmazon: false,
    buyBoxPrice: 12990,
    offersCount: 4,
    availabilityAmazon: 0,
    categoryTree: [{ catId: 100, name: 'Categoria Mock' }],
    imagesCSV: '',
    monthlySold: 340,
    referralFeePercentage: 15.0,
    fbaFees: { pickAndPackFee: 605, pickAndPackFeeTax: 0, storageFee: 40, storageFeeTax: 0 },
    salesRankReference: 100,
    salesRanks: {
      '100': [now - 60 * 24 * 5, 15000, now - 60 * 24 * 2, 12000],
      '200': [now - 60 * 24 * 5, 300, now - 60 * 24 * 2, 250],
    },
    buyBoxSellerIdHistory: [
      now - 60 * 24 * 10, 'A1MOCKSELLER',
      now - 60 * 24 * 6, 'A2OUTROSELLER',
      now - 60 * 24 * 2, seller,
    ],
    offers: [
      { sellerId: 'A1MOCKSELLER', condition: 1, isFBA: true, isAmazon: false, isPrime: true, offerCSV: [now - 60 * 24 * 2, 12990, 0], stockCSV: [now - 60 * 24 * 2, 117], lastSeen: now, coupon: 0 },
      { sellerId: 'A2OUTROSELLER', condition: 1, isFBA: true, isAmazon: false, isPrime: true, offerCSV: [now - 60 * 24 * 1, 13500, 0], stockCSV: [now - 60 * 24 * 1, 44], lastSeen: now, coupon: -10 },
      { sellerId: 'A3TERCEIRO', condition: 2, isFBA: false, isAmazon: false, isPrime: false, offerCSV: [now, 11800, 1200], stockCSV: [now, 8], lastSeen: now, coupon: 500 },
      { sellerId: 'A4QUARTOVENDEDOR', condition: 1, isFBA: true, isAmazon: false, isPrime: true, offerCSV: [now, 14500, 0], stockCSV: [now, 30], lastSeen: now, coupon: 0 },
      { sellerId: 'AMAZON', condition: 1, isFBA: true, isAmazon: true, isPrime: true, offerCSV: [now, 13990, 0], stockCSV: [now, 999], lastSeen: now, coupon: 0 },
    ],
    csv: [
      [now - 60 * 24 * 60, 14990, now - 60 * 24 * 40, 14990, now - 60 * 24 * 20, 13990, now - 60 * 24 * 5, 13990],
      [now - 60 * 24 * 60, 14500, now - 60 * 24 * 45, 13800, now - 60 * 24 * 30, 13990, now - 60 * 24 * 15, 12990, now - 60 * 24 * 2, 12990],
      null,
      [now - 60 * 24 * 60, 22000, now - 60 * 24 * 45, 18500, now - 60 * 24 * 30, 16000, now - 60 * 24 * 15, 13500, now - 60 * 24 * 2, 12000],
      null, null, null, null, null, null, null, null, null, null, null, null,
      [now - 60 * 24 * 5, 45],
      [now - 60 * 24 * 5, 320],
      [now - 60 * 24 * 60, 14200, 0, now - 60 * 24 * 40, 13990, 0, now - 60 * 24 * 20, 12990, 0, now - 60 * 24 * 2, 12990, 0],
    ],
    brand: 'Marca Mock',
    listedSince: now - 60 * 24 * 900,
    packageWeight: 250, packageHeight: 50, packageLength: 120, packageWidth: 80,
    returnRate: 1,
    isRedirectASIN: false,
    parentAsin: 'B0PARENTMOCK',
    variations: [{}, {}, {}],
    competitivePriceThreshold: null,
    suggestedLowerPrice: null,
    stats: {
      avg30: buildStatsArray(12990),
      avg90: buildStatsArray(13400),
      avg180: buildStatsArray(13800),
      min: buildStatsExtremeArray(now - 60 * 24 * 200, 10990),
      max: buildStatsExtremeArray(now - 60 * 24 * 500, 16990),
      isLowest: buildStatsBoolArray(false),
      isLowest90: buildStatsBoolArray(true),
      outOfStockPercentage30: buildStatsArray(2),
      outOfStockPercentage90: buildStatsArray(5),
      salesRankDrops30: 47, salesRankDrops90: 118, salesRankDrops180: 210,
      offerCountFBA: 3, offerCountFBM: 1,
      deltaPercent90_monthlySold: 22,
      buyBoxIsUnqualified: false, buyBoxIsMAP: false,
      buyBoxStats: {
        A1MOCKSELLER: { percentageWon: 62, avgPrice: 12990, avgNewOfferCount: 4, isFBA: true, lastSeen: now },
        A2OUTROSELLER: { percentageWon: 31, avgPrice: 13600, avgNewOfferCount: 4, isFBA: true, lastSeen: now - 60 * 24 * 6 },
        A3TERCEIRO: { percentageWon: 7, avgPrice: 11800, avgNewOfferCount: 4, isFBA: false, lastSeen: now - 60 * 24 * 20 },
      },
    },
  };
}
function buildStatsArray(valueAtBuyboxIdx) { const a = new Array(36).fill(-1); a[CSV_TYPE_BUYBOX_SHIPPING] = valueAtBuyboxIdx; return a; }
function buildStatsBoolArray(v) { const a = new Array(36).fill(false); a[CSV_TYPE_BUYBOX_SHIPPING] = v; return a; }
function buildStatsExtremeArray(time, value) { const a = new Array(36).fill(null); a[CSV_TYPE_BUYBOX_SHIPPING] = [time, value]; return a; }

// --- reputação de vendedor (/seller) ---

// Formato do envelope da resposta de /seller: trata tanto "sellers" como
// mapa {id: obj} quanto como array de objetos com sellerId embutido.
function normalizeSellersResponse(json) {
  if (json.sellers && typeof json.sellers === 'object' && !Array.isArray(json.sellers)) return json.sellers;
  if (Array.isArray(json.sellers)) {
    const out = {};
    for (const s of json.sellers) if (s?.sellerId) out[s.sellerId] = s;
    return out;
  }
  return {};
}

function parseSeller(s) {
  return {
    sellerName: s.sellerName ?? null,
    currentRating: typeof s.currentRating === 'number' ? s.currentRating : null,
    currentRatingCount: typeof s.currentRatingCount === 'number' ? s.currentRatingCount : null,
    hasFBA: !!s.hasFBA,
    ratingBreakdown: { positive: s.positiveRating ?? null, negative: s.negativeRating ?? null, neutral: s.neutralRating ?? null },
    trackedSinceRaw: typeof s.trackedSince === 'number' ? s.trackedSince : null,
    // Formato confirmado no backend oficial: [keepaTime, contagem].
    totalStorefrontAsins: Array.isArray(s.totalStorefrontAsins) && typeof s.totalStorefrontAsins[1] === 'number' ? s.totalStorefrontAsins[1] : null,
  };
}

// Parser mais rico que parseSeller, usado só na sincronização de vitrine
// (/keepa-sync-storefront) — inclui o catálogo de ASINs e as métricas de
// desempenho (posse de buybox, concorrentes médios, endereço comercial)
// que a busca de reputação simples (parseSeller) não precisa.
function parseSellerStorefront(s) {
  const addressParts = Array.isArray(s.address) ? s.address.filter(Boolean) : [];
  const asinList = Array.isArray(s.asinList) ? s.asinList.filter(a => typeof a === 'string' && /^[A-Z0-9]{10}$/.test(a)) : [];
  // totalStorefrontAsins às vezes vem vazio/ausente na resposta real do
  // Keepa (visto em produção em 2026-08-22 — a doc descreve o formato
  // [timestamp, contagem], mas nem todo vendedor tem esse metadado
  // calculado) — nesse caso o tamanho real do asinList que RECEBEMOS é
  // uma contagem tão confiável quanto, e evita mostrar "?" pro admin.
  const totalStorefrontAsins = Array.isArray(s.totalStorefrontAsins) && typeof s.totalStorefrontAsins[1] === 'number'
    ? s.totalStorefrontAsins[1]
    : (asinList.length > 0 ? asinList.length : null);
  return {
    sellerId: s.sellerId ?? null,
    sellerName: s.sellerName ?? null,
    businessName: typeof s.businessName === 'string' ? s.businessName : null,
    address: addressParts.length > 0 ? addressParts.join(', ') : null,
    tradeNumber: typeof s.tradeNumber === 'string' ? s.tradeNumber : null,
    currentRating: typeof s.currentRating === 'number' ? s.currentRating : null,
    currentRatingCount: typeof s.currentRatingCount === 'number' ? s.currentRatingCount : null,
    hasFBA: !!s.hasFBA,
    buyBoxNewOwnershipPct: typeof s.buyBoxNewOwnershipRate === 'number' ? s.buyBoxNewOwnershipRate : null,
    buyBoxUsedOwnershipPct: typeof s.buyBoxUsedOwnershipRate === 'number' ? s.buyBoxUsedOwnershipRate : null,
    avgBuyBoxCompetitors: typeof s.avgBuyBoxCompetitors === 'number' ? s.avgBuyBoxCompetitors : null,
    trackedSince: typeof s.trackedSince === 'number' && s.trackedSince > 0 ? keepaTimeToIso(s.trackedSince) : null,
    totalStorefrontAsins,
    // asinList vem "mais recente primeiro" segundo a doc oficial — já é a
    // ordem que faz sentido pra sincronizar (produtos ativos/vistos
    // recentemente entram primeiro se o catálogo for maior que o limite).
    asinList,
    categoryStats: Array.isArray(s.sellerCategoryStatistics) ? s.sellerCategoryStatistics.map(c => ({
      category: c.categoryName ?? null, listingsPct: c.listingsPercent ?? null,
      amazonListingsPct: c.amazonListingsPercent ?? null, avgSalesRank30: c.avgSalesRank30 ?? null,
    })) : [],
    brandStats: Array.isArray(s.sellerBrandStatistics) ? s.sellerBrandStatistics.map(b => ({
      brand: b.brandName ?? null, listingsPct: b.listingsPercent ?? null,
      amazonListingsPct: b.amazonListingsPercent ?? null, avgSalesRank30: b.avgSalesRank30 ?? null,
    })) : [],
  };
}

function mockSellerResponse(sellerIds) {
  const sellers = {};
  sellerIds.forEach((id, i) => {
    sellers[id] = {
      sellerName: `Vendedor Mock ${i + 1}`,
      currentRating: 90 + i,
      currentRatingCount: 1000 * (i + 1),
      hasFBA: i % 2 === 0,
      positiveRating: { lifetime: 90 + i },
      negativeRating: { lifetime: 2 },
      neutralRating: { lifetime: 3 },
      trackedSince: 5000000,
      totalStorefrontAsins: [5000000, 50 + i * 120],
    };
  });
  return { sellers, tokensLeft: 999, tokensConsumed: 0 };
}

function mockSellerStorefrontResponse(sellerId) {
  const now = nowKeepaTime();
  // Exatamente 10 caracteres cada, únicos entre si — um bug real aqui
  // (strings de 12 chars cortadas pra 10 todas colapsando pro mesmo
  // valor) só apareceu ao testar de ponta a ponta com Playwright, mas
  // seria idêntico com qualquer duplicata vinda de verdade do Keepa.
  const mockAsins = ['B0MOCK0001', 'B0MOCK0002', 'B0MOCK0003'];
  return {
    seller: {
      sellerId, sellerName: 'Loja Mock', businessName: 'Loja Mock LTDA',
      address: ['Rua Exemplo, 123', 'São Paulo', 'SP', '01000000', 'BR'],
      tradeNumber: '00.000.000/0001-00',
      currentRating: 95, currentRatingCount: 1200, hasFBA: true,
      buyBoxNewOwnershipRate: 62, buyBoxUsedOwnershipRate: 0, avgBuyBoxCompetitors: 2.4,
      trackedSince: now - 60 * 24 * 200,
      totalStorefrontAsins: [now, mockAsins.length],
      asinList: mockAsins,
      sellerCategoryStatistics: [{ categoryName: 'Categoria Mock', listingsPercent: 100, amazonListingsPercent: 20, avgSalesRank30: 5000 }],
      sellerBrandStatistics: [{ brandName: 'Marca Mock', listingsPercent: 100, amazonListingsPercent: 20, avgSalesRank30: 5000 }],
    },
    tokensLeft: 999, tokensConsumed: 0,
  };
}

module.exports = {
  keepaTimeToIso, nowKeepaTime, centsToReais, extractCsvSeries, lastValue,
  AVAILABILITY_LABELS, CONDITION_LABELS, CSV_TYPE_BUYBOX_SHIPPING,
  parseOffers, computeBuyboxRotation, parseCategoryRanks, parseBuyBoxStats, parseStats,
  mmToCm, gToKg, parseKeepaProduct, mockKeepaResponse,
  normalizeSellersResponse, parseSeller, mockSellerResponse,
  parseSellerStorefront, mockSellerStorefrontResponse,
};
