/* =========================================
   Yalca Portal — gráficos (SVG, sem dependências)
   Regras seguidas: uma cor fixa por série (nunca
   por posição), grid discreto, legenda sempre visível
   com 2+ séries, tooltip no hover, alternância para
   tabela (acessibilidade), sem eixo duplo.
   ========================================= */

/* Cores fixas por entidade (nunca por posição/ordem de filtro).
   Usadas como atributo direto no SVG (fill/stroke), por isso em hex —
   var(--x) em atributo de apresentação SVG não é suportado de forma
   confiável em todos os navegadores/WebViews. */
const YALCA_COLORS = {
  series1: '#3987e5', // azul — receita
  series2: '#d95926', // laranja — despesa/custo
  series3: '#199e70', // verde-água — lucro/saldo
  series4: '#c98500', // amarelo
  series5: '#d55181', // magenta
  series6: '#9085e9', // violeta
  grid: '#24304d'
};

const YALCA_MARKETPLACE_COLOR = {
  'Mercado Livre': YALCA_COLORS.series1,
  'Amazon': YALCA_COLORS.series2,
  'Shopee': YALCA_COLORS.series3,
  'TikTok': YALCA_COLORS.series4,
  'Temu': YALCA_COLORS.series5,
  'Droga Raia': YALCA_COLORS.series6
};

/* Cores fixas para os segmentos do gráfico de composição do preço
   (sempre nesta ordem: custo, frete, taxa, imposto, lucro). */
const YALCA_WATERFALL_COLORS = {
  custo: YALCA_COLORS.series2,
  frete: YALCA_COLORS.series4,
  taxa: YALCA_COLORS.series5,
  imposto: YALCA_COLORS.series1,
  lucro: '#0ca30c'
};

function yalcaEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

/* Trunca o rótulo pra caber na largura da barra sem colidir com o vizinho
   (ex: "Fornecedor" e "Taxa de Marketplace" grudados quando há muitas
   categorias). Estimativa de ~6.2px por caractere em fonte 13px — grosseira
   de propósito (SVG não tem measureText síncrono sem canvas extra), só
   precisa evitar overflow visível; o nome completo continua no tooltip. */
function yalcaTruncateLabel(label, maxWidthPx) {
  const CHAR_WIDTH = 6.2;
  const maxChars = Math.max(3, Math.floor(maxWidthPx / CHAR_WIDTH));
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars - 1).trimEnd() + '…';
}

// Largura reservada à esquerda do gráfico pros rótulos do eixo Y (valores
// formatados, ex: "R$ 20.000,00"). Calculada a partir do MAIOR valor que
// vai aparecer (niceMax — o topo da escala sempre tem o rótulo mais largo
// num eixo crescente), não de um valor fixo — sem isso, valores grandes
// eram cortados/vazavam pra fora do card em telas estreitas.
function yalcaAxisLeftPad(niceMax, steps, formatValue) {
  const CHAR_WIDTH = 6.2; // mesma estimativa de yalcaTruncateLabel, fonte 13px
  const widest = String(formatValue(niceMax)).length;
  return Math.max(46, Math.min(96, Math.ceil(widest * CHAR_WIDTH) + 14));
}

// Quantas linhas a visão "Ver como tabela" mostra de cara — o resto fica
// atrás de um botão "Ver mais", pra uma série de 90+ pontos (ex: histórico
// de preço) não virar uma tabela gigantesca por padrão.
const CHART_TABLE_PAGE_SIZE = 10;

// rowsHtml: array de strings "<tr>...</tr>", uma por linha (não já
// concatenado) — precisa vir separado pra poder fatiar em "visíveis" e
// "escondidas". Devolve o HTML de duas <tbody> (uma tabela pode ter
// várias, é válido) mais o botão de expandir, se houver linhas escondidas.
function yalcaBuildPagedTableRows(rowsHtml) {
  if (rowsHtml.length <= CHART_TABLE_PAGE_SIZE) {
    return { tbodyHtml: `<tbody>${rowsHtml.join('')}</tbody>`, toggleHtml: '' };
  }
  const visible = rowsHtml.slice(0, CHART_TABLE_PAGE_SIZE).join('');
  const hidden = rowsHtml.slice(CHART_TABLE_PAGE_SIZE).join('');
  const remaining = rowsHtml.length - CHART_TABLE_PAGE_SIZE;
  const tbodyHtml = `<tbody>${visible}</tbody><tbody class="chart-table-extra" style="display:none;">${hidden}</tbody>`;
  const toggleHtml = `<button type="button" class="table-view-toggle chart-table-expand" data-more-label="Ver mais ${remaining} linha${remaining > 1 ? 's' : ''}" data-less-label="Ver menos">Ver mais ${remaining} linha${remaining > 1 ? 's' : ''}</button>`;
  return { tbodyHtml, toggleHtml };
}

