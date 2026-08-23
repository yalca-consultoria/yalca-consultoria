/* =========================================
   Yalca Portal — página de login/cadastro/recuperação de senha

   Captcha (Cloudflare Turnstile): o Supabase Auth self-hosted valida
   captcha em nível de PROJETO — uma vez ativado no servidor
   (GOTRUE_SECURITY_CAPTCHA_ENABLED), TODA chamada de login/cadastro/
   recuperação passa a exigir um captcha_token válido, não só depois de
   muitas tentativas (diferente do SaaS gerenciado, aqui não existe um
   "threshold" nativo no GoTrue). Por isso o widget carrega sempre nos
   3 formulários — em modo "managed" o Turnstile resolve sozinho e
   invisível pra a maioria dos acessos legítimos, só aparecendo uma
   interação visível quando o tráfego parece suspeito, então o efeito
   prático pra quem usa normal continua sendo "não incomoda".
   ========================================= */

let turnstileScriptLoading = null;
const turnstileWidgets = {}; // formId -> { widgetId, token }

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

async function yalcaRenderTurnstile(formKey, containerId) {
  if (!yalcaTurnstileConfigured) return;
  try {
    await yalcaLoadTurnstileScript();
    turnstileWidgets[formKey] = { widgetId: null, token: null };
    turnstileWidgets[formKey].widgetId = window.turnstile.render('#' + containerId, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'dark', // o padrão é claro e destoa totalmente do tema escuro do portal
      callback: (token) => { turnstileWidgets[formKey].token = token; },
      'expired-callback': () => { turnstileWidgets[formKey].token = null; },
      'error-callback': () => { turnstileWidgets[formKey].token = null; }
    });
  } catch (err) {
    console.error('Turnstile:', err);
  }
}

function yalcaConsumeTurnstileToken(formKey) {
  const w = turnstileWidgets[formKey];
  const token = w ? w.token : null;
  if (w && w.widgetId !== null) {
    window.turnstile.reset(w.widgetId); // token de uso único — sempre pede um novo pro próximo submit
    w.token = null;
  }
  return token;
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

  // Os 3 widgets carregam desde o início — o servidor exige o token em
  // toda chamada agora que o captcha está ativado no projeto.
  yalcaRenderTurnstile('login', 'loginTurnstile');
  yalcaRenderTurnstile('signup', 'signupTurnstile');
  yalcaRenderTurnstile('forgot', 'forgotTurnstile');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const email = loginForm.email.value;
    const password = loginForm.password.value;
    errorEl.classList.remove('is-visible');
    resendBox.classList.remove('is-visible');

    const captchaToken = yalcaConsumeTurnstileToken('login');
    if (yalcaTurnstileConfigured && !captchaToken) {
      errorTextEl.textContent = 'Aguarde a verificação de segurança carregar e tente novamente.';
      errorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaLogin(email, password, captchaToken || undefined);
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');

    if (result.ok) {
      window.location.href = 'dashboard.html';
      return;
    }

    errorTextEl.textContent = result.error;
    errorEl.classList.add('is-visible');
    if (result.code === 'email_not_confirmed') {
      resendBox.classList.add('is-visible');
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

    const captchaToken = yalcaConsumeTurnstileToken('signup');
    if (yalcaTurnstileConfigured && !captchaToken) {
      signupErrorTextEl.textContent = 'Aguarde a verificação de segurança carregar e tente novamente.';
      signupErrorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaSignUp(email, password, storeName, captchaToken || undefined);
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
    const captchaToken = yalcaConsumeTurnstileToken('forgot');
    if (yalcaTurnstileConfigured && !captchaToken) {
      forgotErrorTextEl.textContent = 'Aguarde a verificação de segurança carregar e tente novamente.';
      forgotErrorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaRequestPasswordReset(email, captchaToken || undefined);
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
