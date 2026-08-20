/* =========================================
   Yalca Portal — gráficos SVG sem dependências

   Princípios seguidos:
   • uma cor fixa por entidade (nunca por posição no filtro)
   • grid discreto, legenda sempre visível com 2+ séries
   • tooltip por hover no desktop e por toque no celular
   • alternância para tabela (acessibilidade e leitura exata)
   • re-render no resize: densidade de rótulos e altura mudam
     conforme a largura real disponível
   ========================================= */

/* Cores como hex: var(--x) em atributo de apresentação SVG não é
   suportado de forma confiável em todos os navegadores/WebViews. */
const YALCA_COLORS = {
  series1: '#5b9cf3', // azul   — receita
  series2: '#e8703a', // laranja — despesa/custo
  series3: '#22c08a', // verde  — lucro/saldo
  series4: '#e0a32a', // amarelo
  series5: '#e4739c', // magenta
  series6: '#9b90f2', // violeta
  grid: '#24304d',
  axis: '#9aa5bd'
};

const YALCA_MARKETPLACE_COLOR = {
  'Mercado Livre': YALCA_COLORS.series1,
  'Amazon': YALCA_COLORS.series2,
  'Shopee': YALCA_COLORS.series3,
  'TikTok': YALCA_COLORS.series4,
  'Temu': YALCA_COLORS.series5,
  'Droga Raia': YALCA_COLORS.series6
};

const YALCA_PALETTE = [
  YALCA_COLORS.series1, YALCA_COLORS.series2, YALCA_COLORS.series3,
  YALCA_COLORS.series4, YALCA_COLORS.series5, YALCA_COLORS.series6
];

/* Canal fora da lista padrão ainda recebe uma cor estável (hash do nome),
   nunca uma cor por posição — o mesmo canal fica sempre da mesma cor. */
function yalcaChannelColor(name) {
  if (YALCA_MARKETPLACE_COLOR[name]) return YALCA_MARKETPLACE_COLOR[name];
  let hash = 0;
  for (let i = 0; i < String(name).length; i++) hash = (hash * 31 + String(name).charCodeAt(i)) >>> 0;
  return YALCA_PALETTE[hash % YALCA_PALETTE.length];
}

const YALCA_WATERFALL_COLORS = {
  custo: YALCA_COLORS.series2,
  frete: YALCA_COLORS.series4,
  taxa: YALCA_COLORS.series5,
  imposto: YALCA_COLORS.series1,
  lucro: YALCA_COLORS.series3
};

function yalcaEscapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

/* ---------- Infraestrutura comum ---------- */

/* Cada container guarda como se redesenhar; um único ResizeObserver
   global re-renderiza só o que mudou de largura, com debounce. */
const YALCA_CHART_REDRAW = new WeakMap();
let yalcaResizeObserver = null;
let yalcaResizeTimer = null;
const yalcaPendingResize = new Set();

function yalcaEnsureResizeObserver() {
  if (yalcaResizeObserver || typeof ResizeObserver === 'undefined') return;
  yalcaResizeObserver = new ResizeObserver(entries => {
    entries.forEach(e => yalcaPendingResize.add(e.target));
    clearTimeout(yalcaResizeTimer);
    yalcaResizeTimer = setTimeout(() => {
      yalcaPendingResize.forEach(el => {
        const redraw = YALCA_CHART_REDRAW.get(el);
        if (redraw && el.isConnected && el.clientWidth > 0) redraw();
      });
      yalcaPendingResize.clear();
    }, 160);
  });
}

function yalcaRegisterChart(container, redraw) {
  YALCA_CHART_REDRAW.set(container, redraw);
  yalcaEnsureResizeObserver();
  if (yalcaResizeObserver) {
    yalcaResizeObserver.unobserve(container);
    yalcaResizeObserver.observe(container);
  }
}

