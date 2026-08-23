/* =========================================
   Yalca Portal — página "Calculadora de Preço" (standalone)
   Cada variante tem "brackets": faixas de preço com comissão (%)
   e taxa fixa PRÓPRIAS de cada faixa — modelo necessário porque
   marketplaces reais (ex: TikTok Shop) cobram % diferente conforme
   o preço, não só uma taxa fixa adicional.

   Fontes: páginas oficiais dos vendedores quando acessíveis
   (venda.amazon.com.br/precos foi possível abrir direto). Onde o
   acesso automático foi bloqueado (Mercado Livre bloqueia todo
   acesso automatizado; Shopee e TikTok carregam a Central do
   Vendedor via login/JavaScript; Temu é só por convite), usamos a
   melhor fonte especializada disponível e marcamos "verified: false"
   — visível no editor de taxas com um aviso e link para conferir na
   fonte oficial. Revisado em 21/07/2026.
   ========================================= */

const PRICING_VARIANTS_DEFAULT = [
  {
    key: 'ml_classico', label: 'Mercado Livre — Clássico', channel: 'Mercado Livre', planLabel: 'Clássico',
    brackets: [
      { maxPrice: 20, pct: 12.5, fixedFee: 5.50 },
      { maxPrice: 78.99, pct: 12.5, fixedFee: 6.00 },
      { maxPrice: Infinity, pct: 12.5, fixedFee: 0 }
    ],
    sourceUrl: 'https://www.mercadolivre.com.br/ajuda/quanto-custa-vender-um-produto_1338',
    verified: false,
    note: 'Comissão típica de 11% a 14% por categoria (usamos 12,5% de média). Itens até R$20 pagam R$5,50 de taxa fixa por unidade; de R$20,01 a R$78,99, R$6,00; acima de R$79, sem taxa fixa. O Mercado Livre bloqueia acesso automático à própria página de ajuda, então não conseguimos confirmar ao vivo — confirme a % exata da sua categoria na Central do Vendedor.'
  },
  {
    key: 'ml_premium', label: 'Mercado Livre — Premium', channel: 'Mercado Livre', planLabel: 'Premium',
    brackets: [
      { maxPrice: 20, pct: 17.5, fixedFee: 5.50 },
      { maxPrice: 78.99, pct: 17.5, fixedFee: 6.00 },
      { maxPrice: Infinity, pct: 17.5, fixedFee: 0 }
    ],
    sourceUrl: 'https://www.mercadolivre.com.br/ajuda/quanto-custa-vender-um-produto_1338',
    verified: false,
    note: 'Comissão típica de 16% a 19% por categoria (usamos 17,5% de média) — mais alta que o Clássico, mas com parcelamento sem juros ao comprador. Mesmas faixas de taxa fixa do Clássico. Confirme a % exata da sua categoria na Central do Vendedor.'
  },
  {
    key: 'amazon_fbm', label: 'Amazon — FBM (frete próprio)', channel: 'Amazon', planLabel: 'FBM (frete próprio)',
    brackets: [{ maxPrice: Infinity, pct: 13, fixedFee: 0 }],
    sourceUrl: 'https://venda.amazon.com.br/precos',
    verified: true,
    note: 'Comissão por categoria de 10% a 15% (ex: alimentos 10%, saúde 12%, roupas/joias 14%, eletrônicos/livros 13-15%) — usamos 13% de média. Existe comissão mínima de R$1 a R$2 por venda (só pesa em produtos muito baratos, não incluída no cálculo). Some seu frete real no campo "Frete" acima. Também há mensalidade do plano de venda: Profissional é grátis no 1º ano e depois R$19/mês, ou R$2,00 por unidade no plano Individual sem mensalidade — não incluída aqui.'
  },
  {
    key: 'amazon_fba', label: 'Amazon — FBA (logística Amazon)', channel: 'Amazon', planLabel: 'FBA (logística Amazon)',
    brackets: [
      { maxPrice: 29.99, pct: 13, fixedFee: 10.05 },
      { maxPrice: 49.99, pct: 13, fixedFee: 12.05 },
      { maxPrice: 78.99, pct: 13, fixedFee: 14.05 },
      { maxPrice: 99.99, pct: 13, fixedFee: 15.05 },
      { maxPrice: Infinity, pct: 13, fixedFee: 15.55 }
    ],
    sourceUrl: 'https://venda.amazon.com.br/precos',
    verified: true,
    note: 'Mesma comissão por categoria do FBM (13% de média) + taxa de logística FBA para produtos leves (até 100g): R$10,05 até R$29,99; R$12,05 de R$30 a R$49,99; R$14,05 de R$50 a R$78,99; R$15,05 de R$79 a R$99,99; R$15,55 acima de R$100 (a taxa NÃO zera acima de R$100 — corrigimos isso aqui). Produtos mais pesados pagam mais: use a calculadora oficial de FBA da Amazon para o valor exato do seu produto. Não inclui taxa de armazenagem mensal.'
  },
  {
    key: 'shopee', label: 'Shopee', channel: 'Shopee', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 14, fixedFee: 4.00 }],
    sourceUrl: 'https://seller.shopee.com.br/edu/article/18483/como-funciona-a-politica-de-comissao-para-vendedores-shopee',
    verified: false,
    note: 'A Central do Vendedor da Shopee exige login e carrega por JavaScript — não conseguimos confirmar a comissão exata direto na página oficial. Fontes especializadas citam ~14% + taxa fixa que cresce com o preço (usamos R$4 como referência). Vendedores CPF com mais de 450 pedidos em 90 dias pagam +R$3,00 por item. Confirme no seu painel.'
  },
  {
    key: 'tiktok', label: 'TikTok Shop', channel: 'TikTok', planLabel: '',
    brackets: [
      { maxPrice: 49.99, pct: 10, fixedFee: 0 },
      { maxPrice: Infinity, pct: 6, fixedFee: 6.00 }
    ],
    sourceUrl: 'https://seller-br.tiktok.com/',
    verified: false,
    note: 'Mudança de 15/07/2026: produtos abaixo de R$50 pagam 10% de comissão; a partir de R$50, 6% + R$6,00 de taxa fixa por item (subiu de R$4,00). Novos vendedores ficam isentos de comissão por 60 dias. Não conseguimos abrir a Central do Vendedor diretamente (login/JavaScript) — dado de fonte especializada que cita o painel oficial. Confirme no seu painel.'
  },
  {
    key: 'temu', label: 'Temu', channel: 'Temu', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 16, fixedFee: 0 }],
    sourceUrl: 'https://seller.temu.com',
    verified: false,
    note: 'O painel de vendedor da Temu é só por convite e não tem página pública de taxas. Fontes especializadas citam isenção de comissão nos primeiros 30 dias e 16% depois. Ajuste conforme o combinado no seu cadastro.'
  },
  {
    key: 'droga_raia', label: 'Droga Raia', channel: 'Droga Raia', planLabel: '',
    brackets: [{ maxPrice: Infinity, pct: 0, fixedFee: 0 }],
    sourceUrl: null,
    verified: false,
    note: 'Não é um marketplace de comissão padrão como os demais — não existe uma "taxa oficial" pública. Ajuste aqui a % ou taxa fixa do seu acordo comercial (revenda, consignação, marketplace de parceiros etc).'
  }
];

