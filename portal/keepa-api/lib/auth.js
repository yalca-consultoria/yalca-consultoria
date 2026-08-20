// Verifica o token do usuário chamador via GoTrue (o serviço de auth do
// Supabase, já rodando no mesmo stack self-hosted) — mesma verificação que
// supabaseAdmin.auth.getUser(token) fazia na Edge Function antiga, só que
// direto por fetch() em vez do SDK completo do supabase-js (que puxa muito
// mais código do que uma chamada REST simples precisa).
function makeAuthClient({ supabaseUrl, anonKey }) {
  async function getUserFromToken(token) {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  }
  return { getUserFromToken };
}

module.exports = { makeAuthClient };
