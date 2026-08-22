/* =========================================
   Yalca Portal — Compras & Concorrência (Keepa)
   Biblioteca pura (sem DOMContentLoaded próprio) — consumida pelo
   único ponto de inicialização em portal-app.js, mesmo padrão de
   charts.js.
   ========================================= */

let KEEPA_DATA = { tracked: [], cache: {}, alerts: [], sellerMetrics: null };
let LAST_KEEPA_SEARCH_RESULT = null;
// Reputação de vendedor já buscada nesta sessão — mantida entre pesquisas
// (um vendedor já visto fica "de graça" o resto da sessão). O cache de
// verdade é no servidor (keepa_seller_cache); isso aqui só evita uma
// chamada redundante se o cliente pesquisar o mesmo produto duas vezes.
let KEEPA_SELLER_REPUTATION = {};
// Quantos vendedores carregar automaticamente ao abrir o resultado (sem
// precisar de clique) — os N mais baratos, que são os que mais importam
// pra decisão. É a diferença entre a tela parecer "pronta" (com nome de
// verdade) ou "quebrada" (com ID técnico tipo A1B2C3D4E5) no primeiro olhar.
// Custo real: até N tokens extras por pesquisa nova (zero se os vendedores
// já estiverem no cache compartilhado de alguma busca anterior).
const KEEPA_AUTO_LOAD_SELLER_COUNT = 3;

/* ---------- Abas ---------- */
function initKeepaTabs() {
  document.querySelectorAll('.keepa-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.keepaTab;
      document.querySelectorAll('.keepa-tab').forEach(t => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.keepa-tabpanel').forEach(p => p.classList.toggle('is-active', p.dataset.keepaPanel === target));
    });
  });
}

/* ---------- Inicialização (formulários) ---------- */
function initKeepaSection() {
  initKeepaTabs();

  document.getElementById('keepaAddAsinBtn').addEventListener('click', handleAddTrackedAsin);

  document.getElementById('keepaTrackedBody').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-action="deleteTrackedAsin"]');
    if (delBtn) { handleDeleteTrackedAsin(delBtn.dataset.id); return; }
    const row = e.target.closest('[data-action="openTrackedDetail"]');
    if (row) openKeepaTrackedDetail(row.dataset.asin);
  });

  document.getElementById('keepaSearchForm').addEventListener('submit', handleKeepaSearchSubmit);

  document.getElementById('keepaUseInPricingBtn').addEventListener('click', useKeepaResultInPricingCalculator);

  document.getElementById('keepaLoadSellerRepBtn').addEventListener('click', handleLoadSellerReputation);
}

/* ---------- Carregamento ---------- */
async function reloadKeepaData() {
  const tracked = await yalcaFetchTrackedAsins();
  const asins = [...new Set(tracked.map(t => t.asin))];
  const [cacheRows, alerts, sellerMetrics] = await Promise.all([
    yalcaFetchKeepaCache(asins),
    yalcaFetchKeepaAlerts(asins, 10),
    // Só existe depois que um admin cadastra o seller ID e sincroniza a
    // vitrine pelo menos uma vez — null até lá, tratado no render.
    YALCA_PROFILE ? yalcaFetchSellerMetrics(YALCA_PROFILE.user_id).catch(() => null) : Promise.resolve(null),
  ]);
  const cacheByAsin = Object.fromEntries(cacheRows.map(c => [c.asin, c]));
  KEEPA_DATA = { tracked, cache: cacheByAsin, alerts, sellerMetrics };
}

