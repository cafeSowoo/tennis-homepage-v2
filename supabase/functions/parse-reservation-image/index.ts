import { createClient } from "npm:@supabase/supabase-js@2.116.0"
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors"

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_MODEL = "qwen/qwen3.8-27b"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schedules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          use_date: { type: ["string", "null"] },
          start_time: { type: ["string", "null"] },
          end_time: { type: ["string", "null"] },
          facility_name: { type: ["string", "null"] },
          court_number: { type: ["string", "null"] },
          status: { type: ["string", "null"] },
          application_date: { type: ["string", "null"] },
          notification_date: { type: ["string", "null"] },
        },
        required: [
          "use_date",
          "start_time",
          "end_time",
          "facility_name",
          "court_number",
          "status",
          "application_date",
          "notification_date",
        ],
      },
    },
  },
  required: ["schedules"],
}

const prompt = `이 이미지는 테니스 시설 예약/신청/당첨 화면 또는 문자 캡처다.
이미지에 실제로 표시된 정보만 읽어서 스키마대로 반환하라.

규칙:
- 한 이미지에 실제 이용 일정이 여러 개 있으면 모두 schedules에 별도 객체로 넣는다.
- 표 형식이면 화면에 보이는 데이터 행을 위에서 아래까지 전부 확인한다. 맨 아래 행이 일부만 보이더라도 필요한 필드가 식별 가능하면 누락하지 않는다.
- 실제 이용일만 use_date로 넣는다. 신청일, 문자 수신일, 화면 상단 날짜를 use_date로 혼동하지 않는다.
- 신청일은 application_date에만 넣는다.
- 문자 수신일/알림 수신일은 연도까지 이미지에서 확인될 때만 notification_date에 YYYY-MM-DD로 넣는다. 연도가 없으면 null이다.
- 날짜는 YYYY-MM-DD, 시간은 HH:MM 형식으로 정규화한다.
- 시설명과 코트 번호를 분리한다. 예: '새아침코트(2코트)'면 facility_name에는 시설명, court_number에는 '2'.
- 코트 번호가 보이지 않으면 court_number는 null이다.
- status는 이미지의 의미를 다음 중 하나로 정규화한다: lottery_waiting, won, paid, confirmed, cancelled. 어느 것도 확실하지 않으면 null.
- '추첨대기'는 lottery_waiting, '당첨'은 won, '결제완료'는 paid, '확정됨/예약확정'은 confirmed.
- 사진 속 인원 수는 홈페이지 모집 정원으로 해석하지 말고 출력에도 넣지 않는다.
- 이름, 전화번호 등 개인정보는 출력하지 않는다.
- 보이지 않는 정보는 절대로 추측하지 말고 null로 둔다.`

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "")
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function readImage(req: Request): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const contentType = req.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData()
    const image = formData.get("image") ?? formData.get("file")
    if (!(image instanceof File)) throw new Error("IMAGE_REQUIRED")
    return {
      bytes: new Uint8Array(await image.arrayBuffer()),
      mimeType: image.type || "application/octet-stream",
    }
  }

  if (contentType.includes("application/json")) {
    const body = await req.json()
    if (!body || typeof body.image_base64 !== "string") throw new Error("IMAGE_REQUIRED")
    return {
      bytes: base64ToBytes(body.image_base64),
      mimeType: typeof body.mime_type === "string" ? body.mime_type : "application/octet-stream",
    }
  }

  throw new Error("UNSUPPORTED_CONTENT_TYPE")
}

function validScheduleStatus(value: unknown): boolean {
  return value === null || ["lottery_waiting", "won", "paid", "confirmed", "cancelled"].includes(String(value))
}

function validNullableString(value: unknown): boolean {
  return value === null || typeof value === "string"
}

function validateDraft(data: unknown): data is { schedules: Array<Record<string, string | null>> } {
  if (!data || typeof data !== "object") return false
  const schedules = (data as { schedules?: unknown }).schedules
  if (!Array.isArray(schedules)) return false
  return schedules.every((row) => {
    if (!row || typeof row !== "object") return false
    const r = row as Record<string, unknown>
    return [
      r.use_date,
      r.start_time,
      r.end_time,
      r.facility_name,
      r.court_number,
      r.application_date,
      r.notification_date,
    ].every(validNullableString) && validScheduleStatus(r.status)
  })
}

async function requireApprovedMember(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) return { ok: false as const, status: 401, error: "Login required." }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const publishableKey = getPublishableKey()
  if (!supabaseUrl || !publishableKey) return { ok: false as const, status: 500, error: "Supabase configuration is unavailable." }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const token = authHeader.slice("Bearer ".length)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) {
    return { ok: false as const, status: 401, error: "Valid login required." }
  }

  const { data: account, error: accountError } = await supabase
    .from("club_member_accounts")
    .select("member_id,status")
    .eq("user_id", userData.user.id)
    .maybeSingle()

  if (accountError) return { ok: false as const, status: 403, error: "Unable to verify member access." }
  if (!account || account.status !== "approved" || !account.member_id) {
    return { ok: false as const, status: 403, error: "Approved club member required." }
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("status")
    .eq("id", account.member_id)
    .maybeSingle()

  if (memberError || !member || member.status !== "active") {
    return { ok: false as const, status: 403, error: "Active club member required." }
  }

  return { ok: true as const }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "POST required." }, 405, { Allow: "POST, OPTIONS" })

  const access = await requireApprovedMember(req)
  if (!access.ok) return jsonResponse({ error: access.error }, access.status)

  const groqApiKey = Deno.env.get("GROQ_API_KEY")
  if (!groqApiKey) return jsonResponse({ error: "AI service is not configured." }, 503)

  let image: { bytes: Uint8Array; mimeType: string }
  try {
    image = await readImage(req)
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_IMAGE"
    if (code === "UNSUPPORTED_CONTENT_TYPE") {
      return jsonResponse({ error: "Use multipart/form-data or application/json." }, 415)
    }
    return jsonResponse({ error: "An image file is required." }, 400)
  }

  if (!ALLOWED_MIME_TYPES.has(image.mimeType)) {
    return jsonResponse({ error: "Only JPEG, PNG, or WebP images are supported." }, 415)
  }
  if (image.bytes.byteLength === 0 || image.bytes.byteLength > MAX_IMAGE_BYTES) {
    return jsonResponse({ error: "Image must be between 1 byte and 5 MB." }, 413)
  }

  const payload = {
    model: GROQ_MODEL,
    temperature: 0,
    max_tokens: 800,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "reservation_schedules",
        strict: true,
        schema: responseSchema,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${bytesToBase64(image.bytes)}` },
          },
        ],
      },
    ],
  }

  let groqResponse: Response
  try {
    groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return jsonResponse({ error: "AI service request failed." }, 502)
  }

  if (!groqResponse.ok) {
    if (groqResponse.status === 429) {
      const retryAfter = groqResponse.headers.get("retry-after")
      return jsonResponse(
        { error: "AI service is temporarily rate-limited. Please retry shortly." },
        429,
        retryAfter ? { "Retry-After": retryAfter } : {},
      )
    }
    return jsonResponse({ error: "AI service returned an error." }, 502)
  }

  try {
    const groqJson = await groqResponse.json()
    const content = groqJson?.choices?.[0]?.message?.content
    if (typeof content !== "string") throw new Error("Missing structured output")
    const draft = JSON.parse(content)
    if (!validateDraft(draft)) throw new Error("Invalid structured output")
    return jsonResponse({ ...draft, model: GROQ_MODEL })
  } catch {
    return jsonResponse({ error: "AI response could not be parsed safely." }, 502)
  }
})
