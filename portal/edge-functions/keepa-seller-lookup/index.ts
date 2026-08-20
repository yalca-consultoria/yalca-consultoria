// Yalca Portal — Edge Function: keepa-seller-lookup
// Busca reputação de vendedor (nome, avaliação, tem FBA) — ação SEPARADA
// da busca de produto (keepa-search) porque tem custo de token à parte:
// 1 token por vendedor consultado no endpoint /seller do Keepa, contra
// só o custo já embutido na busca de produto pra tudo mais.
//
// É uma função própria, não um modo do keepa-search, porque o formato
// da requisição, o contador de limite, o endpoint do Keepa e a tabela
// de cache são todos diferentes — encaixar isso num flag do
// keepa-search significaria ramificar quase toda a lógica existente.
//
// Roda em: https://api.yalca.com.br/functions/v1/keepa-seller-lookup
//
// Mesma nota de autenticação do keepa-search: FUNCTIONS_VERIFY_JWT=false
// nesse deploy self-hosted, então a verificação do JWT é manual aqui
// também (supabaseAdmin.auth.getUser(token)), sem usar @supabase/server.
//
// Deploy: copiar pra
//   /opt/supabase-src/docker/volumes/functions/keepa-seller-lookup/index.ts
// na VPS, depois `docker restart supabase-edge-functions` (não precisa
// recriar o container — usa as mesmas env vars que o keepa-search já tem).

import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const KEEPA_API_KEY = Deno.env.get("KEEPA_API_KEY")
const KEEPA_MOCK = Deno.env.get("KEEPA_MOCK") === "true"
const ALLOWED_ORIGIN = Deno.env.get("PORTAL_ORIGIN") || "https://www.yalca.com.br"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const MAX_SELLER_IDS_PER_REQUEST = 50 // margem de segurança sob o limite de 100/lote documentado pelo Keepa

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  })
}

// Formato do envelope da resposta de /seller não foi confirmado ao vivo
// (só os campos de cada Seller individual foram verificados na fonte
// oficial) — trata tanto "sellers" como mapa {id: obj} quanto como
// array de objetos com sellerId embutido, e resolve isso de vez no
// primeiro teste real.
function normalizeSellersResponse(json: any): Record<string, any> {
  if (json.sellers && typeof json.sellers === "object" && !Array.isArray(json.sellers)) {
    return json.sellers
  }
  if (Array.isArray(json.sellers)) {
    const out: Record<string, any> = {}
    for (const s of json.sellers) if (s?.sellerId) out[s.sellerId] = s
    return out
  }
  return {}
}

function parseSeller(s: any) {
  return {
    sellerName: s.sellerName ?? null,
    currentRating: typeof s.currentRating === "number" ? s.currentRating : null,
    currentRatingCount: typeof s.currentRatingCount === "number" ? s.currentRatingCount : null,
    hasFBA: !!s.hasFBA,
    ratingBreakdown: {
      positive: s.positiveRating ?? null,
      negative: s.negativeRating ?? null,
      neutral: s.neutralRating ?? null,
    },
    trackedSinceRaw: typeof s.trackedSince === "number" ? s.trackedSince : null,
  }
}