/* ---------- "Meus Anúncios" ---------- */
function renderKeepaTracked() {
  const tbody = document.getElementById('keepaTrackedBody');
  if (!tbody) return;
  if (KEEPA_DATA.tracked.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="alert-empty">Nenhum produto monitorado ainda. Peça pra Yalca cadastrar o seller ID da sua loja, ou adicione um ASIN avulso acima.</td></tr>';
    return;
  }
  tbody.innerHTML = KEEPA_DATA.tracked.map(t => {
    const c = KEEPA_DATA.cache[t.asin];
    // Preço riscado/desconto ativo (quando a Amazon está com promoção
    // rodando nesse produto agora) — sinal de oportunidade ou de queda de
    // margem, dependendo de quem está com a buybox.
    const priceLabel = c && c.current_price != null
      ? `${yalcaFormatCurrency(c.current_price)}${c.saving_pct ? ` <span class="badge badge--ok" style="margin-left:4px;">-${c.saving_pct}%</span>` : ''}`
      : '—';
    const bsrLabel = c && c.bsr != null ? c.bsr.toLocaleString('pt-BR') : '—';
    const isOwnBuybox = c && c.buybox_seller && t.own_seller_name && c.buybox_seller === t.own_seller_name;
    const buyboxLabel = c && c.buybox_seller
      ? (isOwnBuybox ? '<span class="badge badge--ativo">Você</span>' : yalcaEscapeHtml(c.buybox_seller))
      : (c ? '<span class="text-muted-num">ninguém</span>' : '—');
    const ageLabel = c && c.cheap_data_updated_at
      ? `atualizado ${yalcaKeepaRelativeAge(c.cheap_data_updated_at)}`
      : 'aguardando primeira atualização';

    let vendasLabel = '—';
    if (c?.monthly_sold != null) {
      const trend = c.delta_pct_90_monthly_sold;
      vendasLabel = `${c.monthly_sold.toLocaleString('pt-BR')}${trend != null ? ` ${trend >= 0 ? '📈' : '📉'}` : ''}`;
    }
    const outOfStockLabel = c?.out_of_stock_pct_90 != null ? `${c.out_of_stock_pct_90}%` : '—';
    // total_offer_count é a contagem oficial (pode passar de 20 — o
    // parâmetro offers=20 só limita quantas ofertas detalhadas a gente
    // recebe, não o total real de concorrentes vendendo esse produto).
    const ofertasLabel = c?.total_offer_count != null ? c.total_offer_count : '—';

    const variantParts = [c?.color, c?.size].filter(Boolean);
    const productCell = `<div class="marketplace-cell">
      ${c?.image_url ? `<span class="marketplace-cell__logo"><img src="${yalcaEscapeHtml(c.image_url)}" alt="" loading="lazy"></span>` : ''}
      <div class="marketplace-cell__text">
        <strong>${yalcaEscapeHtml(t.label || c?.title || t.asin)}</strong>
        <span class="marketplace-cell__plan">${variantParts.length ? yalcaEscapeHtml(variantParts.join(' · ')) + ' · ' : ''}${ageLabel}</span>
      </div>
    </div>`;

    return `
    <tr class="is-clickable-row" data-action="openTrackedDetail" data-asin="${yalcaEscapeHtml(t.asin)}" title="Ver detalhes completos">
      <td data-label="Produto">${productCell}</td>
      <td data-label="ASIN">${yalcaEscapeHtml(t.asin)}</td>
      <td data-label="Preço" class="num">${priceLabel}</td>
      <td data-label="BSR" class="num">${bsrLabel}</td>
      <td data-label="Buybox">${buyboxLabel}</td>
      <td data-label="Ofertas" class="num">${ofertasLabel}</td>
      <td data-label="Comprado/mês" class="num">${vendasLabel}</td>
      <td data-label="Fora de estoque (90d)" class="num">${outOfStockLabel}</td>
      <td class="row-actions">
        <a class="icon-btn" title="Ver na Amazon" href="https://www.amazon.com.br/dp/${encodeURIComponent(t.asin)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">↗</a>
        <button class="icon-btn" title="Parar de monitorar" data-action="deleteTrackedAsin" data-id="${t.id}" onclick="event.stopPropagation()">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

// Converte uma linha crua de keepa_asin_cache (colunas snake_case, vindas
// direto do Supabase) no mesmo "shape" camelCase que o resultado de uma
// busca ao vivo usa — espelha o formatResult() do keepa-api/server.js, só
// que do lado do cliente, pra poder reaproveitar os mesmos renderizadores
// (KPIs, gráficos, tabelas) no modal de detalhe de um anúncio monitorado.
function yalcaCacheRowToResult(c) {
  return {
    asin: c.asin, title: c.title, imageUrl: c.image_url, currentPrice: c.current_price, bsr: c.bsr,
    category: c.category, rating: c.rating, reviewCount: c.review_count,
    buybox: c.buybox_seller ? { seller: c.buybox_seller, isAmazon: c.buybox_is_amazon, price: c.buybox_price } : null,
    offersCount: c.offers_count, availabilityStatus: c.availability_status,
    priceHistory: c.price_history ?? { amazon: [], new: [], buybox: [] },
    bsrHistory: c.bsr_history ?? [],
    monthlySold: c.monthly_sold ?? null,
    referralFeePct: c.referral_fee_pct ?? null,
    fbaFeeTotal: [c.fba_pick_pack_fee, c.fba_pick_pack_fee_tax, c.fba_storage_fee, c.fba_storage_fee_tax]
      .filter((v) => typeof v === 'number')
      .reduce((sum, v) => (sum ?? 0) + v, null),
    offers: c.offers ?? [],
    buyboxRotation90d: c.buybox_rotation_90d ?? null,
    categoryRanks: c.category_ranks ?? [],
    brand: c.brand ?? null, color: c.color ?? null, size: c.size ?? null,
    listedSince: c.listed_since ?? null,
    packageWeightKg: c.package_weight_kg ?? null,
    packageDimensionsCm: c.package_length_cm != null ? { length: c.package_length_cm, width: c.package_width_cm, height: c.package_height_cm } : null,
    stats: {
      avg30: c.price_avg_30 ?? null, avg90: c.price_avg_90 ?? null, avg180: c.price_avg_180 ?? null,
      lowestEver: c.price_lowest_ever ?? null, highestEver: c.price_highest_ever ?? null,
      isLowestEver: c.is_lowest_ever ?? null, isLowest90d: c.is_lowest_90d ?? null,
      outOfStockPct30: c.out_of_stock_pct_30 ?? null, outOfStockPct90: c.out_of_stock_pct_90 ?? null,
      salesRankDrops30: c.sales_rank_drops_30 ?? null, salesRankDrops90: c.sales_rank_drops_90 ?? null, salesRankDrops180: c.sales_rank_drops_180 ?? null,
      buyBoxStats: c.buybox_stats ?? [],
      offerCountFBA: c.offer_count_fba ?? null, offerCountFBM: c.offer_count_fbm ?? null,
      totalOfferCount: c.total_offer_count ?? null,
      deltaPct90MonthlySold: c.delta_pct_90_monthly_sold ?? null,
      buyBoxIsUnqualified: c.buybox_is_unqualified ?? null, buyBoxIsMAP: c.buybox_is_map ?? null,
      savingBasis: c.saving_basis ?? null, savingPct: c.saving_pct ?? null,
    },
    returnRate: c.return_rate ?? null,
    isRedirectAsin: c.is_redirect_asin ?? false,
    parentAsin: c.parent_asin ?? null,
    variationsCount: c.variations_count ?? null,
    competitivePriceThreshold: c.competitive_price_threshold ?? null,
    suggestedLowerPrice: c.suggested_lower_price ?? null,
    categoryBreadcrumb: c.category_breadcrumb ?? [],
    ean: c.ean ?? null,
    cheapDataAgeMinutes: c.cheap_data_updated_at ? Math.round((Date.now() - new Date(c.cheap_data_updated_at).getTime()) / 60000) : null,
    isMockData: typeof c.last_synced_by === 'string' && c.last_synced_by.endsWith('_mock'),
  };
}

// Abre o modal de detalhe completo de um anúncio monitorado a partir dos
// dados já em cache (sem gastar token novo — é a mesma leitura já feita
// pra montar a tabela "Meus Anúncios", só que exibida por inteiro).
function openKeepaTrackedDetail(asin) {
  const t = KEEPA_DATA.tracked.find(x => x.asin === asin);
  const c = KEEPA_DATA.cache[asin];
  if (!c) {
    alert('Ainda sem dados desse anúncio — aguarde a próxima atualização automática (roda de hora em hora).');
    return;
  }
  const result = yalcaCacheRowToResult(c);
  renderKeepaTrackedDetailModal(result, t);
  openModal('keepaTrackedDetailModal');
}

function renderKeepaTrackedDetailModal(result, t) {
  document.getElementById('keepaTrackedDetailTitle').textContent = (t && t.label) || result.title || result.asin;

  const metaParts = [];
  if (result.brand) metaParts.push(result.brand);
  if (result.listedSince) metaParts.push(`no mercado desde ${yalcaFormatDate(result.listedSince.slice(0, 10))}`);
  if (result.packageDimensionsCm) metaParts.push(`${result.packageDimensionsCm.length}×${result.packageDimensionsCm.width}×${result.packageDimensionsCm.height}cm${result.packageWeightKg ? `, ${result.packageWeightKg}kg` : ''}`);
  if (result.variationsCount) metaParts.push(`${result.variationsCount} variações (cor/tamanho)`);
  document.getElementById('keepaTrackedDetailMeta').textContent = metaParts.join(' · ');

  document.getElementById('keepaTrackedDetailMockBanner').style.display = result.isMockData ? '' : 'none';
  document.getElementById('keepaTrackedDetailRedirectBanner').style.display = result.isRedirectAsin ? '' : 'none';

  document.getElementById('keepaTrackedDetailConfidence').textContent =
    result.cheapDataAgeMinutes != null ? `atualizado ${yalcaKeepaMinutesLabel(result.cheapDataAgeMinutes)}` : '';

  renderKpiGrid('keepaTrackedDetailKpis', buildKeepaKpis(result));
  document.getElementById('keepaTrackedDetailBadges').innerHTML = buildKeepaPriceBadges(result.stats || {});

  renderKeepaPriceCharts(result, 'keepaTrackedDetailPriceChart', 'keepaTrackedDetailRankWrap', 'keepaTrackedDetailRankChart');

  renderKeepaDetailPanel(result, 'keepaTrackedDetailDetails');

  const stats = result.stats || {};
  renderKeepaBuyboxStatsTable(stats.buyBoxStats || [], 'keepaTrackedDetailBuyboxWrap', 'keepaTrackedDetailBuyboxBody');
  renderKeepaCategoryRanks(result.categoryRanks || [], 'keepaTrackedDetailRanksWrap', 'keepaTrackedDetailRanksList');
  renderKeepaOffersTable(result.offers || [], 'keepaTrackedDetailOffersWrap', 'keepaTrackedDetailOffersBody', false);
}

// "Desempenho do vendedor" — só aparece depois que um admin cadastra o
// seller ID e sincroniza a vitrine pelo menos uma vez.
function renderKeepaSellerMetrics() {
  const panel = document.getElementById('keepaSellerMetricsPanel');
  if (!panel) return;
  const m = KEEPA_DATA.sellerMetrics;
  if (!m) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  document.getElementById('keepaSellerName').textContent = m.seller_name || m.business_name || m.seller_id;
  document.getElementById('keepaSellerMeta').textContent = [m.business_name, m.address, m.trade_number].filter(Boolean).join(' · ');
  document.getElementById('keepaSellerAmazonLink').href = `https://www.amazon.com.br/sp?seller=${encodeURIComponent(m.seller_id)}`;

  renderKpiGrid('keepaSellerMetricsKpis', [
    { label: 'Classificação', value: m.current_rating != null ? `${m.current_rating}%` : '—', delta: null },
    { label: 'Contagem de avaliações', value: m.current_rating_count != null ? m.current_rating_count.toLocaleString('pt-BR') : '—', delta: null },
    { label: 'Listagens verificadas', value: m.total_storefront_asins != null ? m.total_storefront_asins : '—', delta: null },
    { label: 'Tem FBA', value: m.has_fba ? 'Sim' : 'Não', delta: null },
    { label: 'Posse da Buy Box (Novo)', value: m.buybox_new_ownership_pct != null ? `${m.buybox_new_ownership_pct}%` : '—', delta: null },
    { label: 'Posse da Buy Box (Usado)', value: m.buybox_used_ownership_pct != null ? `${m.buybox_used_ownership_pct}%` : '—', delta: null },
    { label: 'Média de concorrentes na Buy Box', value: m.avg_buybox_competitors != null ? Number(m.avg_buybox_competitors).toFixed(2) : '—', delta: null },
    { label: 'Acompanhado desde', value: m.tracked_since ? yalcaFormatDate(m.tracked_since.slice(0, 10)) : '—', delta: null },
  ]);

  document.getElementById('keepaSellerLastSync').textContent = m.last_synced_at
    ? `Vitrine sincronizada ${yalcaKeepaMinutesLabel(Math.round((Date.now() - new Date(m.last_synced_at).getTime()) / 60000))}`
    : '';
}

function yalcaKeepaRelativeAge(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'há poucos minutos';
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function renderKeepaAlerts() {
  const container = document.getElementById('keepaAlerts');
  if (!container) return;
  const ownSellerByAsin = Object.fromEntries(KEEPA_DATA.tracked.filter(t => t.own_seller_name).map(t => [t.asin, t.own_seller_name]));
  const trackedLabelByAsin = Object.fromEntries(KEEPA_DATA.tracked.map(t => [t.asin, t.label || t.asin]));

  const formatted = KEEPA_DATA.alerts.map(a => {
    const ownSeller = ownSellerByAsin[a.asin];
    let level = 'warning';
    let icon = 'ℹ️';
    let message = a.message;

    if (a.alert_type === 'buybox_lost' && ownSeller && a.previous_value && a.previous_value.seller === ownSeller) {
      level = 'critical'; icon = '⛔'; message = 'Você perdeu a buybox — ninguém está vendendo agora.';
    } else if (a.alert_type === 'buybox_changed' && ownSeller && a.previous_value && a.previous_value.seller === ownSeller) {
      level = 'critical'; icon = '⛔'; message = `Você perdeu a buybox pra ${a.new_value?.seller ?? 'outro vendedor'}.`;
    } else if (a.alert_type === 'buybox_regained' && ownSeller && a.new_value && a.new_value.seller === ownSeller) {
      level = ''; icon = '✅'; message = 'Você recuperou a buybox!';
    } else if (a.alert_type === 'price_drop') { icon = '📉'; }
    else if (a.alert_type === 'price_increase') { icon = '📈'; }
    else if (a.alert_type === 'out_of_stock') { level = 'critical'; icon = '⛔'; }
    else if (a.alert_type === 'rating_drop') { icon = '⭐'; }

    return { level, icon, title: trackedLabelByAsin[a.asin] || a.asin, sub: message };
  });

  renderAlertList(container, formatted);
}

/* ---------- Adicionar / remover ASIN monitorado ---------- */
async function handleAddTrackedAsin() {
  const asinInput = document.getElementById('keepaNewAsin');
  const labelInput = document.getElementById('keepaNewAsinLabel');
  const asin = asinInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    alert('ASIN inválido — deve ter 10 letras/números (ex: B0EXAMPLE1).');
    return;
  }
  try {
    await yalcaAddTrackedAsin({ asin, label: labelInput.value.trim() });
    asinInput.value = '';
    labelInput.value = '';
    await reloadKeepaData();
    renderKeepaTracked();
    renderKeepaAlerts();
  } catch (err) {
    alert('Não foi possível adicionar: ' + err.message);
  }
}

async function handleDeleteTrackedAsin(id) {
  if (!confirm('Parar de monitorar este ASIN?')) return;
  try {
    await yalcaDeleteTrackedAsin(id);
    await reloadKeepaData();
    renderKeepaTracked();
    renderKeepaAlerts();
  } catch (err) {
    alert('Não foi possível remover: ' + err.message);
  }
}

/* ---------- "Pesquisar Produto" ----------
   Aceita três formatos no mesmo campo: ASIN direto (10 letras/números),
   um link de produto da Amazon (extrai o ASIN da URL), ou o código de
   barras do produto (EAN/UPC/ISBN, 8-14 dígitos — a Amazon aceita como
   parâmetro "code" na busca, útil quando o cliente só tem a embalagem
   física em mãos e não sabe o ASIN). */
function yalcaParseKeepaSearchInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // Link da Amazon: procura o ASIN nos formatos de URL mais comuns
  // (/dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN) em qualquer domínio da
  // Amazon — funciona colando a URL inteira ou só o caminho.
  const urlMatch = trimmed.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (urlMatch) return { asin: urlMatch[1].toUpperCase() };

  const upper = trimmed.toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(upper)) return { asin: upper };

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (/^\d{8,14}$/.test(digitsOnly)) return { code: digitsOnly };

  return null;
}

