/* =========================================
   Yalca Portal — página "Controle de Estoque" (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;
  initIaAgentWidget('estoque');

  document.getElementById('stockFilter').addEventListener('change', renderEstoque);
  document.getElementById('stockSearch').addEventListener('input', renderEstoque);

  renderEstoque();
});

const STOCK_STATUS_VISUALS = {
  OK: { color: 'var(--good)', badge: 'badge--ok' },
  Baixo: { color: 'var(--warning)', badge: 'badge--baixo' },
  Esgotado: { color: 'var(--critical)', badge: 'badge--esgotado' },
  Parado: { color: 'var(--serious)', badge: 'badge--parado' }
};

function renderStockStatusStack(withStatus) {
  const stack = document.getElementById('stockStatusStack');
  const legend = document.getElementById('stockStatusLegend');
  const total = withStatus.length;
  if (total === 0) {
    stack.innerHTML = '';
    legend.innerHTML = '<p class="alert-empty">Nenhum produto cadastrado.</p>';
    return;
  }
  const counts = { OK: 0, Baixo: 0, Esgotado: 0, Parado: 0 };
  withStatus.forEach(p => { counts[p.status_calc] = (counts[p.status_calc] || 0) + 1; });

  stack.innerHTML = Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) => {
    const pct = (n / total) * 100;
    return `<div class="status-stack__seg" style="width:${pct}%; background:${STOCK_STATUS_VISUALS[status].color};" title="${status}: ${n} produto(s) (${pct.toFixed(1)}%)"></div>`;
  }).join('');

  legend.innerHTML = Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) => `
    <span class="status-stack__legend-item"><span class="status-stack__legend-swatch" style="background:${STOCK_STATUS_VISUALS[status].color}"></span>${status}: <strong style="color:var(--text);">${n}</strong> (${((n / total) * 100).toFixed(1)}%)</span>
  `).join('');
}

function renderEstoque() {
  const filter = document.getElementById('stockFilter').value || 'todos';
  const withStatus = SHELL_DATA.products.map(p => ({ ...p, status_calc: yalcaStockStatus(p) }));
  const filtered = filter === 'todos' ? withStatus : withStatus.filter(p => p.status_calc === filter);

  const esgotado = withStatus.filter(p => p.status_calc === 'Esgotado').length;
  const baixo = withStatus.filter(p => p.status_calc === 'Baixo').length;
  const parado = withStatus.filter(p => p.status_calc === 'Parado');
  const valorParado = parado.reduce((a, p) => a + p.cost * p.stock, 0);

  renderKpiGrid('stockKpis', [
    { label: 'Esgotados', value: esgotado, delta: null, info: 'Produtos com 0 unidades em estoque agora — venda parada até repor.' },
    { label: 'Estoque baixo', value: baixo, delta: null, info: 'Produtos com estoque abaixo do mínimo cadastrado — risco de esgotar em breve.' },
    { label: 'Estoque parado', value: parado.length, delta: null, info: 'Produtos com estoque alto e poucas vendas no mês — capital parado que poderia estar girando.' },
    { label: 'Capital parado em estoque', value: yalcaFormatCurrency(valorParado), delta: null, hint: 'custo × unidades de itens parados', info: 'Quanto dinheiro está investido (custo × unidades) nos produtos classificados como "estoque parado" — é capital que não está gerando venda.' }
  ]);

  renderStockStatusStack(withStatus);

  const alerts = [];
  withStatus.filter(p => p.status_calc === 'Esgotado').forEach(p =>
    alerts.push({ level: 'critical', icon: '⛔', title: `${p.name} esgotado`, sub: `${p.marketplace} · vendia ${p.unitsSoldMonth}/mês` }));
  withStatus.filter(p => p.status_calc === 'Baixo').forEach(p =>
    alerts.push({ level: 'warning', icon: '⚠️', title: `Estoque baixo: ${p.name}`, sub: `${p.stock} unidades restantes (mínimo: ${p.minStock})` }));
  withStatus.filter(p => p.status_calc === 'Parado').forEach(p =>
    alerts.push({ level: '', icon: '🐌', title: `${p.name} está parado`, sub: `${p.stock} unidades em estoque, só ${p.unitsSoldMonth} vendidas no mês — ${yalcaFormatCurrency(p.cost * p.stock)} parados` }));
  renderAlertList(document.getElementById('stockAlerts'), alerts.slice(0, 8));

  const search = document.getElementById('stockSearch').value.trim().toLowerCase();
  const searched = search
    ? filtered.filter(p => p.sku.toLowerCase().includes(search) || p.name.toLowerCase().includes(search))
    : filtered;

  const tbody = document.getElementById('stockTableBody');
  if (searched.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="alert-empty">${filtered.length === 0 ? 'Nenhum produto nesse status.' : 'Nenhum produto encontrado para essa busca.'}</td></tr>`;
    return;
  }
  const badgeClass = { OK: 'ok', Baixo: 'baixo', Esgotado: 'esgotado', Parado: 'parado' };
  tbody.innerHTML = searched.map(p => `
    <tr>
      <td data-label="SKU">${yalcaEscapeHtml(p.sku)}</td>
      <td data-label="Produto">${yalcaEscapeHtml(p.name)}</td>
      <td class="num" data-label="Estoque">${p.stock}</td>
      <td class="num" data-label="Mínimo">${p.minStock}</td>
      <td class="num" data-label="Vendidos/mês">${p.unitsSoldMonth}</td>
      <td data-label="Status"><span class="badge badge--${badgeClass[p.status_calc]}">${p.status_calc}</span></td>
    </tr>`).join('');
}
