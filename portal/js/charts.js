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

/**
 * Gráfico de linhas multi-série.
 * container: elemento onde o gráfico será montado
 * opts: { series: [{name, color, data:[{label, value}]}], formatValue }
 */
function yalcaRenderLineChart(container, opts) {
  const { series, formatValue = (v) => v } = opts;
  const W = 640, H = 260;
  const padL = 46, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const labels = series[0].data.map(d => d.label);
  const allValues = series.flatMap(s => s.data.map(d => d.value));
  const maxVal = Math.max(...allValues, 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 1;

  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  const yScale = (v) => padT + plotH - (v / niceMax) * plotH;
  const xScale = (i) => padL + i * xStep;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = padT + plotH - f * plotH;
    const val = f * niceMax;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
      <text x="${padL - 8}" y="${y + 4}" font-size="10" text-anchor="end">${formatValue(val)}</text>`;
  }).join('');

  const xLabels = labels.map((label, i) =>
    `<text x="${xScale(i)}" y="${H - 10}" font-size="10" text-anchor="middle">${yalcaEscapeHtml(label)}</text>`
  ).join('');

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
  ).join('');
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Período</th>${series.map(s => `<th class="num">${yalcaEscapeHtml(s.name)}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody></table></div>`;

  container.innerHTML = `
    <div class="chart-card">
      ${legend}
      <button type="button" class="table-view-toggle">Ver como tabela</button>
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

  const toggleBtn = container.querySelector('.table-view-toggle');
  const tableView = container.querySelector('.chart-table-view');
  toggleBtn.addEventListener('click', () => {
    const showing = tableView.classList.toggle('is-visible');
    toggleBtn.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
}

/**
 * Gráfico de barras (categorias no eixo X, uma cor fixa por categoria).
 * opts: { data: [{label, value, color}], formatValue }
 */
function yalcaRenderBarChart(container, opts) {
  const { data, formatValue = (v) => v } = opts;
  const W = 640, H = 260;
  const padL = 46, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 1;
  const barGap = 18;
  const barW = (plotW - barGap * (data.length - 1)) / data.length;
  const yScale = (v) => (v / niceMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = padT + plotH - f * plotH;
    const val = f * niceMax;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
      <text x="${padL - 8}" y="${y + 4}" font-size="10" text-anchor="end">${formatValue(val)}</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const x = padL + i * (barW + barGap);
    const h = yScale(d.value);
    const y = padT + plotH - h;
    return `<rect class="hit" data-i="${i}" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 2)}" rx="4" fill="${d.color}" style="cursor:pointer" />
      <text x="${x + barW / 2}" y="${H - 10}" font-size="10" text-anchor="middle">${yalcaEscapeHtml(d.label)}</text>`;
  }).join('');

  const tableRows = data.map(d => `<tr><td>${yalcaEscapeHtml(d.label)}</td><td class="num">${formatValue(d.value)}</td></tr>`).join('');
  const tableHtml = `<div class="table-scroll chart-table-view">
    <table class="data-table"><thead><tr><th>Categoria</th><th class="num">Valor</th></tr></thead>
    <tbody>${tableRows}</tbody></table></div>`;

  container.innerHTML = `
    <div class="chart-card">
      <button type="button" class="table-view-toggle">Ver como tabela</button>
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

  const toggleBtn = container.querySelector('.table-view-toggle');
  const tableView = container.querySelector('.chart-table-view');
  toggleBtn.addEventListener('click', () => {
    const showing = tableView.classList.toggle('is-visible');
    toggleBtn.textContent = showing ? 'Ver como gráfico' : 'Ver como tabela';
  });
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
