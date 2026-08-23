/* =========================================
   Yalca Portal — página de login/cadastro/recuperação de senha
   Captcha (Cloudflare Turnstile) só aparece depois de algumas
   tentativas de login com credenciais erradas — não incomoda quem
   erra a senha uma vez só, mas trava tentativas automatizadas em
   sequência. O bloqueio de verdade acontece no servidor (Supabase
   Auth valida o token com a Secret Key); o widget aqui é só a
   metade visível do mecanismo.
   ========================================= */

const LOGIN_FAIL_THRESHOLD = 3;
const LOGIN_FAIL_STORAGE_KEY = 'yalcaLoginFailCount';

let turnstileWidgetId = null;
let turnstileToken = null;
let turnstileScriptLoading = null;

function yalcaLoadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptLoading) return turnstileScriptLoading;
  turnstileScriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Não foi possível carregar a verificação de segurança.'));
    document.head.appendChild(script);
  });
  return turnstileScriptLoading;
}

function yalcaGetFailCount() {
  return Number(sessionStorage.getItem(LOGIN_FAIL_STORAGE_KEY) || '0');
}
function yalcaBumpFailCount() {
  const next = yalcaGetFailCount() + 1;
  sessionStorage.setItem(LOGIN_FAIL_STORAGE_KEY, String(next));
  return next;
}
function yalcaResetFailCount() {
  sessionStorage.removeItem(LOGIN_FAIL_STORAGE_KEY);
}

