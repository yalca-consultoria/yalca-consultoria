/* =========================================
   Yalca Portal — tela de entrada
   Três visões na mesma página: entrar, criar conta
   e recuperar senha.
   ========================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const el = (id) => document.getElementById(id);
  const views = { login: el('loginView'), signup: el('signupView'), reset: el('resetView') };

  if (!yalcaSupabaseConfigured) {
    el('configWarning').classList.add('is-visible');
    el('loginForm').querySelector('button[type="submit"]').disabled = true;
  } else if (await yalcaIsLoggedIn()) {
    window.location.replace('dashboard.html');
    return;
  }

  function showView(name) {
    Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
    clearMessages();
    const first = views[name].querySelector('input');
    if (first) first.focus();
  }

  function clearMessages() {
    document.querySelectorAll('.login-error:not(#configWarning), .form-success').forEach(p => {
      p.classList.remove('is-visible');
      p.textContent = '';
    });
  }

  function fail(id, message) {
    const p = el(id);
    p.textContent = message;
    p.classList.add('is-visible');
  }

  function succeed(id, message) {
    const p = el(id);
    p.textContent = message;
    p.classList.add('is-visible');
  }

  el('showSignup').addEventListener('click', () => showView('signup'));
  el('showReset').addEventListener('click', () => showView('reset'));
  document.querySelectorAll('[data-show]').forEach(btn =>
    btn.addEventListener('click', () => showView(btn.dataset.show))
  );

  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = el(btn.dataset.togglePassword);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      btn.textContent = showing ? '👁' : '🙈';
    });
  });

  async function withBusy(form, label, fn) {
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); }
    finally { btn.disabled = false; btn.textContent = original; }
  }

  /* ---------- Entrar ---------- */
  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const email = el('email').value.trim();
    const password = el('password').value;
    if (!email || !password) return fail('loginError', 'Preencha e-mail e senha.');

    await withBusy(e.target, 'Entrando…', async () => {
      const result = await yalcaLogin(email, password);
      if (!result.ok) return fail('loginError', result.error);
      window.location.href = 'dashboard.html';
    });
  });

  /* ---------- Criar conta ---------- */
  el('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const storeName = el('suStoreName').value.trim();
    const email = el('suEmail').value.trim();
    const password = el('suPassword').value;
    const confirm = el('suPasswordConfirm').value;

    if (!storeName || !email || !password) return fail('signupError', 'Preencha todos os campos.');
    if (password.length < 6) return fail('signupError', 'A senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return fail('signupError', 'As senhas não são iguais.');

    await withBusy(e.target, 'Criando…', async () => {
      const result = await yalcaSignUp(email, password, storeName);
      if (!result.ok) return fail('signupError', result.error);
      if (result.pendingEmailConfirmation) {
        succeed('signupSuccess', 'Conta criada. Confirme o e-mail que enviamos e depois entre aqui — a Yalca libera seu acesso em seguida.');
      } else {
        succeed('signupSuccess', 'Conta criada. Estamos levando você para o painel…');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
      }
      e.target.reset();
    });
  });

  /* ---------- Recuperar senha ---------- */
  el('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const email = el('rsEmail').value.trim();
    if (!email) return fail('resetError', 'Informe o e-mail da sua conta.');

    await withBusy(e.target, 'Enviando…', async () => {
      const result = await yalcaRequestPasswordReset(email);
      // Não confirmamos se o e-mail existe: isso vazaria quem é cliente.
      if (!result.ok) return fail('resetError', result.error);
      succeed('resetSuccess', 'Se existir uma conta com esse e-mail, o link de recuperação já está a caminho. Confira também a caixa de spam.');
      e.target.reset();
    });
  });
});