// Liga o clique do botão "Ver mais"/"Ver menos" dentro de um container que
// já tem a tabela paginada montada (chamar depois de container.innerHTML=...).
function yalcaWireTableExpand(container) {
  const btn = container.querySelector('.chart-table-expand');
  if (!btn) return;
  const extra = container.querySelector('.chart-table-extra');
  btn.addEventListener('click', () => {
    const showing = extra.style.display !== 'none';
    extra.style.display = showing ? 'none' : '';
    btn.textContent = showing ? btn.dataset.moreLabel : btn.dataset.lessLabel;
  });
}

function yalcaMakeTooltip(wrap) {
  let tip = wrap.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    wrap.appendChild(tip);
  }
  return tip;
}

function yalcaShowTooltip(wrap, tip, x, y, html) {
  tip.innerHTML = html;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
  tip.classList.add('is-visible');
}
function yalcaHideTooltip(tip) { tip.classList.remove('is-visible'); }

/* No celular o SVG (viewBox fixo de 640px) renderiza texto pequeno
   demais para ler com conforto — a tabela (mesmo toggle, já acessível)
   começa como a visão padrão; o gráfico vira opt-in. */
function yalcaIsMobileChart() {
  return window.matchMedia('(max-width: 640px)').matches;
}
function yalcaChartSteps() {
  return yalcaIsMobileChart() ? 3 : 5;
}

/**
 * Gráfico de linhas multi-série.
 * container: elemento onde o gráfico será montado
 * opts: { series: [{name, color, data:[{label, value}] OU [{date, value}]}], formatValue }
 *
 * Dois modos, escolhidos automaticamente pela forma dos dados:
 * - "label" (categórico): pontos igualmente espaçados no eixo X — usado
 *   pros gráficos de meses/dias-do-período (Visão Geral, Financeiro, Fluxo
 *   de Caixa), onde os buckets já são uniformes por construção.
 * - "date" (linha do tempo real, estilo Keepa): a posição X é proporcional
 *   ao TEMPO REAL entre os pontos, não ao índice — necessário pro
 *   histórico de preço/BSR, onde o Keepa só grava um ponto quando o valor
 *   MUDA (os intervalos entre pontos são bem desiguais; espaçar por índice
 *   distorce o gráfico, comprimindo períodos de muita variação e esticando
 *   períodos parados). Também desenha em "degrau" (o valor anterior se
 *   mantém até o próximo ponto, não interpola uma reta entre os dois) e
 *   preenche a área sob a primeira série — mesma linguagem visual do
 *   gráfico real do Keepa.
 */
function yalcaRenderLineChart(container, opts) {
  const { series, formatValue = (v) => v, steps = yalcaChartSteps() } = opts;
  const isTimeMode = series.every(s => s.data.every(d => d.date !== undefined));
  return isTimeMode
    ? yalcaRenderTimeLineChart(container, { series, formatValue, steps })
    : yalcaRenderCategoricalLineChart(container, { series, formatValue, steps });
}

