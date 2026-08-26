/* =========================================
   Yalca Portal — página "Compras & Concorrência" / Keepa (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;
  initIaAgentWidget('concorrencia');

  initKeepaSection();

  try {
    await reloadKeepaData();
  } catch (err) {
    console.error('Keepa:', err);
  }
  renderKeepaSellerMetrics();
  renderKeepaTracked();
  renderKeepaAlerts();
});