function yalcaChartWidth(container) {
  const w = container.clientWidth || container.parentElement && container.parentElement.clientWidth || 640;
  return Math.max(280, Math.min(w, 1100));
}

/* Rótulos do eixo X são desenhados de N em N para nunca se sobreporem. */
function yalcaLabelStep(count, width, approxLabelPx) {
  const perLabel = approxLabelPx || 52;
  const fits = Math.max(1, Math.floor(width / perLabel));
  return Math.max(1, Math.ceil(count / fits));
}

/* Escala "redonda": o topo do eixo cai em 1/2/2,5/5 × potência de 10. */
function yalcaNiceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const pow = Math.pow(10, exp);
  const frac = value / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

function yalcaMakeTooltip(wrap) {
  let tip = wrap.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.setAttribute('role', 'status');
    wrap.appendChild(tip);
  }
  return tip;
}

function yalcaShowTooltip(wrap, tip, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add('is-visible');
  // Mantém o balão dentro do container mesmo perto das bordas.
  const wrapW = wrap.clientWidth;
  const tipW = tip.offsetWidth;
  const clampedX = Math.max(tipW / 2 + 4, Math.min(x, wrapW - tipW / 2 - 4));
  tip.style.left = clampedX + 'px';
  tip.style.top = Math.max(y, 8) + 'px';
}

function yalcaHideTooltip(tip) { tip.classList.remove('is-visible'); }

/* Hover no desktop, toque no celular — o mesmo alvo serve aos dois. */
function yalcaBindHits(svg, wrap, tip, resolve) {
  const show = (hit) => {
    const info = resolve(hit);
    if (!info) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scale = rect.width / (vb.width || 1);
    yalcaShowTooltip(wrap, tip, info.x * scale, info.y * scale, info.html);
  };
  svg.querySelectorAll('.hit').forEach(hit => {
    hit.addEventListener('mouseenter', () => show(hit));
    hit.addEventListener('mouseleave', () => yalcaHideTooltip(tip));
    hit.addEventListener('touchstart', (e) => { e.stopPropagation(); show(hit); }, { passive: true });
    hit.addEventListener('focus', () => show(hit));
    hit.addEventListener('blur', () => yalcaHideTooltip(tip));
  });
  wrap.addEventListener('touchstart', () => yalcaHideTooltip(tip), { passive: true });
}

/* Estrutura padrão: legenda + botão "ver como tabela" + área do gráfico. */
function yalcaChartShell(container, opts) {
  const { legend = '', table = '', body = '', label = 'Gráfico' } = opts;
  container.innerHTML = `
    <div class="chart-card">
      ${legend ? `<div class="chart-legend">${legend}</div>` : ''}
      <div class="chart-wrap" role="img" aria-label="${yalcaEscapeHtml(label)}">${body}</div>
      ${table ? `<div class="table-scroll chart-table-view">${table}</div>` : ''}
      ${table ? '<button type="button" class="table-view-toggle">Ver os números em tabela</button>' : ''}
    </div>`;

  const toggle = container.querySelector('.table-view-toggle');
  if (toggle) {
    const view = container.querySelector('.chart-table-view');
    const card = container.querySelector('.chart-card');
    toggle.addEventListener('click', () => {
      const showing = view.classList.toggle('is-visible');
      card.classList.toggle('is-table-view', showing);
      toggle.setAttribute('aria-expanded', String(showing));
      toggle.textContent = showing ? 'Ver como gráfico' : 'Ver os números em tabela';
    });
  }
  return container.querySelector('.chart-wrap');
}

function yalcaLegendHtml(items) {
  return items.map(s =>
    `<span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${s.color}"></span>${yalcaEscapeHtml(s.name)}${s.value !== undefined ? `: <strong>${s.value}</strong>` : ''}</span>`
  ).join('');
}

function yalcaEmptyChart(container, message) {
  container.innerHTML = `<p class="alert-empty">${yalcaEscapeHtml(message)}</p>`;
  YALCA_CHART_REDRAW.delete(container);
}