async function handleKeepaSearchSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('keepaSearchAsin');
  const statusEl = document.getElementById('keepaSearchStatus');
  const query = yalcaParseKeepaSearchInput(input.value);
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!query) {
    statusEl.textContent = 'Não reconheci isso como ASIN, link de produto da Amazon ou código de barras. Exemplos: B0EXAMPLE1, https://www.amazon.com.br/dp/B0EXAMPLE1, ou um EAN de 8 a 14 dígitos.';
    statusEl.style.color = 'var(--critical)';
    return;
  }

  statusEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Pesquisando...';
  document.getElementById('keepaSearchResultPanel').style.display = 'none';

  try {
    const result = await yalcaKeepaSearch(query);
    if (!result.ok) {
      statusEl.textContent = result.message || 'Não foi possível pesquisar agora.';
      statusEl.style.color = 'var(--warning)';
      return;
    }
    LAST_KEEPA_SEARCH_RESULT = result;
    renderKeepaSearchResult(result);
  } catch (err) {
    statusEl.textContent = 'Não foi possível consultar agora: ' + err.message;
    statusEl.style.color = 'var(--critical)';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Pesquisar';
  }
}

function renderKeepaSearchResult(result) {
  const panel = document.getElementById('keepaSearchResultPanel');
  panel.style.display = '';

  document.getElementById('keepaResultTitle').textContent = result.title || result.asin;

  const metaParts = [];
  if (result.brand) metaParts.push(result.brand);
  if (result.listedSince) metaParts.push(`no mercado desde ${yalcaFormatDate(result.listedSince.slice(0, 10))}`);
  if (result.packageDimensionsCm) metaParts.push(`${result.packageDimensionsCm.length}×${result.packageDimensionsCm.width}×${result.packageDimensionsCm.height}cm${result.packageWeightKg ? `, ${result.packageWeightKg}kg` : ''}`);
  if (result.variationsCount) metaParts.push(`${result.variationsCount} variações (cor/tamanho)`);
  document.getElementById('keepaResultMeta').textContent = metaParts.join(' · ');

  document.getElementById('keepaMockBanner').style.display = result.isMockData ? '' : 'none';

  // Aviso crítico: ASIN redirecionado significa que a Amazon fundiu ou
  // descontinuou esse anúncio específico — comprar estoque pra revender
  // NELE seria comprar pra um anúncio que pode nem existir mais.
  const redirectBanner = document.getElementById('keepaRedirectBanner');
  redirectBanner.style.display = result.isRedirectAsin ? '' : 'none';

  const sourceLabel = result.source === 'cache' ? 'dado em cache' : 'consulta ao vivo';
  document.getElementById('keepaResultConfidence').textContent =
    `${sourceLabel} · atualizado ${result.cheapDataAgeMinutes != null ? yalcaKeepaMinutesLabel(result.cheapDataAgeMinutes) : 'agora'}`;

  const rotationHint = result.buyboxRotation90d != null
    ? (result.buyboxRotation90d === 0 ? 'buybox estável nos últimos 90 dias' : `trocou de dono ${result.buyboxRotation90d}x nos últimos 90 dias`)
    : null;
  // Ganhar a buybox "não qualificado" (preço fora da faixa aceitável) ou
  // sob restrição de MAP é sinal de que a disputa de preço ali é instável —
  // vale mais como alerta do que a rotação sozinha.
  const buyboxWarnParts = [];
  if (result.stats?.buyBoxIsUnqualified) buyboxWarnParts.push('vendedor não está "qualificado" pra buybox (preço fora da faixa aceitável)');
  if (result.stats?.buyBoxIsMAP) buyboxWarnParts.push('preço sob política de MAP');
  const buyboxHint = [result.buybox?.isAmazon ? 'é a própria Amazon' : rotationHint, ...buyboxWarnParts].filter(Boolean).join(' · ');
  // "Ninguém com a buybox" é um estado REAL da Amazon (acontece mesmo com
  // ofertas ativas — ex: preço fora da faixa aceitável, restrição de
  // categoria, corte temporário) e não um erro do painel — mas o texto
  // antigo ("ninguém está vendendo agora") lia como se o produto estivesse
  // sem nenhuma oferta, o que confundia quem via ofertas ativas > 0 ao lado.
  const buyboxKpi = result.buybox
    ? { label: 'Buybox', value: yalcaEscapeHtml(result.buybox.seller), hint: buyboxHint || null, delta: null }
    : { label: 'Buybox', value: '—', hint: 'nenhum vendedor está com a buybox agora — pode acontecer mesmo havendo ofertas ativas', delta: null };

  const stats = result.stats || {};
  const priceNow = result.buybox?.price ?? result.currentPrice;
  let priceHint = null;
  if (priceNow != null && stats.avg90 != null && stats.avg90 > 0) {
    const deltaPct = ((priceNow - stats.avg90) / stats.avg90) * 100;
    priceHint = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}% vs. média dos últimos 90 dias`;
  }
  // suggestedLowerPrice/competitivePriceThreshold só vêm preenchidos quando
  // a Amazon SUPRIME a buybox por preço fora da faixa — o sinal mais direto
  // que existe de "o preço de venda planejado está errado pra esse produto".
  if (result.suggestedLowerPrice != null) {
    priceHint = `${priceHint ? priceHint + ' · ' : ''}Amazon sugere baixar pra ${yalcaFormatCurrency(result.suggestedLowerPrice)} (buybox suprimida)`;
  } else if (result.competitivePriceThreshold != null) {
    priceHint = `${priceHint ? priceHint + ' · ' : ''}preço competitivo de referência: ${yalcaFormatCurrency(result.competitivePriceThreshold)}`;
  }

  // Vendas estimadas: monthlySold é dado direto da Amazon, mas a maioria dos
  // produtos não tem esse valor — nesse caso usamos a contagem de quedas no
  // ranking (que o próprio Keepa já calcula) como estimativa, deixando claro
  // que é estimativa e não dado direto. deltaPct90MonthlySold (quando
  // disponível) mostra se a demanda está crescendo ou murchando, não só a
  // foto do mês — importante pra não comprar estoque de um produto em queda.
  let vendasValue = '—';
  let vendasHint = 'sem dado suficiente pra estimar';
  if (result.monthlySold != null) {
    vendasValue = result.monthlySold.toLocaleString('pt-BR');
    vendasHint = 'dado direto da Amazon';
  } else if (stats.salesRankDrops30 != null) {
    vendasValue = `~${stats.salesRankDrops30.toLocaleString('pt-BR')}`;
    vendasHint = 'estimativa por quedas no ranking (não é dado direto da Amazon)';
  }
  if (stats.deltaPct90MonthlySold != null) {
    const trend = stats.deltaPct90MonthlySold;
    vendasHint = `${trend >= 0 ? '📈' : '📉'} ${trend >= 0 ? '+' : ''}${trend}% vs. média de 90 dias · ${vendasHint}`;
  }

  const ofertasHintParts = [];
  if (result.availabilityStatus) ofertasHintParts.push(result.availabilityStatus);
  // Divisão FBA/FBM dá a real "temperatura" da concorrência — 10 ofertas
  // FBA brigando por buybox é bem diferente de 10 FBM.
  if (stats.offerCountFBA != null || stats.offerCountFBM != null) {
    ofertasHintParts.push(`${stats.offerCountFBA ?? 0} FBA · ${stats.offerCountFBM ?? 0} FBM`);
  }
  // totalOfferCount (stats) é a métrica que realmente soma igual a
  // offerCountFBA+FBM — o "offersCount" do produto mede outra coisa e podia
  // aparecer inconsistente ao lado da divisão FBA/FBM (ex: "9" vs "2+5").
  const ofertasAtivasValue = result.stats?.totalOfferCount ?? result.offersCount;

  // Estoque: do vendedor da buybox quando existe, senão do mais barato
  // (offers já vem ordenado por preço). Só fica disponível a partir de
  // 2026-08-21, quando passamos a pedir stock=1 ao Keepa — antes disso
  // essa coluna sempre voltava vazia.
  const offersList = result.offers || [];
  const buyboxOffer = result.buybox ? offersList.find(o => o.sellerId === result.buybox.seller) : null;
  const stockRefOffer = buyboxOffer || offersList[0] || null;
  const estoqueValue = stockRefOffer?.stock != null ? stockRefOffer.stock : '—';
  const estoqueHint = stockRefOffer?.stock != null ? (buyboxOffer ? 'do vendedor da buybox' : 'do vendedor mais barato') : 'sem dado de estoque nessa consulta';

  const kpis = buildKeepaKpis(result);
  renderKpiGrid('keepaResultKpis', kpis);

  document.getElementById('keepaPriceBadges').innerHTML = buildKeepaPriceBadges(stats);

  renderKeepaPriceCharts(result, 'keepaPriceHistoryChart', 'keepaRankHistoryWrap', 'keepaRankHistoryChart');

  renderKeepaBuyboxStatsTable(stats.buyBoxStats || [], 'keepaBuyboxStatsPanel', 'keepaBuyboxStatsBody');
  renderKeepaCategoryRanks(result.categoryRanks || [], 'keepaCategoryRanksPanel', 'keepaCategoryRanksList');
  renderKeepaOffersTable(result.offers || [], 'keepaOffersPanel', 'keepaOffersBody', true);
  renderKeepaDetailPanel(result, 'keepaResultDetails');
  autoLoadTopSellerReputation(result.offers || [], stats.buyBoxStats || []);
}

// Monta a lista de KPIs a partir de um `result` (mesmo shape vindo da busca
// ao vivo OU convertido de uma linha de cache via yalcaCacheRowToResult) —
// compartilhado entre o painel de pesquisa e o modal de detalhe de anúncio
// monitorado, pra não duplicar a mesma conta em dois lugares.
function buildKeepaKpis(result) {
  const stats = result.stats || {};
  const priceNow = result.buybox?.price ?? result.currentPrice;
  let priceHint = null;
  if (priceNow != null && stats.avg90 != null && stats.avg90 > 0) {
    const deltaPct = ((priceNow - stats.avg90) / stats.avg90) * 100;
    priceHint = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}% vs. média dos últimos 90 dias`;
  }
  if (result.suggestedLowerPrice != null) {
    priceHint = `${priceHint ? priceHint + ' · ' : ''}Amazon sugere baixar pra ${yalcaFormatCurrency(result.suggestedLowerPrice)} (buybox suprimida)`;
  } else if (result.competitivePriceThreshold != null) {
    priceHint = `${priceHint ? priceHint + ' · ' : ''}preço competitivo de referência: ${yalcaFormatCurrency(result.competitivePriceThreshold)}`;
  }

  const rotationHint = result.buyboxRotation90d != null
    ? (result.buyboxRotation90d === 0 ? 'buybox estável nos últimos 90 dias' : `trocou de dono ${result.buyboxRotation90d}x nos últimos 90 dias`)
    : null;
  const buyboxWarnParts = [];
  if (stats.buyBoxIsUnqualified) buyboxWarnParts.push('vendedor não está "qualificado" pra buybox (preço fora da faixa aceitável)');
  if (stats.buyBoxIsMAP) buyboxWarnParts.push('preço sob política de MAP');
  const buyboxHint = [result.buybox?.isAmazon ? 'é a própria Amazon' : rotationHint, ...buyboxWarnParts].filter(Boolean).join(' · ');
  const buyboxKpi = result.buybox
    ? { label: 'Buybox', value: yalcaEscapeHtml(result.buybox.seller), hint: buyboxHint || null, delta: null }
    : { label: 'Buybox', value: '—', hint: 'nenhum vendedor está com a buybox agora — pode acontecer mesmo havendo ofertas ativas', delta: null };

  let vendasValue = '—';
  let vendasHint = 'sem dado suficiente pra estimar';
  if (result.monthlySold != null) {
    vendasValue = result.monthlySold.toLocaleString('pt-BR');
    vendasHint = 'dado direto da Amazon';
  } else if (stats.salesRankDrops30 != null) {
    vendasValue = `~${stats.salesRankDrops30.toLocaleString('pt-BR')}`;
    vendasHint = 'estimativa por quedas no ranking (não é dado direto da Amazon)';
  }
  if (stats.deltaPct90MonthlySold != null) {
    const trend = stats.deltaPct90MonthlySold;
    vendasHint = `${trend >= 0 ? '📈' : '📉'} ${trend >= 0 ? '+' : ''}${trend}% vs. média de 90 dias · ${vendasHint}`;
  }

  const ofertasHintParts = [];
  if (result.availabilityStatus) ofertasHintParts.push(result.availabilityStatus);
  if (stats.offerCountFBA != null || stats.offerCountFBM != null) {
    ofertasHintParts.push(`${stats.offerCountFBA ?? 0} FBA · ${stats.offerCountFBM ?? 0} FBM`);
  }
  const ofertasAtivasValue = stats.totalOfferCount ?? result.offersCount;

  const offersList = result.offers || [];
  const buyboxOffer = result.buybox ? offersList.find(o => o.sellerId === result.buybox.seller) : null;
  const stockRefOffer = buyboxOffer || offersList[0] || null;
  const estoqueValue = stockRefOffer?.stock != null ? stockRefOffer.stock : '—';
  const estoqueHint = stockRefOffer?.stock != null ? (buyboxOffer ? 'do vendedor da buybox' : 'do vendedor mais barato') : 'sem dado de estoque nessa consulta';

  return [
    { label: 'Preço da buybox', value: priceNow != null ? yalcaFormatCurrency(priceNow) : '—', delta: null, hint: priceHint },
    buyboxKpi,
    { label: 'BSR (ranking)', value: result.bsr != null ? result.bsr.toLocaleString('pt-BR') : '—', delta: null, hint: 'quanto menor, mais vende' },
    { label: 'Avaliação', value: result.rating != null ? `${result.rating.toFixed(1)} ★` : '—', delta: null, hint: result.reviewCount != null ? `${result.reviewCount} avaliações` : null },
    { label: 'Ofertas ativas', value: ofertasAtivasValue != null ? ofertasAtivasValue : '—', delta: null, hint: ofertasHintParts.join(' · ') || null },
    { label: 'Vendas estimadas/mês', value: vendasValue, delta: null, hint: vendasHint },
    { label: 'Taxa de devolução', value: result.returnRate ? (result.returnRate === 'alta' ? '⚠️ Alta' : 'Baixa') : '—', delta: null, hint: result.returnRate ? 'reportada pela Amazon — pesa na decisão de revender' : 'sem dado suficiente' },
    { label: 'Taxa de referência', value: result.referralFeePct != null ? `${result.referralFeePct.toFixed(1)}%` : '—', delta: null, hint: 'comissão real da Amazon nesse produto' },
    { label: 'Taxa FBA (fulfillment)', value: result.fbaFeeTotal != null ? yalcaFormatCurrency(result.fbaFeeTotal) : '—', delta: null, hint: 'coleta + embalagem + armazenagem' },
    { label: 'Estoque disponível', value: estoqueValue, delta: null, hint: estoqueHint },
    { label: 'Preço médio (90 dias)', value: stats.avg90 != null ? yalcaFormatCurrency(stats.avg90) : '—', delta: null, hint: 'referência pra saber se o preço atual está alto ou baixo' },
    { label: 'Fora de estoque (90d)', value: stats.outOfStockPct90 != null ? `${stats.outOfStockPct90}%` : '—', delta: null, hint: stats.outOfStockPct90 == null ? 'sem dado suficiente' : (stats.outOfStockPct90 > 0 ? 'quanto do tempo o produto ficou indisponível' : 'sempre em estoque nos últimos 90 dias') },
  ];
}