let PRICING_VARIANTS = [];
let FOCUSED_VARIANT_KEY = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;

  const prodMarketplaceSel = document.getElementById('prodMarketplace');
  MARKETPLACES.forEach(mk => {
    const opt = document.createElement('option');
    opt.value = mk;
    opt.textContent = mk;
    prodMarketplaceSel.appendChild(opt);
  });

  document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const record = {
      sku: document.getElementById('prodSku').value,
      name: document.getElementById('prodName').value,
      marketplace: document.getElementById('prodMarketplace').value,
      category: document.getElementById('prodCategory').value,
      cost: parseFloat(document.getElementById('prodCost').value) || 0,
      price: parseFloat(document.getElementById('prodPrice').value) || 0,
      stock: parseInt(document.getElementById('prodStock').value, 10) || 0,
      minStock: parseInt(document.getElementById('prodMinStock').value, 10) || 0,
      unitsSoldMonth: parseInt(document.getElementById('prodSoldMonth').value, 10) || 0,
      status: document.getElementById('prodStatus').value
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      await yalcaAddProduct(record);
      closeModal('productModal');
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
    } catch (err) {
      alert('Não foi possível salvar o produto: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });

  initPricingCalculator();
});

function clonePricingVariants() {
  return PRICING_VARIANTS_DEFAULT.map(v => ({ ...v, brackets: v.brackets.map(b => ({ ...b })) }));
}

function pricingBracketRangeLabel(brackets, index) {
  const min = index === 0 ? 0 : brackets[index - 1].maxPrice;
  const b = brackets[index];
  if (b.maxPrice === Infinity) return `Acima de ${yalcaFormatCurrency(min)}`;
  return index === 0 ? `Até ${yalcaFormatCurrency(b.maxPrice)}` : `${yalcaFormatCurrency(min)} a ${yalcaFormatCurrency(b.maxPrice)}`;
}

