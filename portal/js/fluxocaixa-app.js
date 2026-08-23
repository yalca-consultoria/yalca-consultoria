/* =========================================
   Yalca Portal — página "Fluxo de Caixa" (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;

  renderFluxoCaixa();

  document.getElementById('plannedTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deletePlannedRow"]');
    if (btn) deletePlannedRow(btn.dataset.id);
  });

  document.getElementById('addPlannedBtn').addEventListener('click', () => {
    document.getElementById('plannedForm').reset();
    openModal('plannedModal');
  });

  document.getElementById('plannedForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const record = {
      date: document.getElementById('plDate').value,
      description: document.getElementById('plDescription').value,
      amount: parseFloat(document.getElementById('plAmount').value) || 0
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      await yalcaAddPlannedEntry(record);
      closeModal('plannedModal');
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
      renderFluxoCaixa();
    } catch (err) {
      alert('Não foi possível salvar: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar';
    }
  });
});

function computeCashflowProjection() {
  const monthly = yalcaGroupTransactionsByMonth(SHELL_DATA.transactions);
  const now = new Date();
  const fallbackKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastKey = monthly.length > 0 ? monthly[monthly.length - 1].key : fallbackKey;

  let recurringNet = 0;
  if (monthly.length > 0) {
    const lastClosed = monthly.length > 1 ? monthly[monthly.length - 2] : monthly[monthly.length - 1];
    recurringNet = lastClosed.receita - lastClosed.despesa;
  }

  let saldo = SHELL_DATA.settings.cashBalance;
  const projection = [];
  let [y, m] = lastKey.split('-').map(Number);

  for (let i = 0; i < 3; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const plannedForMonth = SHELL_DATA.plannedEntries.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
    saldo = saldo + recurringNet + plannedForMonth;
    projection.push({ key, saldo, plannedForMonth });
  }

  return { recurringNet, projection, currentBalance: SHELL_DATA.settings.cashBalance, currentKey: lastKey };
}

function renderFluxoCaixa() {
  const { recurringNet, projection, currentBalance, currentKey } = computeCashflowProjection();

  const lowestMonth = projection.reduce((min, p) => p.saldo < min.saldo ? p : min, projection[0]);

  renderKpiGrid('cashflowKpis', [
    { label: 'Saldo atual em caixa', value: yalcaFormatCurrency(currentBalance), delta: null, hint: yalcaMonthLabel(currentKey + '-01') },
    { label: 'Lucro recorrente/mês', value: yalcaFormatCurrency(recurringNet), delta: null, hint: 'baseado no último mês fechado' },
    { label: `Saldo projetado (${yalcaMonthLabel(projection[2].key + '-01')})`, value: yalcaFormatCurrency(projection[2].saldo), delta: null },
    { label: 'Mês mais apertado', value: yalcaMonthLabel(lowestMonth.key + '-01'), delta: null, hint: yalcaFormatCurrency(lowestMonth.saldo) }
  ]);

  const points = [{ label: yalcaMonthLabel(currentKey + '-01'), value: currentBalance }, ...projection.map(p => ({ label: yalcaMonthLabel(p.key + '-01'), value: p.saldo }))];
  yalcaRenderLineChart(document.getElementById('cashflowChart'), {
    series: [{ name: 'Saldo projetado', color: YALCA_COLORS.series3, data: points }],
    formatValue: (v) => yalcaFormatCurrency(v)
  });

  renderPlannedTable();
}

function renderPlannedTable() {
  const tbody = document.getElementById('plannedTableBody');
  const sorted = [...SHELL_DATA.plannedEntries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="alert-empty">Nenhum lançamento futuro cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${yalcaFormatDate(e.date)}</td>
      <td>${yalcaEscapeHtml(e.description)}</td>
      <td class="num ${e.amount >= 0 ? 'text-good' : 'text-critical'}">${e.amount >= 0 ? '+' : ''}${yalcaFormatCurrency(e.amount)}</td>
      <td class="row-actions"><button class="icon-btn" title="Excluir" data-action="deletePlannedRow" data-id="${e.id}">🗑</button></td>
    </tr>`).join('');
}

async function deletePlannedRow(id) {
  if (!confirm('Excluir este lançamento futuro?')) return;
  try {
    await yalcaDeletePlannedEntry(id);
    SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
    renderFluxoCaixa();
  } catch (err) {
    alert('Não foi possível excluir: ' + err.message);
  }
}
