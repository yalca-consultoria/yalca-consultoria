// Cliente REST pro PostgREST do Supabase (a mesma API que o navegador já
// usa), com a service_role key — bypassa RLS de propósito, igual o
// service-role client que a Edge Function antiga usava. fetch() + JSON
// evita ter que montar SQL à mão (risco de escaping) e evita depender do
// pacote @supabase/supabase-js (que puxa bem mais código do que precisamos
// aqui — só fazemos select/insert/update/upsert simples).

function makeRestClient({ supabaseUrl, serviceRoleKey }) {
  const REST = `${supabaseUrl}/rest/v1`;
  const HEADERS = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  async function restGet(table, query) {
    const res = await fetch(`${REST}/${table}?${query}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET ${table} falhou: ${res.status} ${await res.text()}`);
    return res.json();
  }
  async function restGetOne(table, query) {
    const rows = await restGet(table, query);
    return rows[0] ?? null;
  }
  async function restUpsert(table, rows, onConflict) {
    const res = await fetch(`${REST}/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`UPSERT ${table} falhou: ${res.status} ${await res.text()}`);
    return res.json();
  }
  async function restInsert(table, rows) {
    const res = await fetch(`${REST}/${table}`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`INSERT ${table} falhou: ${res.status} ${await res.text()}`);
  }
  async function restUpdate(table, query, patch) {
    const res = await fetch(`${REST}/${table}?${query}`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`UPDATE ${table} falhou: ${res.status} ${await res.text()}`);
  }
  async function restCount(table, query) {
    const res = await fetch(`${REST}/${table}?${query}`, { headers: { ...HEADERS, Prefer: 'count=exact', Range: '0-0' } });
    if (!res.ok) throw new Error(`COUNT ${table} falhou: ${res.status} ${await res.text()}`);
    const contentRange = res.headers.get('content-range') || '';
    const total = contentRange.split('/')[1];
    return total && total !== '*' ? Number(total) : 0;
  }

  return { restGet, restGetOne, restUpsert, restInsert, restUpdate, restCount };
}

module.exports = { makeRestClient };