function initPricingCalculator() {
  PRICING_VARIANTS = clonePricingVariants();

  ['pCost', 'pShipping', 'pTax', 'pMargin', 'pManualPrice'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcPricing);
  });

  document.getElementById('toggleFeeEditor').addEventListener('click', (e) => {
    const editor = document.getElementById('feeEditor');
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    e.target.textContent = showing ? '⚙ Ajustar taxas dos marketplaces' : '⚙ Ocultar ajuste de taxas';
  });

  document.getElementById('pricingComparisonBody').addEventListener('click', (e) => {
    const saveBtn = e.target.closest('[data-action="openSaveAsProduct"]');
    if (saveBtn) {
      openSaveAsProduct(saveBtn.dataset.channel, parseFloat(saveBtn.dataset.price), parseFloat(saveBtn.dataset.cost));
      return;
    }
    const row = e.target.closest('[data-action="selectVariantForDetail"]');
    if (row) selectVariantForDetail(row.dataset.key);
  });

  renderFeeEditor();

  // Chegada vinda do "Usar este preço na Calculadora de Preço" do Keepa
  // (keepa.html) — veio de sessionStorage porque são páginas separadas.
  const savedPrice = sessionStorage.getItem('yalcaPricingManualPrice');
  if (savedPrice) {
    document.getElementById('pManualPrice').value = savedPrice;
    sessionStorage.removeItem('yalcaPricingManualPrice');
    const savedVariant = sessionStorage.getItem('yalcaPricingFocusVariant');
    if (savedVariant) {
      FOCUSED_VARIANT_KEY = savedVariant;
      sessionStorage.removeItem('yalcaPricingFocusVariant');
    }
  }

  recalcPricing();
}

function renderFeeEditor() {
  const editor = document.getElementById('feeEditor');
  editor.innerHTML = PRICING_VARIANTS.map(v => {
    const bracketInputs = v.brackets.map((b, i) => `
      <div><label>${pricingBracketRangeLabel(v.brackets, i)} — comissão (%)</label><input type="number" min="0" step="0.1" value="${b.pct}" data-field="pct" data-bracket-index="${i}"></div>
      <div><label>Taxa fixa nessa faixa (R$)</label><input type="number" min="0" step="0.01" value="${b.fixedFee || 0}" data-field="fixedFee" data-bracket-index="${i}"></div>
    `).join('');
    const sourceHtml = v.sourceUrl
      ? `<a href="${v.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent); font-size:0.76rem; display:inline-block; margin-top:6px;">Ver fonte oficial ↗</a>`
      : '';
    const verifiedBadge = v.verified
      ? '<span class="badge badge--ativo">✔ Confirmado na fonte oficial</span>'
      : '<span class="badge badge--pending">⚠ Não confirmado ao vivo</span>';
    return `
    <div class="fee-editor-row" data-key="${v.key}">
      <div class="fee-editor-row__title">${yalcaEscapeHtml(v.channel)}${v.planLabel ? ' — ' + yalcaEscapeHtml(v.planLabel) : ''} ${verifiedBadge}</div>
      <div class="fee-editor-row__fields">${bracketInputs}</div>
      <div class="fee-editor-row__note">${yalcaEscapeHtml(v.note)}${sourceHtml}</div>
    </div>`;
  }).join('') + `<button type="button" class="table-view-toggle" id="resetFeeEditor">Restaurar valores padrão</button>`;

  editor.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.closest('.fee-editor-row').dataset.key;
      const variant = PRICING_VARIANTS.find(v => v.key === key);
      const idx = Number(input.dataset.bracketIndex);
      const field = input.dataset.field;
      variant.brackets[idx][field] = parseFloat(input.value) || 0;
      recalcPricing();
    });
  });

  document.getElementById('resetFeeEditor').addEventListener('click', () => {
    PRICING_VARIANTS = clonePricingVariants();
    renderFeeEditor();
    recalcPricing();
  });
}

function getBracketFor(variant, price) {
  return variant.brackets.find(b => price <= b.maxPrice) || variant.brackets[variant.brackets.length - 1];
}

function feeForPrice(variant, price) {
  const b = getBracketFor(variant, price);
  return price * (b.pct / 100) + (b.fixedFee || 0);
}