function yalcaRenderCategoricalLineChart(container, opts) {
  const { series, formatValue, steps } = opts;
  const W = 640, H = 260;
  const padR = 16, padT = 16, padB = 34;

  const labels = series[0].data.map(d => d.label);
  const allValues = series.flatMap(s => s.data.map(d => d.value));
  const maxVal = Math.max(...allValues, 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 1;
  // padL dinâmico: o rótulo mais largo do eixo Y (ex: "R$ 20.000,00") precisa
  // caber ANTES do início da área de plotagem, senão (com .chart-svg em
  // overflow:visible) o texto vaza pra fora do card à esquerda — bug real
  // com valores grandes/formatados em moeda. 46px fixos só bastavam pra
  // números curtos.
  const padL = yalcaAxisLeftPad(niceMax, steps, formatValue);
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  const yScale = (v) => padT + plotH - (v / niceMax) * plotH;
  const xScale = (i) => padL + i * xStep;

  const gridFractions = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const gridLines = gridFractions.map(f => {
    const y = padT + plotH - f * plotH;
    const val = f * niceMax;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
      <text x="${padL - 8}" y="${y + 4}" font-size="13" text-anchor="end">${formatValue(val)}</text>`;
  }).join('');

  // Decimação do eixo X: com muitos pontos (ex: 90 dias de histórico de
  // preço), um rótulo POR PONTO vira uma sopa de texto ilegível mesmo
  // truncado (não sobra nem 1 caractere de espaço por ponto). Em vez
  // disso, só um a cada N pontos ganha texto — os demais continuam com
  // seu ponto/linha no gráfico, só sem rótulo embaixo — e o texto some
  // até caber confortavelmente no espaço reservado (~46px por rótulo).
  const MIN_LABEL_GAP_PX = 46;
  const labelStride = xStep > 0 ? Math.max(1, Math.ceil(MIN_LABEL_GAP_PX / xStep)) : 1;
  const xLabelMaxWidth = labelStride * xStep || plotW;
  const xLabels = labels.map((label, i) => {
    const isLastPoint = i === labels.length - 1;
    if (i % labelStride !== 0 && !isLastPoint) return '';
    const truncated = yalcaTruncateLabel(label, xLabelMaxWidth);
    const inner = truncated === label ? yalcaEscapeHtml(label) : `<title>${yalcaEscapeHtml(label)}</title>${yalcaEscapeHtml(truncated)}`;
    return `<text x="${xScale(i)}" y="${H - 10}" font-size="13" text-anchor="middle">${inner}</text>`;
  }).join('');

  const seriesSvg = series.map(s => {
    const points = s.data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
    const dots = s.data.map((d, i) =>
      `<circle class="pt" data-i="${i}" data-s="${yalcaEscapeHtml(s.name)}" cx="${xScale(i)}" cy="${yScale(d.value)}" r="4" fill="${s.color}" />
       <circle data-i="${i}" data-s="${yalcaEscapeHtml(s.name)}" class="hit" cx="${xScale(i)}" cy="${yScale(d.value)}" r="12" fill="transparent" style="cursor:pointer" />`
    ).join('');
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
  }).join('');

  const legend = series.length > 1 ? `<div class="chart-legend">${series.map(s =>
    `<span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${s.color}"></span>${yalcaEscapeHtml(s.name)}</span>`
  ).join('')}</div>` : '';

  const tableRows = labels.map((label, i) =>
    `<tr><td>${yalcaEscapeHtml(label)}</td>${series.map(s => `<td class="num">${formatValue(s.data[i].value)}</td>`).join('')}</tr>`
  );
  const { tbodyHtml, toggleHtml } = yalcaBuildPagedTableRows(tableRows);
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Período</th>${series.map(s => `<th class="num">${yalcaEscapeHtml(s.name)}</th>`).join('')}</tr></thead>
    ${tbodyHtml}</table>${toggleHtml}</div>`;

  const startAsTable = yalcaIsMobileChart();
  container.innerHTML = `
    <div class="chart-card">
      ${legend}
      <button type="button" class="table-view-toggle" data-role="view-toggle">${startAsTable ? 'Ver como gráfico' : 'Ver como tabela'}</button>
      ${tableHtml}
      <div class="chart-wrap">
        <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de linha">
          ${gridLines}
          ${seriesSvg}
          ${xLabels}
        </svg>
      </div>
    </div>`;

  const wrap = container.querySelector('.chart-wrap');
  const tip = yalcaMakeTooltip(wrap);
  const svg = container.querySelector('svg');

  svg.querySelectorAll('.hit').forEach(hit => {
    hit.addEventListener('mouseenter', (e) => {
      const i = Number(hit.dataset.i);
      const sName = hit.dataset.s;
      const s = series.find(x => x.name === sName);
      const rect = svg.getBoundingClientRect();
      const px = (Number(hit.getAttribute('cx')) / W) * rect.width;
      const py = (Number(hit.getAttribute('cy')) / H) * rect.height;
      yalcaShowTooltip(wrap, tip, px, py, `<strong>${yalcaEscapeHtml(labels[i])}</strong><br>${yalcaEscapeHtml(sName)}: ${formatValue(s.data[i].value)}`);
    });
    hit.addEventListener('mouseleave', () => yalcaHideTooltip(tip));
  });

  const toggleBtn = container.querySelector('[data-role="view-toggle"]');
  const tableView = container.querySelector('.chart-table-view');
  if (startAsTable) tableView.classList.add('is-visible');
  toggleBtn.addEventListener('click', () => {
    const showing = tableView.classList.toggle('is-visible');
    toggleBtn.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
  yalcaWireTableExpand(container);
}

// Formato compacto (dd/mm/aa) pro eixo de um gráfico de linha do tempo —
// "20/04/2025" não cabe nem decimado num histórico de 90+ pontos.
function yalcaFormatAxisDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function yalcaRenderTimeLineChart(container, opts) {
  const { series, formatValue, steps } = opts;
  const W = 640, H = 260;
  const padR = 16, padT = 16, padB = 34;

  const allPoints = series.flatMap(s => s.data.map(d => ({ ...d, t: new Date(d.date).getTime() })));
  const allValues = allPoints.map(d => d.value);
  const maxVal = Math.max(...allValues, 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 1;
  const padL = yalcaAxisLeftPad(niceMax, steps, formatValue);
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const tMin = Math.min(...allPoints.map(d => d.t));
  const tMax = Math.max(...allPoints.map(d => d.t));
  const tSpan = tMax - tMin || 1;
  const yScale = (v) => padT + plotH - (v / niceMax) * plotH;
  // Posição proporcional ao TEMPO real, não ao índice do ponto — é isso que
  // corrige o gráfico ficar "torto" quando os pontos não são igualmente
  // espaçados no tempo (o Keepa só grava quando o preço muda).
  const xScale = (t) => padL + ((t - tMin) / tSpan) * plotW;

  const gridFractions = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const gridLines = gridFractions.map(f => {
    const y = padT + plotH - f * plotH;
    const val = f * niceMax;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
      <text x="${padL - 8}" y="${y + 4}" font-size="13" text-anchor="end">${formatValue(val)}</text>`;
  }).join('');

  // Ticks do eixo X em posições de tempo UNIFORMES (não em cada ponto de
  // dado, que estariam desigualmente espaçados) — o número de ticks que
  // cabe sem colidir depende da largura de um rótulo "dd/mm/aa" (~8 chars).
  const tickLabelWidth = 8 * 6.2 + 10;
  const tickCount = Math.max(2, Math.min(8, Math.floor(plotW / tickLabelWidth)));
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = tMin + (tSpan * i) / tickCount;
    return `<text x="${xScale(t)}" y="${H - 10}" font-size="13" text-anchor="middle">${yalcaEscapeHtml(yalcaFormatAxisDate(new Date(t)))}</text>`;
  }).join('');

  // Caminho em DEGRAU (step-after): o valor anterior se mantém até o
  // próximo ponto ser registrado, em vez de interpolar uma reta entre os
  // dois — é assim que preço/ranking realmente se comportam (ficam
  // parados até mudar), e é a mesma linguagem visual do gráfico do Keepa.
  function stepPath(points) {
    const sorted = [...points].sort((a, b) => a.t - b.t);
    if (sorted.length === 0) return { line: '', area: '' };
    let line = `M ${xScale(sorted[0].t).toFixed(1)} ${yScale(sorted[0].value).toFixed(1)}`;
    for (let i = 1; i < sorted.length; i++) {
      const x = xScale(sorted[i].t).toFixed(1);
      const yPrev = yScale(sorted[i - 1].value).toFixed(1);
      const yNow = yScale(sorted[i].value).toFixed(1);
      line += ` L ${x} ${yPrev} L ${x} ${yNow}`;
    }
    return { line, sorted };
  }

  // Sem preenchimento de área: testado contra um produto real cuja série
  // de referência passa longos trechos "achatada" (ex: buybox indisponível
  // por semanas) — a área sob um trecho longo e plano vira um bloco sólido
  // enorme até o zero do eixo Y, mais confuso do que informativo. A linha
  // em degrau sozinha já deixa a variação real bem legível.
  const seriesSvg = series.map((s) => {
    const { line, sorted } = stepPath(s.data.map(d => ({ ...d, t: new Date(d.date).getTime() })));
    const dots = sorted.map((d, i) =>
      `<circle data-i="${i}" data-s="${yalcaEscapeHtml(s.name)}" class="hit" cx="${xScale(d.t).toFixed(1)}" cy="${yScale(d.value).toFixed(1)}" r="9" fill="transparent" style="cursor:pointer" />`
    ).join('');
    return `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" />${dots}`;
  }).join('');

  const legend = series.length > 1 ? `<div class="chart-legend">${series.map(s =>
    `<span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${s.color}"></span>${yalcaEscapeHtml(s.name)}</span>`
  ).join('')}</div>` : '';

  // Tabela: uma linha por data única entre todas as séries (podem ter
  // datas diferentes entre si, já que cada uma só grava quando MUDA).
  const allDatesSorted = [...new Set(allPoints.map(d => d.date))].sort();
  const valueAtOrBefore = (s, dateStr) => {
    const upTo = s.data.filter(d => d.date <= dateStr);
    return upTo.length > 0 ? upTo[upTo.length - 1].value : null;
  };
  const tableRows = allDatesSorted.map(dateStr =>
    `<tr><td>${yalcaEscapeHtml(yalcaFormatAxisDate(new Date(dateStr)))}</td>${series.map(s => {
      const v = valueAtOrBefore(s, dateStr);
      return `<td class="num">${v !== null ? formatValue(v) : '—'}</td>`;
    }).join('')}</tr>`
  );
  const { tbodyHtml, toggleHtml } = yalcaBuildPagedTableRows(tableRows);
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Data</th>${series.map(s => `<th class="num">${yalcaEscapeHtml(s.name)}</th>`).join('')}</tr></thead>
    ${tbodyHtml}</table>${toggleHtml}</div>`;

  const startAsTable = yalcaIsMobileChart();
  container.innerHTML = `
    <div class="chart-card">
      ${legend}
      <button type="button" class="table-view-toggle" data-role="view-toggle">${startAsTable ? 'Ver como gráfico' : 'Ver como tabela'}</button>
      ${tableHtml}
      <div class="chart-wrap">
        <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de linha do tempo">
          ${gridLines}
          ${seriesSvg}
          ${xTicks}
        </svg>
      </div>
    </div>`;

  const wrap = container.querySelector('.chart-wrap');
  const tip = yalcaMakeTooltip(wrap);
  const svg = container.querySelector('svg');

  svg.querySelectorAll('.hit').forEach(hit => {
    hit.addEventListener('mouseenter', () => {
      const sName = hit.dataset.s;
      const s = series.find(x => x.name === sName);
      const sorted = [...s.data].sort((a, b) => new Date(a.date) - new Date(b.date));
      const i = Number(hit.dataset.i);
      const d = sorted[i];
      const rect = svg.getBoundingClientRect();
      const px = (Number(hit.getAttribute('cx')) / W) * rect.width;
      const py = (Number(hit.getAttribute('cy')) / H) * rect.height;
      yalcaShowTooltip(wrap, tip, px, py, `<strong>${yalcaEscapeHtml(yalcaFormatAxisDate(new Date(d.date)))}</strong><br>${yalcaEscapeHtml(s.name)}: ${formatValue(d.value)}`);
    });
    hit.addEventListener('mouseleave', () => yalcaHideTooltip(tip));
  });

  const toggleBtn = container.querySelector('[data-role="view-toggle"]');
  const tableView = container.querySelector('.chart-table-view');
  if (startAsTable) tableView.classList.add('is-visible');
  toggleBtn.addEventListener('click', () => {
    const showing = tableView.classList.toggle('is-visible');
    toggleBtn.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
  yalcaWireTableExpand(container);
}

/**
 * Gráfico de barras (categorias no eixo X, uma cor fixa por categoria).
 * opts: { data: [{label, value, color}], formatValue }
 */
function yalcaRenderBarChart(container, opts) {
  const { data, formatValue = (v) => v, steps = yalcaChartSteps() } = opts;
  const W = 640, H = 260;
  const padR = 16, padT = 16, padB = 34;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 1;
  const padL = yalcaAxisLeftPad(niceMax, steps, formatValue);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const barGap = 18;
  const barW = (plotW - barGap * (data.length - 1)) / data.length;
  const yScale = (v) => (v / niceMax) * plotH;

  const gridFractions = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const gridLines = gridFractions.map(f => {
    const y = padT + plotH - f * plotH;
    const val = f * niceMax;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
      <text x="${padL - 8}" y="${y + 4}" font-size="13" text-anchor="end">${formatValue(val)}</text>`;
  }).join('');

  // Rótulo pode ocupar a barra + parte do respiro dos dois lados (metade
  // do gap pra cada vizinho) sem colidir — mais generoso que travar na
  // largura exata da barra, que trunca rótulos curtos sem necessidade.
  const labelMaxWidth = barW + barGap * 0.8;
  const bars = data.map((d, i) => {
    const x = padL + i * (barW + barGap);
    const h = yScale(d.value);
    const y = padT + plotH - h;
    const truncated = yalcaTruncateLabel(d.label, labelMaxWidth);
    const labelHtml = truncated === d.label
      ? yalcaEscapeHtml(d.label)
      : `<title>${yalcaEscapeHtml(d.label)}</title>${yalcaEscapeHtml(truncated)}`;
    return `<rect class="hit" data-i="${i}" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 2)}" rx="4" fill="${d.color}" style="cursor:pointer" />
      <text x="${x + barW / 2}" y="${H - 10}" font-size="13" text-anchor="middle">${labelHtml}</text>`;
  }).join('');

  const tableRows = data.map(d => `<tr><td>${yalcaEscapeHtml(d.label)}</td><td class="num">${formatValue(d.value)}</td></tr>`);
  const { tbodyHtml, toggleHtml } = yalcaBuildPagedTableRows(tableRows);
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Categoria</th><th class="num">Valor</th></tr></thead>
    ${tbodyHtml}</table>${toggleHtml}</div>`;

  const startAsTable = yalcaIsMobileChart();
  container.innerHTML = `
    <div class="chart-card">
      <button type="button" class="table-view-toggle" data-role="view-toggle">${startAsTable ? 'Ver como gráfico' : 'Ver como tabela'}</button>
      ${tableHtml}
      <div class="chart-wrap">
        <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de barras">
          ${gridLines}
          ${bars}
        </svg>
      </div>
    </div>`;

  const wrap = container.querySelector('.chart-wrap');
  const tip = yalcaMakeTooltip(wrap);
  const svg = container.querySelector('svg');

  svg.querySelectorAll('.hit').forEach(hit => {
    hit.addEventListener('mouseenter', () => {
      const i = Number(hit.dataset.i);
      const d = data[i];
      const rect = svg.getBoundingClientRect();
      const px = ((Number(hit.getAttribute('x')) + barW / 2) / W) * rect.width;
      const py = (Number(hit.getAttribute('y')) / H) * rect.height;
      yalcaShowTooltip(wrap, tip, px, py, `<strong>${yalcaEscapeHtml(d.label)}</strong><br>${formatValue(d.value)}`);
    });
    hit.addEventListener('mouseleave', () => yalcaHideTooltip(tip));
  });

  const toggleBtn = container.querySelector('[data-role="view-toggle"]');
  const tableView = container.querySelector('.chart-table-view');
  if (startAsTable) tableView.classList.add('is-visible');
  toggleBtn.addEventListener('click', () => {
    const showing = tableView.classList.toggle('is-visible');
    toggleBtn.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
  yalcaWireTableExpand(container);
}

/**
 * Barra de composição (part-to-whole) — usada para mostrar como o
 * preço de venda se divide entre custo, frete, taxa, imposto e lucro.
 * opts: { segments: [{label, value, color}], formatValue }
 * Segmentos com valor <= 0 não aparecem na barra, mas continuam na legenda/tabela.
 */
function yalcaRenderWaterfallBar(container, opts) {
  const { segments, formatValue = (v) => v } = opts;
  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0) || 1;

  const bar = segments.filter(s => s.value > 0).map(s => {
    const pct = (s.value / total) * 100;
    const showLabel = pct >= 9;
    return `<div class="waterfall-seg" style="flex:${pct} 0 0%; background:${s.color};" title="${yalcaEscapeHtml(s.label)}: ${formatValue(s.value)} (${pct.toFixed(1)}%)">
      ${showLabel ? `<span>${pct.toFixed(0)}%</span>` : ''}
    </div>`;
  }).join('');

  const legend = segments.map(s => `
    <span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${s.color}"></span>${yalcaEscapeHtml(s.label)}: <strong style="color:var(--text); margin-left:4px;">${formatValue(s.value)}</strong></span>
  `).join('');

  const tableRows = segments.map(s => `<tr><td>${yalcaEscapeHtml(s.label)}</td><td class="num">${formatValue(s.value)}</td></tr>`).join('');
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Componente</th><th class="num">Valor</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;

  container.innerHTML = `
    <div class="chart-card">
      <button type="button" class="table-view-toggle">Ver como tabela</button>
      ${tableHtml}
      <div class="chart-wrap">
        <div class="waterfall-bar">${bar}</div>
        <div class="chart-legend" style="margin-top:14px;">${legend}</div>
      </div>
    </div>`;

  const toggleBtn2 = container.querySelector('.table-view-toggle');
  const tableView2 = container.querySelector('.chart-table-view');
  toggleBtn2.addEventListener('click', () => {
    const showing = tableView2.classList.toggle('is-visible');
    toggleBtn2.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
}
