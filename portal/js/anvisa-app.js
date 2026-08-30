/* =========================================
   Yalca Portal — página "Consulta Anvisa" (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;
  initAnvisaSection();
});
