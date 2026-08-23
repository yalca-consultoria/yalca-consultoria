/* =========================================
   Yalca Portal — página "Financeiro" / Receitas e Despesas (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;

  const tMarketplaceSel = document.getElementById('tMarketplace');
  MARKETPLACES.forEach(mk => {
    const opt = document.createElement('option');
    opt.value = mk;
    opt.textContent = mk;
    tMarketplaceSel.appendChild(opt);
  });

  document.getElementById('financeSearch').addEventListener('input', renderFinanceiro);

  renderFinanceiro();

  document.getElementById('transactionsTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'editTransaction') editTransaction(id);
    else if (action === 'deleteTransactionRow') deleteTransactionRow(id);
  });

  document.getElementById('addTransactionBtn').addEventListener('click', () => {
    document.getElementById('transactionForm').reset();
    document.getElementById('tId').value = '';
    document.getElementById('transactionModalTitle').textContent = 'Novo lançamento';
    document.getElementById('tDate').value = new Date().toISOString().slice(0, 10);
    openModal('transactionModal');
  });

  document.getElementById('transactionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const id = document.getElementById('tId').value;
    const record = {
      date: document.getElementById('tDate').value,
      type: document.getElementById('tType').value,
      category: document.getElementById('tCategory').value,
      marketplace: document.getElementById('tMarketplace').value,
      description: document.getElementById('tDescription').value,
      amount: parseFloat(document.getElementById('tAmount').value) || 0
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      if (id) await yalcaUpdateTransaction(id, record);
      else await yalcaAddTransaction(record);
      closeModal('transactionModal');
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
      renderFinanceiro();
    } catch (err) {
      alert('Não foi possível salvar o lançamento: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportTransactionsCsv);
  document.getElementById('importCsvInput').addEventListener('change', importTransactionsCsv);
});

function renderFinanceiro() {
  const monthly = yalcaGroupTransactionsByMonth(SHELL_DATA.transactions);

  if (monthly.length === 0) {
    renderKpiGrid('financeKpis', [
      { label: 'Receita', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Despesa', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Lucro líquido', value: yalcaFormatCurrency(0), delta: null },
      { label: 'Margem líquida', value: '—', delta: null }
    ]);
    document.getElementById('financeFilterMonth').innerHTML = '<option value="todos">Todos os meses</option>';
    document.getElementById('financeTrendChart').innerHTML = '<p class="alert-empty">Nenhum lançamento cadastrado ainda.</p>';
    document.getElementById('financeMarketplaceChart').innerHTML = '<p class="alert-empty">Nenhuma receita registrada ainda.</p>';
    renderTransactionsTable([]);
    return;
  }

  populateMonthFilter(monthly);

  const filterEl = document.getElementById('financeFilterMonth');
  const selectedKey = filterEl.value || 'todos';

  const filteredTx = selectedKey === 'todos'
    ? SHELL_DATA.transactions
    : SHELL_DATA.transactions.filter(t => t.date.startsWith(selectedKey));

  const receitaTotal = filteredTx.filter(t => t.type === 'receita').reduce((a, t) => a + Number(t.amount), 0);
  const despesaTotal = filteredTx.filter(t => t.type === 'despesa').reduce((a, t) => a + Number(t.amount), 0);
  const lucro = receitaTotal - despesaTotal;
  const margem = receitaTotal > 0 ? (lucro / receitaTotal) * 100 : 0;

  renderKpiGrid('financeKpis', [
    { label: 'Receita', value: yalcaFormatCurrency(receitaTotal), delta: null },
    { label: 'Despesa', value: yalcaFormatCurrency(despesaTotal), delta: null },
    { label: 'Lucro líquido', value: yalcaFormatCurrency(lucro), delta: null },
    { label: 'Margem líquida', value: `${margem.toFixed(1)}%`, delta: null }
  ]);

  const last6 = monthly.slice(-6);
  yalcaRenderLineChart(document.getElementById('financeTrendChart'), {
    series: [
      { name: 'Receita', color: YALCA_COLORS.series1, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.receita })) },
      { name: 'Despesa', color: YALCA_COLORS.series2, data: last6.map(m => ({ label: yalcaMonthLabel(m.key + '-01'), value: m.despesa })) }
    ],
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  const marketplaceKey = selectedKey === 'todos' ? monthly[monthly.length - 1].key : selectedKey;
  const revenueByMarketplace = MARKETPLACES
    .map(mk => ({
      label: mk,
      value: SHELL_DATA.transactions.filter(t => t.type === 'receita' && t.marketplace === mk && t.date.startsWith(marketplaceKey)).reduce((a, t) => a + Number(t.amount), 0),
      color: YALCA_MARKETPLACE_COLOR[mk]
    }))
    .filter(d => d.value > 0);

  if (revenueByMarketplace.length > 0) {
    yalcaRenderBarChart(document.getElementById('financeMarketplaceChart'), {
      data: revenueByMarketplace,
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  } else {
    document.getElementById('financeMarketplaceChart').innerHTML = '<p class="alert-empty">Sem receita registrada nesse período.</p>';
  }

  const categoryTotals = new Map();
  filteredTx.filter(t => t.type === 'despesa').forEach(t => {
    categoryTotals.set(t.category, (categoryTotals.get(t.category) || 0) + Number(t.amount));
  });
  const categoryData = [...categoryTotals.entries()]
    .map(([label, value]) => ({ label, value, color: YALCA_COLORS.series2 }))
    .sort((a, b) => b.value - a.value);

  if (categoryData.length > 0) {
    yalcaRenderBarChart(document.getElementById('financeCategoryChart'), {
      data: categoryData,
      formatValue: (v) => yalcaFormatCurrency(v)
    });
  } else {
    document.getElementById('financeCategoryChart').innerHTML = '<p class="alert-empty">Sem despesas registradas nesse período.</p>';
  }

  const search = document.getElementById('financeSearch').value.trim().toLowerCase();
  const searchedTx = search
    ? filteredTx.filter(t => t.description.toLowerCase().includes(search) || t.category.toLowerCase().includes(search))
    : filteredTx;
  renderTransactionsTable(searchedTx);
}

function populateMonthFilter(monthly) {
  const sel = document.getElementById('financeFilterMonth');
  const current = sel.value;
  sel.innerHTML = '<option value="todos">Todos os meses</option>' +
    monthly.map(m => `<option value="${m.key}">${yalcaMonthLabel(m.key + '-01')}</option>`).join('');
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  else sel.value = monthly[monthly.length - 1].key;
  sel.onchange = renderFinanceiro;
}

function renderTransactionsTable(transactions) {
  const tbody = document.getElementById('transactionsTableBody');
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="alert-empty">Nenhum lançamento neste período.</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(t => `
    <tr>
      <td data-label="Data">${yalcaFormatDate(t.date)}</td>
      <td data-label="Tipo">${t.type === 'receita' ? '<span class="badge badge--receita">Receita</span>' : '<span class="badge badge--despesa">Despesa</span>'}</td>
      <td data-label="Categoria">${yalcaEscapeHtml(t.category)}</td>
      <td data-label="Marketplace">${yalcaEscapeHtml(t.marketplace)}</td>
      <td data-label="Descrição">${yalcaEscapeHtml(t.description)}</td>
      <td class="num ${t.type === 'receita' ? 'text-good' : 'text-critical'}" data-label="Valor">${t.type === 'receita' ? '+' : '-'} ${yalcaFormatCurrency(t.amount)}</td>
      <td class="row-actions">
        <button class="icon-btn" title="Editar" data-action="editTransaction" data-id="${t.id}">✎</button>
        <button class="icon-btn" title="Excluir" data-action="deleteTransactionRow" data-id="${t.id}">🗑</button>
      </td>
    </tr>`).join('');
}

function editTransaction(id) {
  const t = SHELL_DATA.transactions.find(x => x.id === id);
  if (!t) return;
  document.getElementById('tId').value = t.id;
  document.getElementById('tDate').value = t.date;
  document.getElementById('tType').value = t.type;
  document.getElementById('tCategory').value = t.category;
  document.getElementById('tMarketplace').value = t.marketplace;
  document.getElementById('tDescription').value = t.description;
  document.getElementById('tAmount').value = t.amount;
  document.getElementById('transactionModalTitle').textContent = 'Editar lançamento';
  openModal('transactionModal');
}

async function deleteTransactionRow(id) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    await yalcaDeleteTransaction(id);
    SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
    renderFinanceiro();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}

function exportTransactionsCsv() {
  const rows = [['data', 'tipo', 'categoria', 'marketplace', 'descricao', 'valor']];
  SHELL_DATA.transactions.forEach(t => rows.push([t.date, t.type, t.category, t.marketplace, t.description, t.amount]));
  const csv = rows.map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lancamentos-yalca.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// Formato de data aceito: YYYY-MM-DD (o mesmo que o CSV exportado usa).
const CSV_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCsvAmount(raw) {
  const trimmed = (raw || '').trim();
  if (trimmed === '') return null;
  // Aceita tanto "1234.56" (padrão do CSV exportado) quanto "1.234,56"
  // (formato pt-BR que uma planilha exportada pelo Excel/Sheets no Brasil
  // costuma gerar) — sem isso, qualquer valor nesse segundo formato virava
  // silenciosamente R$0,00 (parseFloat('1.234,56') lê só o "1.234").
  const ptBr = /^-?\d{1,3}(\.\d{3})*,\d+$/.test(trimmed);
  const normalized = ptBr ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function importTransactionsCsv(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const lines = String(reader.result).split(/\r?\n/).filter(l => l.trim().length > 0);
    const dataLines = lines.slice(1); // ignora cabeçalho
    const records = [];
    const skipped = [];
    dataLines.forEach((line, idx) => {
      const rowNum = idx + 2; // +1 pelo cabeçalho, +1 porque é 1-indexado
      const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g);
      if (!cols || cols.length < 6) { skipped.push(`Linha ${rowNum}: número de colunas inválido.`); return; }
      const clean = cols.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const [date, type, category, marketplace, description, amountRaw] = clean;
      if (!date || !CSV_DATE_RE.test(date)) { skipped.push(`Linha ${rowNum}: data inválida ("${date || ''}") — use AAAA-MM-DD.`); return; }
      if (!['receita', 'despesa'].includes(type)) { skipped.push(`Linha ${rowNum}: tipo inválido ("${type || ''}") — use "receita" ou "despesa".`); return; }
      const amount = parseCsvAmount(amountRaw);
      if (amount === null) { skipped.push(`Linha ${rowNum}: valor inválido ("${amountRaw || ''}").`); return; }
      records.push({
        date, type, category: category || 'Outros',
        marketplace: marketplace || '-', description: description || '', amount
      });
    });

    if (records.length === 0 && skipped.length > 0) {
      alert(`Nenhum lançamento pôde ser importado. Problemas encontrados:\n\n${skipped.slice(0, 15).join('\n')}${skipped.length > 15 ? `\n... e mais ${skipped.length - 15}.` : ''}`);
      e.target.value = '';
      return;
    }

    try {
      for (const record of records) {
        await yalcaAddTransaction(record);
      }
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
      renderFinanceiro();
      let msg = `${records.length} lançamento(s) importado(s) com sucesso.`;
      if (skipped.length > 0) {
        msg += `\n\n${skipped.length} linha(s) ignorada(s) por erro:\n${skipped.slice(0, 15).join('\n')}${skipped.length > 15 ? `\n... e mais ${skipped.length - 15}.` : ''}`;
      }
      alert(msg);
    } catch (err) {
      alert('Erro ao importar CSV: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}