function solveForwardPrice(variant, cost, shipping, tax, marginDesired) {
  let prevMax = 0;
  for (const b of variant.brackets) {
    const denom = 1 - (b.pct + tax + marginDesired) / 100;
    if (denom > 0) {
      const price = (cost + shipping + (b.fixedFee || 0)) / denom;
      if (price > prevMax && price <= b.maxPrice) return price;
    }
    prevMax = b.maxPrice;
  }
  // Nenhuma faixa foi auto-consistente (raro) — usa a última faixa como aproximação.
  const last = variant.brackets[variant.brackets.length - 1];
  const denom = 1 - (last.pct + tax + marginDesired) / 100;
  if (denom <= 0) return null;
  return (cost + shipping + (last.fixedFee || 0)) / denom;
}

function calcPricingVariant(variant, inputs) {
  const { cost, shipping, tax, marginDesired, manualPrice } = inputs;

  const computeBreakdown = (price) => {
    const feeValue = feeForPrice(variant, price);
    const taxValue = price * (tax / 100);
    const netProfit = price - cost - shipping - feeValue - taxValue;
    const marginPct = price > 0 ? (netProfit / price) * 100 : 0;
    return {
      key: variant.key, label: variant.label, channel: variant.channel, planLabel: variant.planLabel,
      verified: variant.verified, sourceUrl: variant.sourceUrl,
      price, feeValue, taxValue, netProfit, marginPct
    };
  };

  if (manualPrice !== null && manualPrice > 0) {
    return { mode: 'reverse', ...computeBreakdown(manualPrice) };
  }

  const price = solveForwardPrice(variant, cost, shipping, tax, marginDesired);
  if (price === null) return { mode: 'invalid', key: variant.key, label: variant.label };
  return { mode: 'forward', ...computeBreakdown(price) };
}

function recalcPricing() {
  const comparisonBody = document.getElementById('pricingComparisonBody');
  if (!comparisonBody) return;

  const cost = parseFloat(document.getElementById('pCost').value) || 0;
  const shipping = parseFloat(document.getElementById('pShipping').value) || 0;
  const tax = parseFloat(document.getElementById('pTax').value) || 0;
  const marginDesired = parseFloat(document.getElementById('pMargin').value) || 0;
  const manualPriceRaw = document.getElementById('pManualPrice').value;
  const manualPrice = manualPriceRaw !== '' ? parseFloat(manualPriceRaw) : null;

  const inputs = { cost, shipping, tax, marginDesired, manualPrice };
  const results = PRICING_VARIANTS.map(v => calcPricingVariant(v, inputs));
  const validResults = results.filter(r => r.mode !== 'invalid');

  if (validResults.length === 0) {
    comparisonBody.innerHTML = '<tr><td colspan="5" class="alert-empty" style="color:var(--critical);">A soma de taxa, imposto e margem desejada ultrapassa 100% em todas as opções. Reduza algum valor.</td></tr>';
    document.getElementById('pricingWaterfall').innerHTML = '';
    document.getElementById('pricingBreakdown').innerHTML = '';
    return;
  }

  const bestMarginValue = Math.max(...validResults.map(r => r.marginPct));
  const bestKeyOnBestMargin = validResults.find(r => r.marginPct === bestMarginValue)?.key;
  const sorted = [...validResults].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  if (!FOCUSED_VARIANT_KEY || !validResults.some(r => r.key === FOCUSED_VARIANT_KEY)) {
    FOCUSED_VARIANT_KEY = bestKeyOnBestMargin;
  }

  comparisonBody.innerHTML = sorted.map(r => {
    const isBest = r.key === bestKeyOnBestMargin;
    const isSelected = r.key === FOCUSED_VARIANT_KEY;
    const marginClass = r.marginPct < 0 ? 'text-critical' : (r.marginPct < 15 ? '' : 'text-good');
    return `
    <tr class="${isSelected ? 'comparison-row--selected' : ''}" style="cursor:pointer;" data-action="selectVariantForDetail" data-key="${r.key}">
      <td>
        <div class="marketplace-cell">
          ${renderChannelBadge(r.channel)}
          <div class="marketplace-cell__text">
            <strong>${yalcaEscapeHtml(r.channel)}${!r.verified ? ' <span title="Taxa não confirmada ao vivo na fonte oficial — veja a nota em Ajustar taxas" style="color:var(--warning); cursor:help;">⚠</span>' : ''}</strong>
            ${r.planLabel ? `<span class="marketplace-cell__plan">${yalcaEscapeHtml(r.planLabel)}</span>` : ''}
            ${isBest ? '<span class="best-tag">Melhor margem</span>' : ''}
          </div>
        </div>
      </td>
      <td class="num">${yalcaFormatCurrency(r.price)}</td>
      <td class="num ${r.netProfit < 0 ? 'text-critical' : ''}">${yalcaFormatCurrency(r.netProfit)}</td>
      <td class="num ${marginClass}">${r.marginPct.toFixed(1)}%</td>
      <td class="row-actions">
        <button class="icon-btn" title="Salvar como produto" data-action="openSaveAsProduct" data-channel="${yalcaEscapeHtml(r.channel)}" data-price="${r.price.toFixed(2)}" data-cost="${cost}">＋</button>
      </td>
    </tr>`;
  }).join('');

  renderPricingDetail(results.find(r => r.key === FOCUSED_VARIANT_KEY), inputs);
}

