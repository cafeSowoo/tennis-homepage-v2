import { createClient } from "npm:@supabase/supabase-js@2.116.0"
import ICAL from "npm:ical.js@2.2.1"
import { parseIcsEvents } from "./ics.mjs"

// Read-only proxy: browsers cannot fetch Google/iCloud .ics feeds directly (no CORS).
// The feed URL comes from the caller's own device on every request and is never stored or logged.

const MAX_FEED_BYTES = 5 * 1024 * 1024
const MAX_RANGE_DAYS = 500
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-review-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

function getPublishableKey(): string | null {
  const modernKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if (modernKeys) {
    try {
      const parsed = JSON.parse(modernKeys)
      if (typeof parsed?.default === "string" && parsed.default) return parsed.default
    } catch {
      // Fall through to the legacy anon key.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || null
}

function allowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "calendar.google.com" ||
    host.endsWith(".icloud.com") ||
    host === "outlook.live.com" ||
    host === "outlook.office365.com"
}

export function normalizeFeedUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/^webcals?:\/\//i, "https://")
  if (!trimmed || trimmed.length > 2048) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null
  return allowedHost(url.hostname) ? url : null
}

// Review mode (shared password) sends its access token; Kakao-login members send their session JWT.
async function requireClubAccess(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const publishableKey = getPublishableKey()
  if (!supabaseUrl || !publishableKey) return { ok: false as const, status: 500, error: "Supabase configuration is unavailable." }

  const reviewToken = req.headers.get("x-review-token") || ""
  if (reviewToken) {
    const anon = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await anon.rpc("review_access_check", { p_token: reviewToken })
    if (!error && data === true) return { ok: true as const }
    return { ok: false as const, status: 401, error: "Review access expired." }
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) return { ok: false as const, status: 401, error: "Login required." }
  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.slice("Bearer ".length))
  if (userError || !userData.user) return { ok: false as const, status: 401, error: "Valid login required." }

  const { data: account, error: accountError } = await supabase
    .from("club_member_accounts")
    .select("member_id,status")
    .eq("user_id", userData.user.id)
    .maybeSingle()
  if (accountError || !account || account.status !== "approved" || !account.member_id) {
    return { ok: false as const, status: 403, error: "Approved club member required." }
  }
  return { ok: true as const }
}

async function fetchFeed(start: URL): Promise<{ ok: true; text: string } | { ok: false; status: number; code: string }> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      return { ok: false, status: 502, code: "FEED_UNREACHABLE" }
    }
    if (response.status >= 300 && response.status < 400) {
      const next = normalizeFeedUrl(new URL(response.headers.get("location") || "", url).toString())
      await response.body?.cancel()
      if (!next) return { ok: false, status: 502, code: "FEED_REDIRECT_BLOCKED" }
      url = next
      continue
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      await response.body?.cancel()
      return { ok: false, status: 404, code: "FEED_NOT_FOUND" }
    }
    if (!response.ok) {
      await response.body?.cancel()
      return { ok: false, status: 502, code: "FEED_ERROR" }
    }
    const declared = Number(response.headers.get("content-length") || 0)
    if (declared > MAX_FEED_BYTES) {
      await response.body?.cancel()
      return { ok: false, status: 413, code: "FEED_TOO_LARGE" }
    }
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, status: 502, code: "FEED_ERROR" }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FEED_BYTES) {
        await reader.cancel()
        return { ok: false, status: 413, code: "FEED_TOO_LARGE" }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { ok: true, text: new TextDecoder().decode(bytes) }
  }
  return { ok: false, status: 502, code: "FEED_REDIRECT_BLOCKED" }
}

function rangeDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "POST required." }, 405)

  const access = await requireClubAccess(req)
  if (!access.ok) return jsonResponse({ error: access.error, code: "ACCESS_DENIED" }, access.status)

  let body: { url?: unknown; from?: unknown; to?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "JSON body required.", code: "BAD_REQUEST" }, 400)
  }

  const feedUrl = normalizeFeedUrl(body?.url)
  if (!feedUrl) return jsonResponse({ error: "Unsupported calendar link.", code: "UNSUPPORTED_URL" }, 400)
  const from = typeof body.from === "string" ? body.from : ""
  const to = typeof body.to === "string" ? body.to : ""
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return jsonResponse({ error: "Invalid range.", code: "BAD_REQUEST" }, 400)
  const days = rangeDays(from, to)
  if (!(days > 0 && days <= MAX_RANGE_DAYS)) return jsonResponse({ error: "Invalid range.", code: "BAD_REQUEST" }, 400)

  const feed = await fetchFeed(feedUrl)
  if (!feed.ok) return jsonResponse({ error: "Calendar feed could not be loaded.", code: feed.code }, feed.status)

  try {
    const { events, truncated } = parseIcsEvents(ICAL, feed.text, { from, to })
    return jsonResponse({ events, truncated, from, to, fetchedAt: new Date().toISOString() })
  } catch {
    return jsonResponse({ error: "Calendar feed could not be read.", code: "INVALID_ICS" }, 422)
  }
})