function mockSellerResponse(sellerIds: string[]) {
  const sellers: Record<string, any> = {}
  sellerIds.forEach((id, i) => {
    sellers[id] = {
      sellerName: `Vendedor Mock ${i + 1}`,
      currentRating: 90 + i,
      currentRatingCount: 1000 * (i + 1),
      hasFBA: i % 2 === 0,
      positiveRating: { lifetime: 90 + i },
      negativeRating: { lifetime: 2 },
      neutralRating: { lifetime: 3 },
      trackedSince: 5000000,
    }
  })
  return { sellers, tokensLeft: 999, tokensConsumed: 0 }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return jsonResponse(204, {})
    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, reason: "method_not_allowed", message: "Método não permitido." })
    }

    // --- autenticação (mesmo padrão do keepa-search, ver nota no topo) ---
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!token) {
      return jsonResponse(401, { ok: false, reason: "unauthenticated", message: "Sessão inválida. Faça login novamente." })
    }
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) {
      return jsonResponse(401, { ok: false, reason: "unauthenticated", message: "Sessão inválida. Faça login novamente." })
    }
    const userId = userData.user.id

    let body: { sellerIds?: string[] }
    try {
      body = await req.json()
    } catch {
      return jsonResponse(400, { ok: false, reason: "invalid_body", message: "Requisição inválida." })
    }
    const requested = Array.isArray(body.sellerIds) ? [...new Set(body.sellerIds.filter((s) => typeof s === "string" && s.length > 0))] : []
    if (requested.length === 0) {
      return jsonResponse(400, { ok: false, reason: "invalid_body", message: "Nenhum vendedor informado." })
    }
    if (requested.length > MAX_SELLER_IDS_PER_REQUEST) {
      return jsonResponse(400, { ok: false, reason: "too_many", message: `Máximo de ${MAX_SELLER_IDS_PER_REQUEST} vendedores por vez.` })
    }

    // --- aprovação do cliente ---
    const { data: profile } = await supabaseAdmin.from("client_profiles").select("status").eq("user_id", userId).maybeSingle()
    const { data: adminRow } = await supabaseAdmin.from("admins").select("user_id").eq("user_id", userId).maybeSingle()
    if (profile?.status !== "approved" && !adminRow) {
      return jsonResponse(200, { ok: false, reason: "not_approved", message: "Seu acesso ainda não foi aprovado pela Yalca." })
    }

    const { data: config } = await supabaseAdmin.from("keepa_config").select("*").eq("id", 1).single()
    const cacheMaxAgeMs = (config?.seller_reputation_cache_max_age_days ?? 30) * 86400000

    // --- separa quem já está fresco no cache de quem falta buscar ---
    const { data: cachedRows } = await supabaseAdmin.from("keepa_seller_cache").select("*").in("seller_id", requested)
    const cachedById = Object.fromEntries((cachedRows ?? []).map((r: any) => [r.seller_id, r]))
    const fresh: string[] = []
    const missing: string[] = []
    for (const id of requested) {
      const row = cachedById[id]
      const ageMs = row?.fetched_at ? Date.now() - new Date(row.fetched_at).getTime() : Infinity
      if (row && ageMs < cacheMaxAgeMs) fresh.push(id)
      else missing.push(id)
    }

    const result: Record<string, any> = {}
    for (const id of fresh) {
      const row = cachedById[id]
      result[id] = {
        sellerName: row.seller_name,
        currentRating: row.current_rating,
        currentRatingCount: row.current_rating_count,
        hasFBA: row.has_fba,
      }
    }

    // Uma busca 100% em cache não mexe em limite/orçamento nenhum —
    // é o mecanismo concreto que torna essa ação "de graça quando já
    // vista antes, custa quando é nova".
    if (missing.length === 0) {
      return jsonResponse(200, { ok: true, sellers: result })
    }

    // --- limite diário de vendedores consultados por cliente ---
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const { data: lookupsToday } = await supabaseAdmin
      .from("keepa_token_usage_log")
      .select("tokens_consumed")
      .eq("user_id", userId)
      .eq("triggered_by", "on_demand_seller_lookup")
      .gte("called_at", startOfDay.toISOString())
    const sellersLookedUpToday = (lookupsToday ?? []).reduce((sum: number, r: any) => sum + (r.tokens_consumed ?? 0), 0)
    if (sellersLookedUpToday + missing.length > (config?.max_seller_lookups_per_client_per_day ?? 50)) {
      return jsonResponse(200, { ok: false, reason: "client_cap", message: "Você atingiu o limite diário de consultas de reputação de vendedor.", sellers: result })
    }

    // --- orçamento global de tokens (custo aqui é exato, não estimativa: 1 por vendedor) ---
    const { data: budget } = await supabaseAdmin.from("keepa_token_budget").select("*").eq("id", 1).single()
    const todayStr = new Date().toISOString().slice(0, 10)
    const spentToday = budget?.spend_day === todayStr ? (budget?.tokens_spent_today ?? 0) : 0
    const cap = config?.daily_token_cap ?? 200
    if (spentToday + missing.length > cap) {
      return jsonResponse(200, { ok: false, reason: "no_budget", message: "Sem cota de consultas disponível hoje. Tente novamente amanhã.", sellers: result })
    }

    // --- chamada real (em lote) ao Keepa, ou mock ---
    let sellersRaw: Record<string, any>
    let tokensLeft: number | null = null
    let tokensConsumed: number | null = null
    try {
      if (KEEPA_MOCK) {
        const mock = mockSellerResponse(missing)
        sellersRaw = mock.sellers
        tokensLeft = mock.tokensLeft
        tokensConsumed = mock.tokensConsumed
      } else {
        if (!KEEPA_API_KEY) throw new Error("KEEPA_API_KEY não configurada no ambiente da função")
        const url = `https://api.keepa.com/seller?key=${KEEPA_API_KEY}&domain=12&seller=${missing.join(",")}`
        const res = await fetch(url)
        const json = await res.json()
        if (json.error) throw new Error(`Keepa: ${json.error.message ?? JSON.stringify(json.error)}`)
        sellersRaw = normalizeSellersResponse(json)
        tokensLeft = typeof json.tokensLeft === "number" ? json.tokensLeft : null
        tokensConsumed = typeof json.tokensConsumed === "number" ? json.tokensConsumed : null
      }
    } catch (err) {
      await supabaseAdmin.from("keepa_token_usage_log").insert({
        triggered_by: "on_demand_seller_lookup",
        user_id: userId,
        success: false,
        error_message: String(err instanceof Error ? err.message : err),
      })
      return jsonResponse(502, { ok: false, reason: "keepa_error", message: "Não foi possível consultar a reputação agora. Tente novamente em instantes.", sellers: result })
    }

    const nowIso = new Date().toISOString()
    const upsertRows = missing.map((id) => {
      const raw = sellersRaw[id]
      if (!raw) {
        return { seller_id: id, seller_name: null, fetched_at: nowIso, last_error: "not_found_at_keepa" }
      }
      const parsed = parseSeller(raw)
      result[id] = { sellerName: parsed.sellerName, currentRating: parsed.currentRating, currentRatingCount: parsed.currentRatingCount, hasFBA: parsed.hasFBA }
      return {
        seller_id: id,
        seller_name: parsed.sellerName,
        current_rating: parsed.currentRating,
        current_rating_count: parsed.currentRatingCount,
        has_fba: parsed.hasFBA,
        rating_breakdown: parsed.ratingBreakdown,
        tracked_since_raw: parsed.trackedSinceRaw,
        fetched_at: nowIso,
        last_error: null,
      }
    })
    await supabaseAdmin.from("keepa_seller_cache").upsert(upsertRows)

    const consumedForBudget = tokensConsumed ?? missing.length
    await supabaseAdmin.from("keepa_token_budget").update({
      last_known_tokens_left: tokensLeft,
      last_checked_at: nowIso,
      tokens_spent_today: spentToday + consumedForBudget,
      spend_day: todayStr,
    }).eq("id", 1)

    await supabaseAdmin.from("keepa_token_usage_log").insert({
      triggered_by: "on_demand_seller_lookup",
      user_id: userId,
      tokens_before: tokensLeft !== null ? tokensLeft + consumedForBudget : null,
      tokens_after: tokensLeft,
      tokens_consumed: consumedForBudget,
      success: true,
    })

    return jsonResponse(200, { ok: true, sellers: result })
  },
}