function selectVariantForDetail(key) {
  FOCUSED_VARIANT_KEY = key;
  recalcPricing();
}

function renderPricingDetail(result, inputs) {
  document.getElementById('pricingDetailTitle').textContent = `Detalhamento — ${result.label}`;

  if (result.mode === 'invalid') {
    document.getElementById('pricingDetailConfidence').innerHTML = '';
    document.getElementById('pricingWaterfall').innerHTML = '<p class="alert-empty" style="color:var(--critical);">Configuração impossível para esta opção (taxa + imposto + margem desejada ultrapassa 100%).</p>';
    document.getElementById('pricingBreakdown').innerHTML = '';
    return;
  }

  const confidenceHtml = result.verified
    ? '<span class="badge badge--ativo">✔ Confirmado na fonte oficial</span>'
    : `<span class="badge badge--pending">⚠ Não confirmado ao vivo na fonte oficial</span>${result.sourceUrl ? ` <a href="${result.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent); font-size:0.8rem;">conferir fonte ↗</a>` : ''}`;
  document.getElementById('pricingDetailConfidence').innerHTML = confidenceHtml;

  const segments = [
    { label: 'Custo do produto', value: inputs.cost, color: YALCA_WATERFALL_COLORS.custo },
    { label: 'Frete', value: inputs.shipping, color: YALCA_WATERFALL_COLORS.frete },
    { label: 'Taxa do marketplace', value: result.feeValue, color: YALCA_WATERFALL_COLORS.taxa },
    { label: 'Imposto', value: result.taxValue, color: YALCA_WATERFALL_COLORS.imposto },
    { label: 'Lucro líquido', value: Math.max(result.netProfit, 0), color: YALCA_WATERFALL_COLORS.lucro }
  ];
  yalcaRenderWaterfallBar(document.getElementById('pricingWaterfall'), {
    segments,
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  const gaugeColor = result.marginPct < 0 ? 'var(--critical)' : (result.marginPct < 15 ? 'var(--warning)' : 'var(--good)');
  document.getElementById('pricingBreakdown').innerHTML = `
    <div class="calc-result__row"><span>Custo do produto</span><strong>${yalcaFormatCurrency(inputs.cost)}</strong></div>
    <div class="calc-result__row"><span>Frete</span><strong>${yalcaFormatCurrency(inputs.shipping)}</strong></div>
    <div class="calc-result__row"><span>Taxa do marketplace</span><strong>${yalcaFormatCurrency(result.feeValue)}</strong></div>
    <div class="calc-result__row"><span>Imposto</span><strong>${yalcaFormatCurrency(result.taxValue)}</strong></div>
    <div class="calc-result__row"><span>Lucro líquido</span><strong style="color:${gaugeColor};">${yalcaFormatCurrency(result.netProfit)}</strong></div>
    <div class="calc-result__row total"><span>Preço de venda${result.mode === 'reverse' ? ' (informado)' : ' sugerido'}</span><strong>${yalcaFormatCurrency(result.price)}</strong></div>
    <div class="calc-result__row"><span>Margem líquida</span><strong style="color:${gaugeColor};">${result.marginPct.toFixed(1)}%</strong></div>`;
}

function openSaveAsProduct(marketplace, price, cost) {
  document.getElementById('productForm').reset();
  document.getElementById('prodId').value = '';
  document.getElementById('productModalTitle').textContent = 'Novo produto (da calculadora)';
  document.getElementById('prodMarketplace').value = marketplace;
  document.getElementById('prodCost').value = cost;
  document.getElementById('prodPrice').value = price;
  document.getElementById('prodStatus').value = 'Ativo';
  openModal('productModal');
}
