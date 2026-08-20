/* =========================================
   Painel de IA pessoal — autenticação
   Mesmo Supabase Auth do resto do site (login único em
   toda a yalca.com.br), mas aprovação PRÓPRIA via
   ia_profiles/ia_admins — independente do portal da Yalca.
   ========================================= */

function iaAuthErrorMessage(error) {
  const msg = (error && error.message) || '';
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('User already registered')) return 'Já existe uma conta com esse e-mail.';
  if (msg.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return msg || 'Não foi possível completar a ação agora.';
}

async function iaSignUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email: email.trim(), password });
  if (error) return { ok: false, error: iaAuthErrorMessage(error) };
  if (!data.session) return { ok: true, pendingEmailConfirmation: true };

  const { error: profileError } = await supabaseClient.from('ia_profiles').insert({ email: email.trim() });
  if (profileError) return { ok: false, error: 'Conta criada, mas houve um erro ao registrar seu perfil: ' + profileError.message };
  return { ok: true, pendingEmailConfirmation: false };
}

async function iaLogin(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: iaAuthErrorMessage(error) };
  return { ok: true, session: data.session };
}

async function iaIsLoggedIn() {
  const { data } = await supabaseClient.auth.getSession();
  return !!data.session;
}

async function iaCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data.user || null;
}

async function iaLogout() {
  await supabaseClient.auth.signOut();
}

async function iaRequireAuth() {
  if (!(await iaIsLoggedIn())) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

async function iaGetOwnProfile() {
  const user = await iaCurrentUser();
  if (!user) return null;
  const { data, error } = await supabaseClient.from('ia_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function iaIsAdmin() {
  const user = await iaCurrentUser();
  if (!user) return false;
  const { data } = await supabaseClient.from('ia_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return !!data;
}
