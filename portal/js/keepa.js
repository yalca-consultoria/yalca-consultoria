/* =========================================
   Yalca Portal — Compras & Concorrência (Keepa)
   Biblioteca pura (sem DOMContentLoaded próprio) — consumida pelo
   único ponto de inicialização em portal-app.js, mesmo padrão de
   charts.js.
   ========================================= */

let KEEPA_DATA = { tracked: [], cache: {}, alerts: [] };
let LAST_KEEPA_SEARCH_RESULT = null;
// Reputação de vendedor já buscada nesta sessão — mantida entre pesquisas
// (um vendedor já visto fica "de graça" o resto da sessão). O cache de
// verdade é no servidor (keepa_seller_cache); isso aqui só evita uma
// chamada redundante se o cliente pesquisar o mesmo produto duas vezes.
let KEEPA_SELLER_REPUTATION = {};

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
    const btn = e.target.closest('[data-action="deleteTrackedAsin"]');
    if (btn) handleDeleteTrackedAsin(btn.dataset.id);
  });

  document.getElementById('keepaSearchForm').addEventListener('submit', handleKeepaSearchSubmit);

  document.getElementById('keepaUseInPricingBtn').addEventListener('click', useKeepaResultInPricingCalculator);

  document.getElementById('keepaLoadSellerRepBtn').addEventListener('click', handleLoadSellerReputation);
}

/* ---------- Carregamento ---------- */
async function reloadKeepaData() {
  const tracked = await yalcaFetchTrackedAsins();
  const asins = [...new Set(tracked.map(t => t.asin))];
  const [cacheRows, alerts] = await Promise.all([
    yalcaFetchKeepaCache(asins),
    yalcaFetchKeepaAlerts(asins, 10)
  ]);
  const cacheByAsin = Object.fromEntries(cacheRows.map(c => [c.asin, c]));
  KEEPA_DATA = { tracked, cache: cacheByAsin, alerts };
}