document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const signupView = document.getElementById('signupView');
  const forgotView = document.getElementById('forgotView');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const forgotForm = document.getElementById('forgotForm');
  const errorEl = document.getElementById('loginError');
  const errorTextEl = document.getElementById('loginErrorText');
  const signupErrorEl = document.getElementById('signupError');
  const signupErrorTextEl = document.getElementById('signupErrorText');
  const signupSuccessEl = document.getElementById('signupSuccess');
  const forgotErrorEl = document.getElementById('forgotError');
  const forgotErrorTextEl = document.getElementById('forgotErrorText');
  const forgotSuccessEl = document.getElementById('forgotSuccess');
  const configWarning = document.getElementById('configWarning');
  const resendBox = document.getElementById('resendConfirmationBox');
  const resendBtn = document.getElementById('resendConfirmationBtn');
  const captchaWrap = document.getElementById('loginCaptchaWrap');

  function showView(view) {
    loginView.style.display = view === 'login' ? 'block' : 'none';
    signupView.style.display = view === 'signup' ? 'block' : 'none';
    forgotView.style.display = view === 'forgot' ? 'block' : 'none';
  }

  document.getElementById('showSignup').addEventListener('click', (e) => { e.preventDefault(); showView('signup'); });
  document.getElementById('showLogin').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
  document.getElementById('showForgot').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('fpEmail').value = loginForm.email.value || '';
    showView('forgot');
  });
  document.getElementById('showLoginFromForgot').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

  // Mostrar/ocultar senha — só muda o type do input, não guarda nada.
  function wirePasswordToggle(toggleId, inputEl) {
    const btn = document.getElementById(toggleId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const showing = inputEl.type === 'text';
      inputEl.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    });
  }
  wirePasswordToggle('togglePassword', document.getElementById('password'));
  wirePasswordToggle('toggleSuPassword', document.getElementById('suPassword'));

  if (!yalcaSupabaseConfigured) {
    configWarning.classList.add('is-visible');
    loginForm.querySelector('button[type="submit"]').disabled = true;
    signupForm.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  if (await yalcaIsLoggedIn()) {
    window.location.href = 'dashboard.html';
    return;
  }

  // Se já passamos do limite de tentativas nesta sessão (ex: usuário
  // recarregou a página no meio de um ataque manual), mostra o captcha
  // direto em vez de esperar mais uma tentativa falhar.
  async function maybeShowCaptcha() {
    if (yalcaGetFailCount() < LOGIN_FAIL_THRESHOLD) return;
    captchaWrap.classList.add('is-visible');
    if (!yalcaTurnstileConfigured) return; // placeholder ainda não trocado — não trava o login por isso
    try {
      await yalcaLoadTurnstileScript();
      if (turnstileWidgetId === null) {
        turnstileWidgetId = window.turnstile.render('#loginTurnstile', {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => { turnstileToken = token; },
          'expired-callback': () => { turnstileToken = null; },
          'error-callback': () => { turnstileToken = null; }
        });
      }
    } catch (err) {
      console.error('Turnstile:', err);
    }
  }
  await maybeShowCaptcha();

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const email = loginForm.email.value;
    const password = loginForm.password.value;
    errorEl.classList.remove('is-visible');
    resendBox.classList.remove('is-visible');

    const captchaRequired = captchaWrap.classList.contains('is-visible') && yalcaTurnstileConfigured;
    if (captchaRequired && !turnstileToken) {
      errorTextEl.textContent = 'Confirme a verificação de segurança antes de continuar.';
      errorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaLogin(email, password, turnstileToken || undefined);

    // Token do Turnstile é de uso único — sempre pede um novo depois de
    // qualquer tentativa de submit, sucesso ou falha.
    if (turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
      turnstileToken = null;
    }

    if (result.ok) {
      yalcaResetFailCount();
      window.location.href = 'dashboard.html';
      return;
    }

    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');
    errorTextEl.textContent = result.error;
    errorEl.classList.add('is-visible');

    if (result.code === 'email_not_confirmed') {
      resendBox.classList.add('is-visible');
    }

    const failCount = yalcaBumpFailCount();
    if (failCount >= LOGIN_FAIL_THRESHOLD) {
      await maybeShowCaptcha();
    }
  });

  resendBtn.addEventListener('click', async () => {
    const email = loginForm.email.value;
    if (!email) {
      errorTextEl.textContent = 'Preencha seu e-mail no campo acima primeiro.';
      errorEl.classList.add('is-visible');
      return;
    }
    resendBtn.disabled = true;
    resendBtn.textContent = 'Enviando...';
    const result = await yalcaResendConfirmation(email);
    resendBtn.disabled = false;
    resendBtn.textContent = 'Reenviar confirmação';
    if (result.ok) {
      resendBox.innerHTML = 'E-mail de confirmação reenviado! Verifique sua caixa de entrada (e o spam).';
    } else {
      errorTextEl.textContent = result.error;
      errorEl.classList.add('is-visible');
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = signupForm.querySelector('button[type="submit"]');
    signupErrorEl.classList.remove('is-visible');
    signupSuccessEl.classList.remove('is-visible');

    const storeName = signupForm.storeName.value;
    const email = signupForm.email.value;
    const password = signupForm.password.value;
    const passwordConfirm = signupForm.passwordConfirm.value;

    if (password !== passwordConfirm) {
      signupErrorTextEl.textContent = 'As senhas não coincidem.';
      signupErrorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaSignUp(email, password, storeName);
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');

    if (!result.ok) {
      signupErrorTextEl.textContent = result.error;
      signupErrorEl.classList.add('is-visible');
      return;
    }

    signupForm.reset();
    signupForm.style.display = 'none';
    signupSuccessEl.classList.add('is-visible');
    signupSuccessEl.textContent = result.pendingEmailConfirmation
      ? 'Quase lá! Confirme seu e-mail pelo link que enviamos e depois aguarde a liberação de acesso.'
      : 'Conta criada! Assim que a Yalca aprovar seu acesso, você poderá entrar por aqui.';
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = forgotForm.querySelector('button[type="submit"]');
    forgotErrorEl.classList.remove('is-visible');
    forgotSuccessEl.classList.remove('is-visible');

    const email = forgotForm.email.value;
    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaRequestPasswordReset(email);
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');

    if (!result.ok) {
      forgotErrorTextEl.textContent = result.error;
      forgotErrorEl.classList.add('is-visible');
      return;
    }

    forgotForm.reset();
    forgotForm.style.display = 'none';
    forgotSuccessEl.classList.add('is-visible');
    forgotSuccessEl.textContent = 'Se esse e-mail tiver uma conta, enviamos um link de recuperação. Confira sua caixa de entrada (e o spam).';
  });
});