function buildKeepaPriceBadges(stats) {
  const badges = [];
  if (stats.isLowestEver) badges.push('<span class="badge badge--ok">🔥 Menor preço histórico</span>');
  else if (stats.isLowest90d) badges.push('<span class="badge badge--ok">Menor preço em 90 dias</span>');
  if (stats.lowestEver?.price != null) badges.push(`<span class="kpi-card__hint">menor já registrado: ${yalcaFormatCurrency(stats.lowestEver.price)} em ${yalcaFormatDate(stats.lowestEver.date.slice(0, 10))}</span>`);
  return badges.join('');
}

// Gráfico de preço: três séries separadas (mesma linguagem de cores que o
// Keepa usa de verdade — laranja=Amazon, azul=outros vendedores, magenta=
// buybox) em vez de uma linha genérica única. Ranking (BSR) fica num
// gráfico SEPARADO (escalas incompatíveis — nunca eixo duplo).
function renderKeepaPriceCharts(result, priceChartId, rankWrapId, rankChartId) {
  const priceChartContainer = document.getElementById(priceChartId);
  const ph = result.priceHistory || { amazon: [], new: [], buybox: [] };
  const priceSeries = [];
  if (ph.buybox?.length > 1) priceSeries.push({ name: 'Buybox', color: YALCA_COLORS.series5, data: ph.buybox.map(p => ({ date: p.date, value: p.value })) });
  if (ph.amazon?.length > 1) priceSeries.push({ name: 'Amazon', color: YALCA_COLORS.series2, data: ph.amazon.map(p => ({ date: p.date, value: p.value })) });
  if (ph.new?.length > 1) priceSeries.push({ name: 'Outros vendedores', color: YALCA_COLORS.series1, data: ph.new.map(p => ({ date: p.date, value: p.value })) });
  if (priceSeries.length > 0) {
    yalcaRenderLineChart(priceChartContainer, { series: priceSeries, formatValue: (v) => yalcaFormatCurrency(v) });
  } else {
    priceChartContainer.innerHTML = '<p class="alert-empty">Sem histórico de preço suficiente pra mostrar o gráfico ainda.</p>';
  }

  const rankWrap = document.getElementById(rankWrapId);
  const rankChartContainer = document.getElementById(rankChartId);
  if (result.bsrHistory && result.bsrHistory.length > 1) {
    rankWrap.style.display = '';
    yalcaRenderLineChart(rankChartContainer, {
      series: [{ name: 'Ranking (BSR)', color: YALCA_COLORS.series3, data: result.bsrHistory.map(p => ({ date: p.date, value: p.value })) }],
      formatValue: (v) => `#${Math.round(v).toLocaleString('pt-BR')}`
    });
  } else {
    rankWrap.style.display = 'none';
  }
}

