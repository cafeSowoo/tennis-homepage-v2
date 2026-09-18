# Reservation image parser

`parse-reservation-image` is a Supabase Edge Function for the V2 reservation-image import flow.

Current scope:

- Requires a logged-in, approved, active club member.
- Accepts one JPEG, PNG, or WebP image up to 5 MB.
- Sends the image directly to Groq without storing it in Supabase Storage or Postgres.
- Uses `qwen/qwen3.8-27b` with strict JSON Schema output.
- Returns schedule drafts only. It does not create or update `v2_schedules`.
- Does not return names, phone numbers, or participant counts from the image.

Expected multipart request field: `image` (or `file`). JSON requests with `image_base64` and `mime_type` are also supported for testing.

The function needs a Supabase project secret named `GROQ_API_KEY`. The key must never be committed to this repository or exposed in `env.js`.

Returned draft fields:

- `use_date`
- `start_time`
- `end_time`
- `facility_name`
- `court_number`
- `status`: `lottery_waiting`, `won`, `paid`, `confirmed`, `cancelled`, or `null`
- `application_date`
- `notification_date`

The parser is not connected to the normal schedule-creation flow yet. For now it is exposed only through the admin test UI below.

## Admin test UI

The V2 homepage now includes an admin-only `AI Test` view for validating the parser before it is connected to normal schedule creation.

- The test menu is visible only when the signed-in account is a club admin.
- A tester can choose one supported image, call `parse-reservation-image`, edit the schedule fields that would matter for registration, and toggle which drafts would be kept.
- `status`, `application_date`, and `notification_date` remain parser/reference data and are shown only under each draft's `AI 참고 정보`; they are not schedule form fields.
- Parsed facility names are matched against the existing `courts` list. A successful match preselects the same facility dropdown used by normal schedules, and a parsed court number preselects a matching `court_units` option when available.
- If no existing facility can be matched, the draft selects `기타 (직접 입력)` and keeps the parsed facility/court text in free-text test fields instead of inventing a database court ID.
- The raw AI JSON can be inspected from the same screen.
- The test screen has no save/register action and does not write to `v2_schedules` or any other table.
- Once the behavior is stable, the same draft UI can be connected to the existing schedule creation flow in a separate change.
