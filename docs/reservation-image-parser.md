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

The parser is connected to the existing schedule-creation flow as a draft/pre-fill step. It never writes schedules directly.

## Reservation capture UI

The V2 homepage includes a reservation-capture view that approved active members can open from schedule-add controls. The `AI Test` navigation item remains visible only to club admins, but it points to the same capture view.

- Approved members can choose one supported image, call `parse-reservation-image`, edit the schedule fields that would matter for registration, and toggle which drafts would be kept.
- The dashboard calendar `+` menu includes `캡쳐본으로 입력하기` between tennis match creation and general-event creation.
- The desktop sidebar `일정 추가` button opens a small chooser with `직접 입력하기` and `캡쳐본으로 입력하기`.
- `status`, `application_date`, and `notification_date` remain parser/reference data and are shown only under each draft's `AI 참고 정보`; they are not schedule form fields.
- Parsed facility names are matched against the existing `courts` list. A successful match preselects the same facility dropdown used by normal schedules, and a parsed court number preselects a matching `court_units` option when available.
- If no existing facility can be matched, the draft selects `기타 (직접 입력)` and keeps the parsed facility/court text in free-text test fields instead of inventing a database court ID.
- The raw AI JSON can be inspected from the same screen.
- AI analysis itself still does not write to `v2_schedules` or any other table.
- Each valid draft can be sent to the existing schedule-creation sheet with `이 일정 가져오기`.
- Multiple selected drafts can be queued with `선택한 N건 일정 추가로 가져오기`. The normal schedule sheet opens one draft at a time; after the user reviews and saves one schedule, the next queued draft is prefilled in the same sheet.
- The actual database write continues to use the existing `v2_create_schedule` path only when the user presses the normal schedule submit button.
- Drafts mapped to `기타 (직접 입력)` cannot be sent to the real schedule form until the tester chooses an existing court, because the current V2 schedule schema requires an existing `court_id`.