// Painel "Detalhes do produto" — reúne num único lugar, em formato
// chave/valor de duas colunas, tudo que já buscamos mas ficava espalhado
// entre KPIs/badges/tabelas — mesma ideia da aba "Data" do Keepa, que
// concentra todos os detalhes cadastrais e de preço num só lugar.
function renderKeepaDetailPanel(result, elId) {
  const el = document.getElementById(elId || 'keepaResultDetails');
  const stats = result.stats || {};

  const cheapestByFulfillment = (isFBA) => {
    const match = (result.offers || []).find(o => !o.isAmazon && o.isFBA === isFBA && o.price != null);
    return match ? `${yalcaEscapeHtml(match.sellerId)} — ${yalcaFormatCurrency(match.price)}` : '—';
  };

  const row = (label, value) => value != null && value !== ''
    ? `<div class="keepa-detail-row"><span>${yalcaEscapeHtml(label)}</span><span>${value}</span></div>`
    : '';

  const leftRows = [
    row('Categoria', result.categoryBreadcrumb?.length ? yalcaEscapeHtml(result.categoryBreadcrumb.join(' › ')) : null),
    row('Marca', result.brand),
    row('Cor', result.color),
    row('Tamanho', result.size),
    row('ASIN', result.asin),
    row('EAN', result.ean),
    row('Avaliação', result.rating != null ? `${result.rating.toFixed(1)} ★ (${result.reviewCount ?? 0} avaliações)` : null),
    row('Comprado no último mês', result.monthlySold != null ? `${result.monthlySold.toLocaleString('pt-BR')}+` : null),
    row('Listado desde', result.listedSince ? yalcaFormatDate(result.listedSince.slice(0, 10)) : null),
    row('Dimensões do pacote', result.packageDimensionsCm ? `${result.packageDimensionsCm.length}×${result.packageDimensionsCm.width}×${result.packageDimensionsCm.height}cm` : null),
    row('Peso do pacote', result.packageWeightKg != null ? `${result.packageWeightKg}kg` : null),
    row('Variações', result.variationsCount ? `${result.variationsCount} (cor/tamanho)` : null),
    row('Taxa de devolução', result.returnRate ? (result.returnRate === 'alta' ? '⚠️ Alta' : 'Baixa') : null),
  ].filter(Boolean).join('');

  const rightRows = [
    row('Buy Box — vendedor', result.buybox ? yalcaEscapeHtml(result.buybox.seller) : 'nenhum vendedor no momento'),
    row('Buy Box — preço', result.buybox?.price != null ? yalcaFormatCurrency(result.buybox.price) : null),
    row('Preço riscado (desconto ativo)', stats.savingBasis != null ? `${yalcaFormatCurrency(stats.savingBasis)}${stats.savingPct != null ? ` (-${stats.savingPct}%)` : ''}` : null),
    row('Buy Box — média 90d', stats.avg90 != null ? yalcaFormatCurrency(stats.avg90) : null),
    row('Buy Box — menor já registrado', stats.lowestEver?.price != null ? `${yalcaFormatCurrency(stats.lowestEver.price)} em ${yalcaFormatDate(stats.lowestEver.date.slice(0, 10))}` : null),
    row('Buy Box — maior já registrado', stats.highestEver?.price != null ? `${yalcaFormatCurrency(stats.highestEver.price)} em ${yalcaFormatDate(stats.highestEver.date.slice(0, 10))}` : null),
    row('Vendedor mais barato FBA', cheapestByFulfillment(true)),
    row('Vendedor mais barato FBM', cheapestByFulfillment(false)),
    row('Contagem total de ofertas', (stats.totalOfferCount ?? result.offersCount) != null ? String(stats.totalOfferCount ?? result.offersCount) : null),
    row('Ofertas FBA / FBM', (stats.offerCountFBA != null || stats.offerCountFBM != null) ? `${stats.offerCountFBA ?? 0} / ${stats.offerCountFBM ?? 0}` : null),
    row('Fora de estoque (90d)', stats.outOfStockPct90 != null ? `${stats.outOfStockPct90}%` : null),
  ].filter(Boolean).join('');

  el.innerHTML = `
    <div class="keepa-detail-col">${leftRows}</div>
    <div class="keepa-detail-col">${rightRows}</div>`;
}