/* ---------- Gráfico de linhas / área, multi-série ---------- */
/* opts: { series:[{name,color,data:[{label,value}],area?}], formatValue, formatAxis, allowNegative } */
function yalcaRenderLineChart(container, opts) {
  const draw = () => {
    const { series, formatValue = (v) => v, formatAxis, allowNegative = false } = opts;
    if (!series.length || !series[0].data.length) return yalcaEmptyChart(container, 'Sem dados no período.');

    const axisFmt = formatAxis || formatValue;
    const W = yalcaChartWidth(container);
    const compact = W < 520;
    const H = compact ? 220 : 280;
    const padL = compact ? 44 : 62, padR = 12, padT = 14, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const labels = series[0].data.map(d => d.label);
    const allValues = series.flatMap(s => s.data.map(d => d.value));
    const rawMax = Math.max(...allValues, 0);
    const rawMin = Math.min(...allValues, 0);
    const niceMax = yalcaNiceMax(rawMax) || 1;
    const niceMin = allowNegative && rawMin < 0 ? -yalcaNiceMax(Math.abs(rawMin)) : 0;
    const span = (niceMax - niceMin) || 1;

    const xStep = labels.length > 1 ? plotW / (labels.length - 1) : 0;
    const xScale = (i) => padL + (labels.length > 1 ? i * xStep : plotW / 2);
    const yScale = (v) => padT + plotH - ((v - niceMin) / span) * plotH;

    const ticks = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const gridLines = ticks.map(f => {
      const val = niceMin + f * span;
      const y = yScale(val);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" font-size="${compact ? 9 : 10}" text-anchor="end">${yalcaEscapeHtml(axisFmt(val))}</text>`;
    }).join('');

    const zeroLine = niceMin < 0
      ? `<line x1="${padL}" y1="${yScale(0).toFixed(1)}" x2="${W - padR}" y2="${yScale(0).toFixed(1)}" stroke="${YALCA_COLORS.axis}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />`
      : '';

    const step = yalcaLabelStep(labels.length, plotW, compact ? 44 : 60);
    const xLabels = labels.map((label, i) => (i % step === 0 || i === labels.length - 1)
      ? `<text x="${xScale(i).toFixed(1)}" y="${H - 9}" font-size="${compact ? 9 : 10}" text-anchor="middle">${yalcaEscapeHtml(label)}</text>`
      : ''
    ).join('');

    const seriesSvg = series.map((s, si) => {
      const pts = s.data.map((d, i) => `${xScale(i).toFixed(1)},${yScale(d.value).toFixed(1)}`);
      const areaPath = s.area
        ? `<polygon points="${pts.join(' ')} ${xScale(s.data.length - 1).toFixed(1)},${yScale(Math.max(niceMin, 0)).toFixed(1)} ${xScale(0).toFixed(1)},${yScale(Math.max(niceMin, 0)).toFixed(1)}" fill="${s.color}" opacity="0.10" />`
        : '';
      const dots = s.data.map((d, i) => {
        const cx = xScale(i).toFixed(1), cy = yScale(d.value).toFixed(1);
        return `<circle cx="${cx}" cy="${cy}" r="${compact ? 3 : 4}" fill="${s.color}" />
          <circle class="hit" tabindex="0" role="button" aria-label="${yalcaEscapeHtml(s.name + ' em ' + d.label + ': ' + formatValue(d.value))}" data-i="${i}" data-s="${si}" cx="${cx}" cy="${cy}" r="16" fill="transparent" />`;
      }).join('');
      return `${areaPath}<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${compact ? 2 : 2.5}" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
    }).join('');

    const tableHtml = `<table class="data-table"><thead><tr><th>Período</th>${series.map(s => `<th class="num">${yalcaEscapeHtml(s.name)}</th>`).join('')}</tr></thead><tbody>${
      labels.map((label, i) => `<tr><td>${yalcaEscapeHtml(label)}</td>${series.map(s => `<td class="num">${yalcaEscapeHtml(formatValue(s.data[i].value))}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;

    const wrap = yalcaChartShell(container, {
      legend: series.length > 1 ? yalcaLegendHtml(series.map(s => ({ name: s.name, color: s.color }))) : '',
      table: tableHtml,
      label: 'Gráfico de linha: ' + series.map(s => s.name).join(', '),
      body: `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="max-height:${H}px;">
        ${gridLines}${zeroLine}${seriesSvg}${xLabels}
      </svg>`
    });

    const svg = wrap.querySelector('svg');
    const tip = yalcaMakeTooltip(wrap);
    yalcaBindHits(svg, wrap, tip, (hit) => {
      const i = Number(hit.dataset.i), s = series[Number(hit.dataset.s)];
      return {
        x: Number(hit.getAttribute('cx')),
        y: Number(hit.getAttribute('cy')),
        html: `<strong>${yalcaEscapeHtml(labels[i])}</strong>` +
          series.map(sr => `<span class="chart-tooltip__row"><span class="chart-legend__swatch" style="background:${sr.color}"></span>${yalcaEscapeHtml(sr.name)}<b>${yalcaEscapeHtml(formatValue(sr.data[i].value))}</b></span>`).join('')
      };
    });
  };

  yalcaRegisterChart(container, draw);
  draw();
}

/* ---------- Barras verticais (categorias) ---------- */
/* opts: { data:[{label,value,color}], formatValue, formatAxis } */
function yalcaRenderBarChart(container, opts) {
  const draw = () => {
    const { data, formatValue = (v) => v, formatAxis } = opts;
    if (!data.length) return yalcaEmptyChart(container, 'Sem dados no período.');

    const axisFmt = formatAxis || formatValue;
    const W = yalcaChartWidth(container);
    const compact = W < 520;

    // Muitas categorias em tela estreita viram barras horizontais:
    // é o único jeito de os rótulos continuarem legíveis.
    if (compact && data.length > 4) return yalcaRenderHBarChartInner(container, opts, W);

    const H = compact ? 220 : 280;
    const padL = compact ? 44 : 62, padR = 12, padT = 14, padB = 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const rawMax = Math.max(...data.map(d => d.value), 0);
    const rawMin = Math.min(...data.map(d => d.value), 0);
    const niceMax = yalcaNiceMax(rawMax) || 1;
    const niceMin = rawMin < 0 ? -yalcaNiceMax(Math.abs(rawMin)) : 0;
    const span = (niceMax - niceMin) || 1;
    const yScale = (v) => padT + plotH - ((v - niceMin) / span) * plotH;

    const gap = Math.max(8, Math.min(24, plotW / (data.length * 4)));
    const barW = (plotW - gap * (data.length - 1)) / data.length;

    const ticks = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const gridLines = ticks.map(f => {
      const val = niceMin + f * span;
      const y = yScale(val);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" font-size="${compact ? 9 : 10}" text-anchor="end">${yalcaEscapeHtml(axisFmt(val))}</text>`;
    }).join('');

    const maxChars = Math.max(4, Math.floor(barW / 6));
    const bars = data.map((d, i) => {
      const x = padL + i * (barW + gap);
      const yTop = yScale(Math.max(d.value, 0));
      const yBottom = yScale(Math.min(d.value, 0));
      const h = Math.max(Math.abs(yBottom - yTop), 2);
      const short = d.label.length > maxChars ? d.label.slice(0, maxChars - 1) + '…' : d.label;
      return `<rect class="hit" tabindex="0" role="button" aria-label="${yalcaEscapeHtml(d.label + ': ' + formatValue(d.value))}" data-i="${i}" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${d.color || YALCA_COLORS.series1}" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${H - 10}" font-size="${compact ? 9 : 10}" text-anchor="middle">${yalcaEscapeHtml(short)}</text>`;
    }).join('');

    const tableHtml = `<table class="data-table"><thead><tr><th>Categoria</th><th class="num">Valor</th></tr></thead><tbody>${
      data.map(d => `<tr><td>${yalcaEscapeHtml(d.label)}</td><td class="num">${yalcaEscapeHtml(formatValue(d.value))}</td></tr>`).join('')
    }</tbody></table>`;

    const wrap = yalcaChartShell(container, {
      table: tableHtml,
      label: 'Gráfico de barras',
      body: `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="max-height:${H}px;">${gridLines}${bars}</svg>`
    });

    const svg = wrap.querySelector('svg');
    const tip = yalcaMakeTooltip(wrap);
    yalcaBindHits(svg, wrap, tip, (hit) => {
      const d = data[Number(hit.dataset.i)];
      return {
        x: Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2,
        y: Number(hit.getAttribute('y')),
        html: `<strong>${yalcaEscapeHtml(d.label)}</strong><span class="chart-tooltip__row">${yalcaEscapeHtml(formatValue(d.value))}</span>`
      };
    });
  };

  yalcaRegisterChart(container, draw);
  draw();
}

/* ---------- Barras horizontais (rankings e telas estreitas) ---------- */
function yalcaRenderHBarChart(container, opts) {
  const draw = () => yalcaRenderHBarChartInner(container, opts, yalcaChartWidth(container));
  yalcaRegisterChart(container, draw);
  draw();
}

function yalcaRenderHBarChartInner(container, opts, W) {
  const { data, formatValue = (v) => v } = opts;
  if (!data.length) return yalcaEmptyChart(container, 'Sem dados no período.');

  const rowH = 34;
  const labelW = Math.min(Math.max(90, W * 0.32), 190);
  const valueW = Math.min(Math.max(70, W * 0.24), 130);
  const barW = Math.max(40, W - labelW - valueW - 16);
  const maxAbs = Math.max(...data.map(d => Math.abs(d.value)), 1);
  const hasNegative = data.some(d => d.value < 0);
  const zeroX = hasNegative ? labelW + barW / 2 : labelW;
  const scale = (v) => (Math.abs(v) / maxAbs) * (hasNegative ? barW / 2 : barW);
  const H = data.length * rowH + 8;

  const rows = data.map((d, i) => {
    const y = i * rowH + 4;
    const w = Math.max(scale(d.value), 2);
    const x = d.value < 0 ? zeroX - w : zeroX;
    const maxChars = Math.floor(labelW / 6.4);
    const short = d.label.length > maxChars ? d.label.slice(0, maxChars - 1) + '…' : d.label;
    return `
      <text x="0" y="${y + rowH / 2 + 4}" font-size="11">${yalcaEscapeHtml(short)}</text>
      <rect class="hit" tabindex="0" role="button" aria-label="${yalcaEscapeHtml(d.label + ': ' + formatValue(d.value))}" data-i="${i}" x="${x.toFixed(1)}" y="${y + 6}" width="${w.toFixed(1)}" height="${rowH - 16}" rx="4" fill="${d.color || YALCA_COLORS.series1}" />
      <text x="${W}" y="${y + rowH / 2 + 4}" font-size="11" text-anchor="end" fill="${YALCA_COLORS.axis}">${yalcaEscapeHtml(formatValue(d.value))}</text>`;
  }).join('');

  const tableHtml = `<table class="data-table"><thead><tr><th>Item</th><th class="num">Valor</th></tr></thead><tbody>${
    data.map(d => `<tr><td>${yalcaEscapeHtml(d.label)}</td><td class="num">${yalcaEscapeHtml(formatValue(d.value))}</td></tr>`).join('')
  }</tbody></table>`;

  const wrap = yalcaChartShell(container, {
    table: tableHtml,
    label: 'Gráfico de barras horizontais',
    body: `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="max-height:${H}px;">
      ${hasNegative ? `<line x1="${zeroX}" y1="0" x2="${zeroX}" y2="${H}" stroke="${YALCA_COLORS.grid}" stroke-width="1" />` : ''}
      ${rows}
    </svg>`
  });

  const svg = wrap.querySelector('svg');
  const tip = yalcaMakeTooltip(wrap);
  yalcaBindHits(svg, wrap, tip, (hit) => {
    const d = data[Number(hit.dataset.i)];
    return {
      x: Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2,
      y: Number(hit.getAttribute('y')),
      html: `<strong>${yalcaEscapeHtml(d.label)}</strong><span class="chart-tooltip__row">${yalcaEscapeHtml(formatValue(d.value))}</span>`
    };
  });
}

/* ---------- Rosca (composição) ---------- */
/* opts: { data:[{label,value,color}], formatValue, centerLabel, centerValue } */
function yalcaRenderDonutChart(container, opts) {
  const draw = () => {
    const { data, formatValue = (v) => v, centerLabel = '', centerValue = '' } = opts;
    const positives = data.filter(d => d.value > 0);
    if (!positives.length) return yalcaEmptyChart(container, 'Sem dados no período.');

    const W = yalcaChartWidth(container);
    const size = Math.min(240, Math.max(180, W * 0.5));
    const r = size / 2 - 6;
    const inner = r * 0.62;
    const cx = size / 2, cy = size / 2;
    const total = positives.reduce((a, d) => a + d.value, 0);

    let angle = -Math.PI / 2;
    const arcs = positives.map((d, i) => {
      const slice = (d.value / total) * Math.PI * 2;
      const end = angle + slice;
      const large = slice > Math.PI ? 1 : 0;
      const p = (ang, rad) => `${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`;
      const path = `M ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(end, r)} L ${p(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(angle, inner)} Z`;
      const mid = angle + slice / 2;
      const out = `<path class="hit" tabindex="0" role="button" aria-label="${yalcaEscapeHtml(d.label + ': ' + formatValue(d.value))}" data-i="${i}" data-x="${(cx + Math.cos(mid) * ((r + inner) / 2)).toFixed(1)}" data-y="${(cy + Math.sin(mid) * ((r + inner) / 2)).toFixed(1)}" d="${path}" fill="${d.color || YALCA_PALETTE[i % YALCA_PALETTE.length]}" />`;
      angle = end;
      return out;
    }).join('');

    const legend = yalcaLegendHtml(positives.map((d, i) => ({
      name: d.label,
      color: d.color || YALCA_PALETTE[i % YALCA_PALETTE.length],
      value: `${yalcaEscapeHtml(formatValue(d.value))} (${((d.value / total) * 100).toFixed(0)}%)`
    })));

    const tableHtml = `<table class="data-table"><thead><tr><th>Item</th><th class="num">Valor</th><th class="num">Participação</th></tr></thead><tbody>${
      positives.map(d => `<tr><td>${yalcaEscapeHtml(d.label)}</td><td class="num">${yalcaEscapeHtml(formatValue(d.value))}</td><td class="num">${((d.value / total) * 100).toFixed(1)}%</td></tr>`).join('')
    }</tbody></table>`;

    const wrap = yalcaChartShell(container, {
      table: tableHtml,
      label: 'Gráfico de rosca',
      body: `<div class="donut-layout">
        <svg class="chart-svg donut-svg" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;">
          ${arcs}
          ${centerValue ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="17" font-weight="700" fill="#e7ebf5">${yalcaEscapeHtml(centerValue)}</text>` : ''}
          ${centerLabel ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10">${yalcaEscapeHtml(centerLabel)}</text>` : ''}
        </svg>
        <div class="chart-legend chart-legend--stack">${legend}</div>
      </div>`
    });

    const svg = wrap.querySelector('svg');
    const tip = yalcaMakeTooltip(wrap);
    yalcaBindHits(svg, wrap, tip, (hit) => {
      const d = positives[Number(hit.dataset.i)];
      return {
        x: Number(hit.dataset.x),
        y: Number(hit.dataset.y),
        html: `<strong>${yalcaEscapeHtml(d.label)}</strong><span class="chart-tooltip__row">${yalcaEscapeHtml(formatValue(d.value))} · ${((d.value / total) * 100).toFixed(1)}%</span>`
      };
    });
  };

  yalcaRegisterChart(container, draw);
  draw();
}

/* ---------- Barra de composição do preço ---------- */
/* Segmentos com valor <= 0 saem da barra mas continuam na legenda. */
function yalcaRenderWaterfallBar(container, opts) {
  const { segments, formatValue = (v) => v } = opts;
  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0) || 1;

  const bar = segments.filter(s => s.value > 0).map(s => {
    const pct = (s.value / total) * 100;
    return `<div class="waterfall-seg" style="flex:${pct.toFixed(3)} 0 0%; background:${s.color};" title="${yalcaEscapeHtml(s.label)}: ${yalcaEscapeHtml(formatValue(s.value))} (${pct.toFixed(1)}%)">
      ${pct >= 11 ? `<span>${pct.toFixed(0)}%</span>` : ''}
    </div>`;
  }).join('');

  const legend = yalcaLegendHtml(segments.map(s => ({ name: s.label, color: s.color, value: yalcaEscapeHtml(formatValue(s.value)) })));
  const tableHtml = `<table class="data-table"><thead><tr><th>Componente</th><th class="num">Valor</th><th class="num">% do preço</th></tr></thead><tbody>${
    segments.map(s => `<tr><td>${yalcaEscapeHtml(s.label)}</td><td class="num">${yalcaEscapeHtml(formatValue(s.value))}</td><td class="num">${((Math.max(s.value, 0) / total) * 100).toFixed(1)}%</td></tr>`).join('')
  }</tbody></table>`;

  yalcaChartShell(container, {
    table: tableHtml,
    label: 'Composição do preço de venda',
    body: `<div class="waterfall-bar">${bar}</div><div class="chart-legend chart-legend--wrap">${legend}</div>`
  });
}

/* ---------- Anel de progresso (metas) ---------- */
/* opts: { pct, label, value, sub, color, pacePct } */
function yalcaRenderProgressRing(container, opts) {
  const { pct, label = '', value = '', sub = '', color = YALCA_COLORS.series3, pacePct = null } = opts;
  const size = 132, stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(pct, 100));
  const paceClamped = pacePct === null ? null : Math.max(0, Math.min(pacePct, 100));

  container.innerHTML = `
    <div class="progress-ring">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${yalcaEscapeHtml(label + ': ' + pct.toFixed(0) + '% da meta')}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${YALCA_COLORS.grid}" stroke-width="${stroke}" />
        ${paceClamped !== null ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" opacity="0.28"
          stroke-dasharray="${(c * paceClamped / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})" />` : ''}
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${(c * clamped / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})" />
        <text x="${size / 2}" y="${size / 2 + 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#e7ebf5">${pct.toFixed(0)}%</text>
        <text x="${size / 2}" y="${size / 2 + 20}" text-anchor="middle" font-size="10" fill="${YALCA_COLORS.axis}">da meta</text>
      </svg>
      <div class="progress-ring__info">
        <span class="progress-ring__label">${yalcaEscapeHtml(label)}</span>
        <strong class="progress-ring__value">${yalcaEscapeHtml(value)}</strong>
        ${sub ? `<span class="progress-ring__sub">${sub}</span>` : ''}
      </div>
    </div>`;
}

/* ---------- Sparkline (tendência em miniatura, dentro do KPI) ---------- */
function yalcaSparklineSvg(values, color) {
  if (!values || values.length < 2) return '';
  const W = 96, H = 28;
  const max = Math.max(...values), min = Math.min(...values);
  const span = (max - min) || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color || YALCA_COLORS.series1}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}
