document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const signupView = document.getElementById('signupView');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const errorEl = document.getElementById('loginError');
  const signupErrorEl = document.getElementById('signupError');
  const signupSuccessEl = document.getElementById('signupSuccess');
  const configWarning = document.getElementById('configWarning');

  document.getElementById('showSignup').addEventListener('click', (e) => {
    e.preventDefault();
    loginView.style.display = 'none';
    signupView.style.display = 'block';
  });
  document.getElementById('showLogin').addEventListener('click', (e) => {
    e.preventDefault();
    signupView.style.display = 'none';
    loginView.style.display = 'block';
  });

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

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const email = loginForm.email.value;
    const password = loginForm.password.value;
    errorEl.classList.remove('is-visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';
    const result = await yalcaLogin(email, password);
    if (result.ok) {
      window.location.href = 'dashboard.html';
    } else {
      errorEl.textContent = result.error;
      errorEl.classList.add('is-visible');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
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
      signupErrorEl.textContent = 'As senhas não coincidem.';
      signupErrorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Criando conta...';
    const result = await yalcaSignUp(email, password, storeName);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Criar conta';

    if (!result.ok) {
      signupErrorEl.textContent = result.error;
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
});
