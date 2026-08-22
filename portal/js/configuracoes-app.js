/* =========================================
   Yalca Portal — página "Configurações" (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;

  initModals();
  renderSettingsForm();

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const successMsg = document.getElementById('settingsSuccess');
    successMsg.classList.remove('is-visible');

    const marketplaceFees = {};
    document.querySelectorAll('#settingsFeeFields input').forEach(input => {
      marketplaceFees[input.dataset.mk] = parseFloat(input.value) || 0;
    });

    const patch = {
      client_name: document.getElementById('setClientName').value,
      cash_balance: parseFloat(document.getElementById('setCashBalance').value) || 0,
      default_tax_pct: parseFloat(document.getElementById('setTaxPct').value) || 0,
      default_shipping_cost: parseFloat(document.getElementById('setShipping').value) || 0,
      marketplace_fees: marketplaceFees
    };

    submitBtn.disabled = true; submitBtn.textContent = 'Salvando...';
    try {
      await yalcaUpdateSettings(patch);
      SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
      renderSettingsForm();
      successMsg.classList.add('is-visible');
      setTimeout(() => successMsg.classList.remove('is-visible'), 4000);
    } catch (err) {
      alert('Não foi possível salvar as configurações: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Salvar configurações';
    }
  });
});

function renderSettingsForm() {
  document.getElementById('setClientName').value = SHELL_DATA.settings.clientName;
  document.getElementById('setCashBalance').value = SHELL_DATA.settings.cashBalance;
  document.getElementById('setTaxPct').value = SHELL_DATA.settings.defaultTaxPct;
  document.getElementById('setShipping').value = SHELL_DATA.settings.defaultShippingCost;

  const feeFields = document.getElementById('settingsFeeFields');
  feeFields.innerHTML = MARKETPLACES.map(mk => `
    <div class="field">
      <label for="setFee_${mk.replace(/\s/g, '')}">${mk} (%)</label>
      <input type="number" id="setFee_${mk.replace(/\s/g, '')}" min="0" step="0.1" value="${SHELL_DATA.settings.marketplaceFees[mk] ?? 0}" data-mk="${mk}">
    </div>`).join('');
}
