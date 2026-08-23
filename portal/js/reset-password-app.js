/* =========================================
   Yalca Portal — página "Nova senha" (link de recuperação)
   O Supabase client detecta sozinho o token de recuperação que vem no
   hash da URL (#access_token=...&type=recovery) e dispara o evento
   PASSWORD_RECOVERY — a partir daí updateUser({password}) já funciona
   dentro dessa sessão temporária, sem precisar de mais nada.
   ========================================= */

document.addEventListener('DOMContentLoaded', () => {
  const waitingView = document.getElementById('resetWaitingView');
  const formView = document.getElementById('resetFormView');
  const invalidView = document.getElementById('resetInvalidView');
  const successView = document.getElementById('resetSuccessView');
  const resetForm = document.getElementById('resetForm');
  const errorEl = document.getElementById('resetError');
  const errorTextEl = document.getElementById('resetErrorText');

  function showView(view) {
    waitingView.style.display = view === 'waiting' ? 'block' : 'none';
    formView.style.display = view === 'form' ? 'block' : 'none';
    invalidView.style.display = view === 'invalid' ? 'block' : 'none';
    successView.style.display = view === 'success' ? 'block' : 'none';
  }

  if (!yalcaSupabaseConfigured || !supabaseClient) {
    showView('invalid');
    return;
  }

  const toggleBtn = document.getElementById('toggleRpPassword');
  const passwordInput = document.getElementById('rpPassword');
  toggleBtn.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    toggleBtn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  });

  let resolved = false;

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      resolved = true;
      showView('form');
    }
  });

  // Se o link já expirou ou é inválido, nenhum evento PASSWORD_RECOVERY
  // chega — depois de um tempo razoável de espera, assume que falhou.
  setTimeout(() => {
    if (!resolved) showView('invalid');
  }, 4000);

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = resetForm.querySelector('button[type="submit"]');
    errorEl.classList.remove('is-visible');

    const password = resetForm.password.value;
    const passwordConfirm = resetForm.passwordConfirm.value;
    if (password !== passwordConfirm) {
      errorTextEl.textContent = 'As senhas não coincidem.';
      errorEl.classList.add('is-visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('btn--loading');
    const result = await yalcaUpdatePassword(password);
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');

    if (!result.ok) {
      errorTextEl.textContent = result.error;
      errorEl.classList.add('is-visible');
      return;
    }

    await yalcaLogout();
    showView('success');
  });
});
