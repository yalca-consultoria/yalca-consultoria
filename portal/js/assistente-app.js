/* =========================================
   Yalca Portal — página "Assistente IA" (standalone)
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await yalcaInitPortalShell();
  if (!ok) return;

  initIaSection();
});