/* ---------- "Meus Anúncios" ---------- */
function renderKeepaTracked() {
  const tbody = document.getElementById('keepaTrackedBody');
  if (!tbody) return;
  if (KEEPA_DATA.tracked.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="alert-empty">Nenhum ASIN monitorado ainda. Adicione um acima pra começar.</td></tr>';
    return;
  }
  tbody.innerHTML = KEEPA_DATA.tracked.map(t => {
    const c = KEEPA_DATA.cache[t.asin];
    const priceLabel = c && c.current_price != null ? yalcaFormatCurrency(c.current_price) : '—';
    const bsrLabel = c && c.bsr != null ? c.bsr.toLocaleString('pt-BR') : '—';
    const isOwnBuybox = c && c.buybox_seller && t.own_seller_name && c.buybox_seller === t.own_seller_name;
    const buyboxLabel = c && c.buybox_seller
      ? (isOwnBuybox ? '<span class="badge badge--ativo">Você</span>' : yalcaEscapeHtml(c.buybox_seller))
      : (c ? '<span class="text-muted-num">ninguém</span>' : '—');
    const ratingLabel = c && c.rating != null ? `${c.rating.toFixed(1)} ★ (${c.review_count ?? 0})` : '—';
    const ageLabel = c && c.cheap_data_updated_at
      ? `atualizado ${yalcaKeepaRelativeAge(c.cheap_data_updated_at)}`
      : 'aguardando primeira atualização';
    return `
    <tr>
      <td data-label="ASIN">${yalcaEscapeHtml(t.asin)}</td>
      <td data-label="Apelido">${yalcaEscapeHtml(t.label || '—')}</td>
      <td data-label="Preço">${priceLabel}</td>
      <td data-label="BSR" class="num">${bsrLabel}</td>
      <td data-label="Buybox">${buyboxLabel}</td>
      <td data-label="Avaliação">${ratingLabel}</td>
      <td class="row-actions">
        <span class="kpi-card__hint" style="margin-right:8px;">${ageLabel}</span>
        <button class="icon-btn" title="Parar de monitorar" data-action="deleteTrackedAsin" data-id="${t.id}">🗑</button>
      </td>
    </tr>`;
  }).join('');
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

/* ---------- "Pesquisar Produto" ---------- */
async function handleKeepaSearchSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('keepaSearchAsin');
  const statusEl = document.getElementById('keepaSearchStatus');
  const asin = input.value.trim().toUpperCase();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    statusEl.textContent = 'ASIN inválido — deve ter 10 letras/números (ex: B0EXAMPLE1).';
    statusEl.style.color = 'var(--critical)';
    return;
  }

  statusEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Pesquisando...';
  document.getElementById('keepaSearchResultPanel').style.display = 'none';

  try {
    const result = await yalcaKeepaSearch(asin);
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
  const sourceLabel = result.source === 'cache' ? 'dado em cache' : 'consulta ao vivo';
  document.getElementById('keepaResultConfidence').textContent =
    `${sourceLabel} · atualizado ${result.cheapDataAgeMinutes != null ? yalcaKeepaMinutesLabel(result.cheapDataAgeMinutes) : 'agora'}`;

  const rotationHint = result.buyboxRotation90d != null
    ? (result.buyboxRotation90d === 0 ? 'buybox estável nos últimos 90 dias' : `trocou de dono ${result.buyboxRotation90d}x nos últimos 90 dias`)
    : null;
  const buyboxKpi = result.buybox
    ? { label: 'Buybox', value: yalcaEscapeHtml(result.buybox.seller), hint: result.buybox.isAmazon ? 'é a própria Amazon' : rotationHint, delta: null }
    : { label: 'Buybox', value: '—', hint: 'ninguém está vendendo agora', delta: null };

  const kpis = [
    { label: 'Preço da buybox', value: result.buybox?.price != null ? yalcaFormatCurrency(result.buybox.price) : (result.currentPrice != null ? yalcaFormatCurrency(result.currentPrice) : '—'), delta: null },
    buyboxKpi,
    { label: 'BSR (ranking)', value: result.bsr != null ? result.bsr.toLocaleString('pt-BR') : '—', delta: null, hint: 'quanto menor, mais vende' },
    { label: 'Avaliação', value: result.rating != null ? `${result.rating.toFixed(1)} ★` : '—', delta: null, hint: result.reviewCount != null ? `${result.reviewCount} avaliações` : null },
    { label: 'Ofertas ativas', value: result.offersCount != null ? result.offersCount : '—', delta: null, hint: result.availabilityStatus || null },
    { label: 'Vendas estimadas/mês', value: result.monthlySold != null ? result.monthlySold.toLocaleString('pt-BR') : '—', delta: null, hint: result.monthlySold != null ? 'dado direto da Amazon' : 'maioria dos produtos não tem esse dado' },
    { label: 'Taxa de referência', value: result.referralFeePct != null ? `${result.referralFeePct.toFixed(1)}%` : '—', delta: null, hint: 'comissão real da Amazon nesse produto' },
    { label: 'Taxa FBA (fulfillment)', value: result.fbaFeeTotal != null ? yalcaFormatCurrency(result.fbaFeeTotal) : '—', delta: null, hint: 'coleta + embalagem + armazenagem' },
  ];
  renderKpiGrid('keepaResultKpis', kpis);

  const chartContainer = document.getElementById('keepaPriceHistoryChart');
  if (result.priceHistory && result.priceHistory.length > 1) {
    yalcaRenderLineChart(chartContainer, {
      series: [{ name: 'Preço', color: YALCA_COLORS.series1, data: result.priceHistory.map(p => ({ label: yalcaFormatDate(p.date.slice(0, 10)), value: p.value })) }],
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  } else {
    chartContainer.innerHTML = '<p class="alert-empty">Sem histórico de preço suficiente pra mostrar o gráfico ainda.</p>';
  }

  renderKeepaCategoryRanks(result.categoryRanks || []);
  renderKeepaOffersTable(result.offers || []);

  // produto novo na tela: os vendedores dele provavelmente ainda não têm
  // reputação carregada nesta sessão — devolve o botão pro estado inicial.
  const repBtn = document.getElementById('keepaLoadSellerRepBtn');
  repBtn.disabled = false;
  repBtn.textContent = 'Ver reputação dos vendedores';
  document.getElementById('keepaOffersStatus').textContent = '';
}

function renderKeepaCategoryRanks(ranks) {
  const panel = document.getElementById('keepaCategoryRanksPanel');
  const list = document.getElementById('keepaCategoryRanksList');
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

function renderKeepaOffersTable(offers) {
  const panel = document.getElementById('keepaOffersPanel');
  const tbody = document.getElementById('keepaOffersBody');
  if (!offers || offers.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  tbody.innerHTML = offers.map(o => {
    const rep = o.sellerId ? KEEPA_SELLER_REPUTATION[o.sellerId] : null;
    const sellerLabel = o.isAmazon ? 'Amazon' : yalcaEscapeHtml(o.sellerId || '—');
    const repLabel = rep
      ? `${rep.sellerName ? yalcaEscapeHtml(rep.sellerName) : '—'}${rep.currentRating != null ? ` · ${rep.currentRating.toFixed(0)}% (${rep.currentRatingCount ?? 0})` : ''}`
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
      <td data-label="Reputação">${repLabel}</td>
    </tr>`;
  }).join('');
}

async function handleLoadSellerReputation() {
  const offers = LAST_KEEPA_SEARCH_RESULT?.offers || [];
  const statusEl = document.getElementById('keepaOffersStatus');
  const btn = document.getElementById('keepaLoadSellerRepBtn');

  const sellerIds = [...new Set(offers.filter(o => o.sellerId && !o.isAmazon).map(o => o.sellerId))];
  if (sellerIds.length === 0) {
    statusEl.textContent = 'Nenhum vendedor pra consultar.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Buscando...';
  statusEl.textContent = '';
  try {
    const result = await yalcaKeepaSellerLookup(sellerIds);
    if (!result.ok) {
      statusEl.textContent = result.message || 'Não foi possível buscar a reputação agora.';
      btn.disabled = false;
      btn.textContent = 'Ver reputação dos vendedores';
      return;
    }
    Object.assign(KEEPA_SELLER_REPUTATION, result.sellers);
    renderKeepaOffersTable(offers);
    btn.textContent = 'Reputação carregada ✓';
    btn.disabled = true;
  } catch (err) {
    statusEl.textContent = 'Não foi possível buscar agora: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Ver reputação dos vendedores';
  }
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
