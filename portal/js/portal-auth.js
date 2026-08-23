/* =========================================
   Yalca Portal — autenticação real (Supabase Auth)
   Fluxo: o cliente cria a própria conta (fica "pending")
   e a Yalca aprova ou bloqueia pelo painel admin.html.
   ========================================= */

async function yalcaSignUp(email, password, storeName, captchaToken) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente. Veja o guia de configuração.' };
  }
  const { data, error } = await supabaseClient.auth.signUp({
    email: email.trim(),
    password,
    options: captchaToken ? { captchaToken } : undefined
  });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error) };
  }

  if (!data.session) {
    // Projeto com "Confirm email" ativado: ainda não há sessão para criar o perfil.
    return { ok: true, pendingEmailConfirmation: true };
  }

  const { error: profileError } = await supabaseClient.from('client_profiles').insert({
    email: email.trim(),
    store_name: storeName || ''
  });
  if (profileError) {
    return { ok: false, error: 'Conta criada, mas houve um erro ao registrar seu perfil: ' + profileError.message };
  }
  return { ok: true, pendingEmailConfirmation: false };
}

async function yalcaLogin(email, password, captchaToken) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente. Veja o guia de configuração.' };
  }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email.trim(),
    password,
    options: captchaToken ? { captchaToken } : undefined
  });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error), code: yalcaAuthErrorCode(error) };
  }
  return { ok: true, session: data.session };
}

// Reenvia o e-mail de confirmação de cadastro — usado quando o cliente
// tenta logar antes de confirmar (ou perdeu o e-mail original).
async function yalcaResendConfirmation(email) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente.' };
  }
  const { error } = await supabaseClient.auth.resend({ type: 'signup', email: email.trim() });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error) };
  }
  return { ok: true };
}

// Dispara o e-mail de recuperação de senha. O link do e-mail traz o
// cliente de volta pra reset-password.html (mesmo domínio — não sai do
// site), onde ele define a nova senha; o token de recuperação vem no
// próprio hash da URL, o cliente Supabase já detecta sozinho.
async function yalcaRequestPasswordReset(email) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente.' };
  }
  const redirectTo = `${window.location.origin}${window.location.pathname.replace(/login\.html$/, '')}reset-password.html`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error) };
  }
  return { ok: true };
}

// Define a nova senha — só funciona dentro da sessão de recuperação
// criada automaticamente pelo Supabase ao abrir o link do e-mail em
// reset-password.html.
async function yalcaUpdatePassword(newPassword) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente.' };
  }
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error) };
  }
  return { ok: true };
}

async function yalcaIsLoggedIn() {
  if (!supabaseClient) return false;
  const { data } = await supabaseClient.auth.getSession();
  return !!data.session;
}

async function yalcaCurrentUser() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getUser();
  return data.user || null;
}

async function yalcaLogout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function yalcaRequireAuth() {
  const logged = await yalcaIsLoggedIn();
  if (!logged) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

/* ---------- Perfil de aprovação e administração ---------- */

async function yalcaGetOwnProfile() {
  const user = await yalcaCurrentUser();
  if (!user) return null;
  const { data, error } = await supabaseClient
    .from('client_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function yalcaIsAdmin() {
  const user = await yalcaCurrentUser();
  if (!user) return false;
  const { data, error } = await supabaseClient
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

function yalcaAuthErrorMessage(error) {
  const msg = error && error.message ? error.message : '';
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('Email not confirmed')) return 'Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
  if (msg.includes('User already registered')) return 'Já existe uma conta com este e-mail. Tente entrar em vez de criar uma nova conta.';
  if (msg.includes('Password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (msg.includes('captcha')) return 'Não foi possível validar a verificação de segurança. Tente novamente.';
  if (msg.includes('rate limit') || msg.includes('Too many requests')) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  return msg || 'Não foi possível concluir. Tente novamente em instantes.';
}

// Código curto pra UI decidir ações específicas (ex: mostrar botão de
// reenviar confirmação) sem ter que re-checar a string da mensagem.
function yalcaAuthErrorCode(error) {
  const msg = error && error.message ? error.message : '';
  if (msg.includes('Email not confirmed')) return 'email_not_confirmed';
  if (msg.includes('Invalid login credentials')) return 'invalid_credentials';
  return null;
}