function renderKeepaBuyboxStatsTable(buyBoxStats, panelId, bodyId) {
  const panel = document.getElementById(panelId || 'keepaBuyboxStatsPanel');
  const tbody = document.getElementById(bodyId || 'keepaBuyboxStatsBody');
  if (!buyBoxStats || buyBoxStats.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  tbody.innerHTML = buyBoxStats.map(s => {
    const rep = s.sellerId ? KEEPA_SELLER_REPUTATION[s.sellerId] : null;
    const sellerLabel = rep && rep.sellerName
      ? `${yalcaEscapeHtml(rep.sellerName)}<br><span class="kpi-card__hint">${yalcaEscapeHtml(s.sellerId || '—')}</span>`
      : yalcaEscapeHtml(s.sellerId || '—');
    const tipoLabel = s.isFBA ? '<span class="badge badge--ativo">FBA</span>' : '<span class="badge badge--pausado">FBM</span>';
    return `
    <tr>
      <td data-label="Vendedor">${sellerLabel}</td>
      <td data-label="% de vezes" class="num">${s.percentageWon != null ? s.percentageWon + '%' : '—'}</td>
      <td data-label="Preço médio" class="num">${s.avgPrice != null ? yalcaFormatCurrency(s.avgPrice) : '—'}</td>
      <td data-label="Tipo">${tipoLabel}</td>
      <td data-label="Visto por último">${s.lastSeen ? yalcaFormatDate(s.lastSeen.slice(0, 10)) : '—'}</td>
    </tr>`;
  }).join('');
}

// Chamado sozinho a cada pesquisa nova — carrega a reputação dos
// KEEPA_AUTO_LOAD_SELLER_COUNT vendedores mais relevantes sem esperar
// clique nenhum. Vendedores além desse número (se houver) ficam pro botão
// manual. "Mais relevantes" = os das ofertas ativas (o que o cliente vê na
// hora de decidir comprar) PRIMEIRO, depois quem mais domina a buybox
// histórica (tabela "Quem domina a buybox") — sem essa segunda lista, só a
// tabela de ofertas ganhava nome de vendedor, e a de domínio de buybox
// ficava sempre só com o ID técnico.
async function autoLoadTopSellerReputation(offers, buyBoxStats) {
  const statusEl = document.getElementById('keepaOffersStatus');
  const btn = document.getElementById('keepaLoadSellerRepBtn');
  const offerSellerIds = offers.filter(o => o.sellerId && !o.isAmazon).map(o => o.sellerId);
  const buyBoxSellerIds = (buyBoxStats || []).filter(s => s.sellerId).map(s => s.sellerId);
  const allSellerIds = [...new Set([...offerSellerIds, ...buyBoxSellerIds])];

  if (allSellerIds.length === 0) {
    btn.style.display = 'none';
    statusEl.textContent = '';
    return;
  }
  btn.style.display = '';

  const priorityOrder = [...new Set([...offerSellerIds, ...buyBoxSellerIds])];
  const toAutoLoad = priorityOrder.filter(id => !KEEPA_SELLER_REPUTATION[id]).slice(0, KEEPA_AUTO_LOAD_SELLER_COUNT);
  if (toAutoLoad.length > 0) {
    statusEl.textContent = 'Carregando reputação dos vendedores...';
    await loadSellerReputation(toAutoLoad, offers);
  }

  updateSellerRepButtonState(allSellerIds);
}

// Ajusta o botão conforme quanto ainda falta carregar: some se já tem
// reputação de todo mundo, ou mostra quantos vendedores ainda faltam.
function updateSellerRepButtonState(allSellerIds) {
  const btn = document.getElementById('keepaLoadSellerRepBtn');
  const statusEl = document.getElementById('keepaOffersStatus');
  const missing = allSellerIds.filter(id => !KEEPA_SELLER_REPUTATION[id]);
  if (missing.length === 0) {
    btn.style.display = 'none';
    statusEl.textContent = '';
  } else {
    btn.style.display = '';
    btn.disabled = false;
    btn.textContent = `Ver reputação dos outros ${missing.length} vendedor${missing.length > 1 ? 'es' : ''}`;
    statusEl.textContent = '';
  }
}

function renderKeepaCategoryRanks(ranks, panelId, listId) {
  const panel = document.getElementById(panelId || 'keepaCategoryRanksPanel');
  const list = document.getElementById(listId || 'keepaCategoryRanksList');
  if (!ranks || ranks.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  list.innerHTML = ranks.map(r => `
    <div class="alert-item">
      <span class="alert-item__icon">${r.isPrimary ? '🏆' : '📊'}</span>
      <div><strong>#${r.rank.toLocaleString('pt-BR')} em ${yalcaEscapeHtml(r.categoryName)}</strong>${r.isPrimary ? '<span>categoria principal</span>' : ''}</div>
    </div>`).join('');
}

function renderKeepaOffersTable(offers, panelId, bodyId, withReputation) {
  const panel = document.getElementById(panelId || 'keepaOffersPanel');
  const tbody = document.getElementById(bodyId || 'keepaOffersBody');
  if (!offers || offers.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  tbody.innerHTML = offers.map(o => {
    const rep = o.sellerId ? KEEPA_SELLER_REPUTATION[o.sellerId] : null;
    const sellerLabel = o.isAmazon
      ? 'Amazon'
      : rep && rep.sellerName
        ? `${yalcaEscapeHtml(rep.sellerName)}<br><span class="kpi-card__hint">${yalcaEscapeHtml(o.sellerId || '—')}</span>`
        : yalcaEscapeHtml(o.sellerId || '—');
    const repLabel = rep
      ? (rep.currentRating != null
          ? `${rep.currentRating.toFixed(0)}% positiva · ${rep.currentRatingCount ?? 0} avaliações${rep.totalStorefrontAsins != null ? `<br><span class="kpi-card__hint">${rep.totalStorefrontAsins} produtos na loja</span>` : ''}`
          : '—')
      : (o.isAmazon ? '—' : '<span class="kpi-card__hint">não carregada</span>');
    const tipoLabel = [o.isFBA ? '<span class="badge badge--ativo">FBA</span>' : '<span class="badge badge--pausado">FBM</span>', o.isPrime ? 'Prime' : ''].filter(Boolean).join(' ');
    const priceLabel = o.price != null ? yalcaFormatCurrency(o.price) + (o.shipping ? ` + ${yalcaFormatCurrency(o.shipping)} frete` : '') : '—';
    const couponLabel = o.coupon ? `<br><span class="text-good" style="font-size:0.78rem;">cupom: ${o.coupon.type === 'percent' ? o.coupon.value + '%' : yalcaFormatCurrency(o.coupon.value)}</span>` : '';
    return `
    <tr>
      <td data-label="Vendedor">${sellerLabel}</td>
      <td data-label="Preço" class="num">${priceLabel}${couponLabel}</td>
      <td data-label="Condição">${yalcaEscapeHtml(o.condition || '—')}</td>
      <td data-label="Tipo">${tipoLabel}</td>
      <td data-label="Estoque" class="num">${o.stock != null ? o.stock : '—'}</td>
      ${withReputation ? `<td data-label="Reputação">${repLabel}</td>` : ''}
    </tr>`;
  }).join('');
}

// Função central: busca a reputação de uma lista específica de vendedores,
// mescla no mapa da sessão e re-renderiza a tabela. Usada tanto pelo
// carregamento automático dos top-N quanto pelo clique manual "ver os
// demais" — a diferença entre os dois é só QUAIS ids são passados.
async function loadSellerReputation(sellerIds, offers) {
  if (sellerIds.length === 0) return true;
  const statusEl = document.getElementById('keepaOffersStatus');
  try {
    const result = await yalcaKeepaSellerLookup(sellerIds);
    if (!result.ok) {
      statusEl.textContent = result.message || 'Não foi possível buscar a reputação agora.';
      return false;
    }
    Object.assign(KEEPA_SELLER_REPUTATION, result.sellers);
    renderKeepaOffersTable(offers);
    renderKeepaBuyboxStatsTable(LAST_KEEPA_SEARCH_RESULT?.stats?.buyBoxStats || []);
    return true;
  } catch (err) {
    statusEl.textContent = 'Não foi possível buscar agora: ' + err.message;
    return false;
  }
}

async function handleLoadSellerReputation() {
  const offers = LAST_KEEPA_SEARCH_RESULT?.offers || [];
  const buyBoxStats = LAST_KEEPA_SEARCH_RESULT?.stats?.buyBoxStats || [];
  const btn = document.getElementById('keepaLoadSellerRepBtn');
  const allSellerIds = [...new Set([
    ...offers.filter(o => o.sellerId && !o.isAmazon).map(o => o.sellerId),
    ...buyBoxStats.filter(s => s.sellerId).map(s => s.sellerId)
  ])];
  const missing = allSellerIds.filter(id => !KEEPA_SELLER_REPUTATION[id]);
  if (missing.length === 0) return;

  btn.disabled = true;
  btn.textContent = 'Buscando...';
  const ok = await loadSellerReputation(missing, offers);
  if (!ok) { btn.disabled = false; btn.textContent = `Ver reputação dos outros ${missing.length} vendedor${missing.length > 1 ? 'es' : ''}`; return; }
  updateSellerRepButtonState(allSellerIds);
}

function yalcaKeepaMinutesLabel(minutes) {
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

/* ---------- Ponte com a Calculadora de Preço ---------- */
function useKeepaResultInPricingCalculator() {
  if (!LAST_KEEPA_SEARCH_RESULT) return;
  const price = LAST_KEEPA_SEARCH_RESULT.buybox?.price ?? LAST_KEEPA_SEARCH_RESULT.currentPrice;
  if (price == null) {
    alert('Esse produto não tem preço disponível pra usar na calculadora.');
    return;
  }
  document.getElementById('pManualPrice').value = price;
  document.querySelector('.portal-nav__item[data-section="precificacao"]').click();
  selectVariantForDetail('amazon_fba');
  recalcPricing();
}
