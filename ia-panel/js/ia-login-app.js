document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const signupView = document.getElementById('signupView');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const errorEl = document.getElementById('loginError');
  const signupErrorEl = document.getElementById('signupError');
  const signupSuccessEl = document.getElementById('signupSuccess');

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

  if (await iaIsLoggedIn()) {
    window.location.href = 'app.html';
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
    const result = await iaLogin(email, password);
    if (result.ok) {
      window.location.href = 'app.html';
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
    const result = await iaSignUp(email, password);
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
      : 'Conta criada! Assim que for aprovada, você poderá entrar por aqui.';
  });
});
