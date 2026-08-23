/* =========================================
   Yalca Portal — página "Gestão de Marketplaces" (standalone)
   ========================================= */

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

  const marketplaceFilter = document.getElementById('marketplaceFilter');
  const optAll = document.createElement('option');
  optAll.value = 'todos'; optAll.textContent = 'Todos os marketplaces';
  marketplaceFilter.appendChild(optAll);
  MARKETPLACES.forEach(mk => {
    const opt = document.createElement('option');
    opt.value = mk; opt.textContent = mk;
    marketplaceFilter.appendChild(opt);
  });
  marketplaceFilter.addEventListener('change', renderMarketplaces);
  document.getElementById('marketplaceSearch').addEventListener('input', renderMarketplaces);

  renderMarketplaces();

  document.getElementById('productsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'editProduct') editProduct(id);
    else if (action === 'deleteProductRow') deleteProductRow(id);
  });

  document.getElementById('addProductBtn').addEventListener('click', () => {
    document.getElementById('productForm').reset();
    document.getElementById('prodId').value = '';
    document.getElementById('productModalTitle').textContent = 'Novo produto';
    openModal('productModal');
  });

  document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const id = document.getElementById('prodId').value;
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
      if (id) await yalcaUpdateProduct(id, record);
      else await yalcaAddProduct(record);
      closeModal('productModal');
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
      renderMarketplaces();
    } catch (err) {
      alert('Não foi possível salvar o produto: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });
});

function renderMarketplaces() {
  const filter = document.getElementById('marketplaceFilter').value || 'todos';
  const products = filter === 'todos' ? SHELL_DATA.products : SHELL_DATA.products.filter(p => p.marketplace === filter);

  const margins = products.map(p => yalcaProductMargin(p, SHELL_DATA.settings).marginPct);
  const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const negativeCount = products.filter(p => yalcaProductMargin(p, SHELL_DATA.settings).marginPct < 0).length;
  const totalUnits = products.reduce((a, p) => a + p.unitsSoldMonth, 0);

  renderKpiGrid('marketplaceKpis', [
    { label: 'Produtos cadastrados', value: products.length, delta: null },
    { label: 'Unidades vendidas/mês', value: totalUnits, delta: null },
    { label: 'Margem média da carteira', value: `${avgMargin.toFixed(1)}%`, delta: null },
    { label: 'Produtos no prejuízo', value: negativeCount, delta: null, hint: negativeCount > 0 ? 'revise o preço desses itens' : 'nenhum item no prejuízo' }
  ]);

  const marginByMarketplace = MARKETPLACES
    .map(mk => {
      const mkProducts = SHELL_DATA.products.filter(p => p.marketplace === mk);
      if (mkProducts.length === 0) return null;
      const avg = mkProducts.reduce((a, p) => a + yalcaProductMargin(p, SHELL_DATA.settings).marginPct, 0) / mkProducts.length;
      return { label: mk, value: Number(avg.toFixed(1)), color: YALCA_MARKETPLACE_COLOR[mk] };
    })
    .filter(Boolean);

  if (marginByMarketplace.length > 0) {
    yalcaRenderBarChart(document.getElementById('marketplaceMarginChart'), {
      data: marginByMarketplace,
      formatValue: (v) => `${v}%`
    });
  } else {
    document.getElementById('marketplaceMarginChart').innerHTML = '<p class="alert-empty">Cadastre produtos para ver a margem média por marketplace.</p>';
  }

  const search = document.getElementById('marketplaceSearch').value.trim().toLowerCase();
  const searchedProducts = search
    ? products.filter(p => p.sku.toLowerCase().includes(search) || p.name.toLowerCase().includes(search))
    : products;

  const tbody = document.getElementById('productsTableBody');
  if (searchedProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="alert-empty">${products.length === 0 ? 'Nenhum produto cadastrado.' : 'Nenhum produto encontrado para essa busca.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = searchedProducts.map(p => {
    const { marginPct } = yalcaProductMargin(p, SHELL_DATA.settings);
    const marginClass = marginPct < 0 ? 'text-critical' : (marginPct < 15 ? '' : 'text-good');
    const gaugeColor = marginPct < 0 ? 'var(--critical)' : (marginPct < 15 ? 'var(--warning)' : 'var(--good)');
    const gaugeWidth = Math.max(0, Math.min(100, marginPct));
    return `
    <tr>
      <td data-label="SKU">${yalcaEscapeHtml(p.sku)}</td>
      <td data-label="Produto">${yalcaEscapeHtml(p.name)}</td>
      <td data-label="Marketplace"><div class="marketplace-cell">${renderChannelBadge(p.marketplace)}<div class="marketplace-cell__text"><strong>${yalcaEscapeHtml(p.marketplace)}</strong></div></div></td>
      <td class="num" data-label="Custo">${yalcaFormatCurrency(p.cost)}</td>
      <td class="num" data-label="Preço">${yalcaFormatCurrency(p.price)}</td>
      <td class="num ${marginClass}" data-label="Margem líquida">
        ${marginPct.toFixed(1)}%
        <div class="margin-gauge margin-gauge--sm"><div class="margin-gauge__fill" style="width:${gaugeWidth}%; background:${gaugeColor};"></div></div>
      </td>
      <td class="num" data-label="Vendidos/mês">${p.unitsSoldMonth}</td>
      <td data-label="Status">${p.status === 'Ativo' ? '<span class="badge badge--ativo">Ativo</span>' : '<span class="badge badge--pausado">Pausado</span>'}</td>
      <td class="row-actions">
        <button class="icon-btn" title="Editar" data-action="editProduct" data-id="${p.id}">✎</button>
        <button class="icon-btn" title="Excluir" data-action="deleteProductRow" data-id="${p.id}">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

function editProduct(id) {
  const p = SHELL_DATA.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prodId').value = p.id;
  document.getElementById('prodSku').value = p.sku;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodMarketplace').value = p.marketplace;
  document.getElementById('prodCategory').value = p.category;
  document.getElementById('prodCost').value = p.cost;
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodStock').value = p.stock;
  document.getElementById('prodMinStock').value = p.minStock;
  document.getElementById('prodSoldMonth').value = p.unitsSoldMonth;
  document.getElementById('prodStatus').value = p.status;
  document.getElementById('productModalTitle').textContent = 'Editar produto';
  openModal('productModal');
}

async function deleteProductRow(id) {
  if (!confirm('Excluir este produto?')) return;
  try {
    await yalcaDeleteProduct(id);
    SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
    renderMarketplaces();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}
