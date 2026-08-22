/* =========================================
   Yalca Portal — "casco" compartilhado pelas páginas standalone
   (uma seção por página — ver pedido do cliente 2026-08-22 de separar
   o site, que até então era um SPA único em dashboard.html).

   Cuida do que é igual em toda página: gate de autenticação/aprovação,
   sidebar (colapsar, gaveta mobile, grupos expansíveis), e as ações
   globais do rodapé da sidebar (sair, carregar/substituir dados de
   exemplo). Cada página chama yalcaInitPortalShell() no DOMContentLoaded
   e, se ela devolver true, segue pra carregar e renderizar o que é
   específico daquela página.

   dashboard.html (ainda um SPA com várias seções) continua com sua
   própria cópia dessa lógica em portal-app.js — migrar pra usar este
   arquivo também é trabalho de uma etapa futura, não deste piloto.
   ========================================= */

let YALCA_PROFILE = null;
let YALCA_IS_ADMIN = false;
let SHELL_DATA = null;

async function yalcaInitPortalShell() {
  const authed = await yalcaRequireAuth();
  if (!authed) return false;

  document.getElementById('pendingLogoutBtn')?.addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });
  document.getElementById('blockedLogoutBtn')?.addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  try {
    YALCA_IS_ADMIN = await yalcaIsAdmin();
    YALCA_PROFILE = await yalcaGetOwnProfile();
  } catch (err) {
    alert('Não foi possível verificar seu acesso: ' + err.message);
    return false;
  }

  if (!YALCA_IS_ADMIN) {
    if (!YALCA_PROFILE) {
      alert('Não encontramos seu perfil de cliente. Fale com a Yalca para regularizar seu acesso.');
      await yalcaLogout();
      window.location.href = 'login.html';
      return false;
    }
    if (YALCA_PROFILE.status === 'pending') { document.getElementById('pendingScreen').style.display = 'flex'; return false; }
    if (YALCA_PROFILE.status === 'blocked') { document.getElementById('blockedScreen').style.display = 'flex'; return false; }
  }

  document.getElementById('portalShell').style.display = 'flex';
  initShellSidebar();
  bindShellGlobalActions();

  try {
    SHELL_DATA = await yalcaFetchAll(YALCA_PROFILE);
    document.getElementById('clientNameLabel').textContent = SHELL_DATA.settings.clientName;
    renderShellResetButtonLabel();
  } catch (err) {
    alert('Não foi possível carregar seus dados: ' + err.message);
    return false;
  }

  return true;
}

/* ---------- Sidebar: colapsar, gaveta mobile, grupos ----------
   Sem troca de seção por clique — cada item de menu agora é um link
   de verdade (<a href="...">), a navegação é a troca de página normal
   do navegador. */
function initShellSidebar() {
  const sidebar = document.getElementById('portalSidebar');
  const scrim = document.getElementById('portalSidebarScrim');
  const toggle = document.getElementById('sidebarToggle');
  const main = document.querySelector('.portal-main');

  function isMobileDrawer() { return window.matchMedia('(max-width: 900px)').matches; }

  function openSidebar() {
    sidebar.classList.add('is-open');
    scrim.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (isMobileDrawer()) main.setAttribute('aria-hidden', 'true');
  }
  function closeSidebar({ returnFocus = false } = {}) {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    main.removeAttribute('aria-hidden');
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) closeSidebar({ returnFocus: true });
    else openSidebar();
  });
  scrim.addEventListener('click', () => closeSidebar({ returnFocus: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sidebar.classList.contains('is-open') || !isMobileDrawer()) return;
    closeSidebar({ returnFocus: true });
  });
  sidebar.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !isMobileDrawer() || !sidebar.classList.contains('is-open')) return;
    const focusable = sidebar.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  document.querySelectorAll('.portal-nav__group-heading').forEach(heading => {
    heading.addEventListener('click', () => {
      const group = heading.closest('.portal-nav__group');
      const isOpen = group.classList.toggle('is-open');
      heading.setAttribute('aria-expanded', String(isOpen));
    });
  });

  const collapseBtn = document.getElementById('portalSidebarCollapseBtn');
  const SIDEBAR_COLLAPSE_KEY = 'yalcaSidebarCollapsed';
  function closeAllGroupFlyouts() {
    document.querySelectorAll('.portal-nav__group.is-open').forEach(g => {
      g.classList.remove('is-open');
      g.querySelector('.portal-nav__group-heading').setAttribute('aria-expanded', 'false');
    });
  }
  function setCollapsed(collapsed) {
    sidebar.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    closeAllGroupFlyouts();
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* sem persistência, sem quebra */ }
  }
  collapseBtn.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('is-collapsed')));
  try {
    if (!isMobileDrawer() && localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1') setCollapsed(true);
  } catch { /* localStorage indisponível — abre expandido, comportamento padrão */ }

  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('is-collapsed')) return;
    if (e.target.closest('.portal-nav__group')) return;
    closeAllGroupFlyouts();
  });
}

function renderShellResetButtonLabel() {
  const btn = document.getElementById('resetDemoBtn');
  if (!btn) return;
  const isEmpty = SHELL_DATA.products.length === 0 && SHELL_DATA.transactions.length === 0;
  btn.textContent = isEmpty ? '✨ Carregar dados de exemplo' : '↺ Substituir por dados de exemplo';
}

function bindShellGlobalActions() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await yalcaLogout();
    window.location.href = 'login.html';
  });

  document.getElementById('resetDemoBtn').addEventListener('click', () => {
    const isEmpty = SHELL_DATA.products.length === 0 && SHELL_DATA.transactions.length === 0;
    const confirmInput = document.getElementById('resetDemoConfirmInput');
    const confirmBtn = document.getElementById('resetDemoConfirmBtn');
    confirmInput.value = '';
    confirmBtn.disabled = true;

    if (isEmpty) {
      document.getElementById('resetDemoModalText').textContent = 'Isso vai preencher sua conta com produtos e lançamentos de exemplo, só para você conhecer as ferramentas.';
      document.getElementById('resetDemoConfirmInput').closest('.field').style.display = 'none';
      confirmBtn.disabled = false;
    } else {
      document.getElementById('resetDemoModalText').textContent = 'Isso vai APAGAR TODOS os seus produtos, lançamentos e lançamentos futuros atuais e substituir por dados de exemplo. Essa ação não pode ser desfeita.';
      document.getElementById('resetDemoConfirmInput').closest('.field').style.display = '';
    }
    openModal('resetDemoModal');
  });

  document.getElementById('resetDemoConfirmInput').addEventListener('input', (e) => {
    document.getElementById('resetDemoConfirmBtn').disabled = e.target.value.trim().toUpperCase() !== 'CONFIRMAR';
  });

  document.getElementById('resetDemoConfirmBtn').addEventListener('click', async () => {
    const isEmpty = SHELL_DATA.products.length === 0 && SHELL_DATA.transactions.length === 0;
    const btn = document.getElementById('resetDemoConfirmBtn');
    btn.disabled = true; btn.textContent = 'Aplicando...';
    try {
      if (!isEmpty) await yalcaClearAllData();
      await yalcaSeedDemoData();
      closeModal('resetDemoModal');
      window.location.reload();
    } catch (err) {
      alert('Não foi possível carregar os dados de exemplo: ' + err.message);
    } finally {
      btn.textContent = 'Substituir dados';
    }
  });
}

/* ---------- Modais (genérico) — igual ao de portal-app.js ---------- */
function initModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });
}
function openModal(id) { document.getElementById(id).classList.add('is-open'); }
function closeModal(id) { document.getElementById(id).classList.remove('is-open'); }
