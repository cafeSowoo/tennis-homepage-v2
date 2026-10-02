export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// A base64 JSON body is about 4/3 of the image; leave room for the form or JSON wrapper.
export const MAX_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64 * 1024
export const MAX_SCHEDULES = 20

// Reads the body but stops as soon as it passes maxBytes, so an oversized upload is
// rejected before it is held in memory.
export async function readBodyWithin(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("TOO_LARGE")
  if (!req.body) return new Uint8Array()

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error("TOO_LARGE")
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/

function matching(value: string | null | undefined, pattern: RegExp): string | null {
  if (typeof value !== "string") return null
  const padded = /^\d:\d\d$/.test(value) ? `0${value}` : value
  return pattern.test(padded) ? padded : null
}

// The model is asked for YYYY-MM-DD dates and HH:MM times; anything else becomes null
// so the page asks the member to check it instead of saving a malformed value.
export function cleanDraft(draft: { schedules: Array<Record<string, string | null>> }) {
  return {
    schedules: draft.schedules.slice(0, MAX_SCHEDULES).map((row) => ({
      ...row,
      use_date: matching(row.use_date, DATE),
      application_date: matching(row.application_date, DATE),
      notification_date: matching(row.notification_date, DATE),
      start_time: matching(row.start_time, TIME),
      end_time: matching(row.end_time, TIME),
    })),
  }
}
