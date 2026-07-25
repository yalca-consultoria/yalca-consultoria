/* =========================================
   Yalca Portal — autenticação real (Supabase Auth)
   Fluxo: o cliente cria a própria conta (fica "pending")
   e a Yalca aprova ou bloqueia pelo painel admin.html.
   ========================================= */

async function yalcaSignUp(email, password, storeName) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente. Veja o guia de configuração.' };
  }
  const { data, error } = await supabaseClient.auth.signUp({
    email: email.trim(),
    password
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

async function yalcaLogin(email, password) {
  if (!supabaseClient) {
    return { ok: false, error: 'Configuração do Supabase pendente. Veja o guia de configuração.' };
  }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) {
    return { ok: false, error: yalcaAuthErrorMessage(error) };
  }
  return { ok: true, session: data.session };
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
  return msg || 'Não foi possível concluir. Tente novamente em instantes.';
}
