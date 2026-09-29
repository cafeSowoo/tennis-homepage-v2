# Personal calendar overlay (내 캘린더)

A member can paste their own calendar's iCal link (Google "iCal 형식의 비공개 주소" or an
iCloud public calendar link) on their profile. Their personal events then appear on the home
calendar as hollow grey dots / dashed chips, in the date panel under "내 캘린더", and in a
read-only detail view. It is one-way: the original calendar stays the source of truth.

## Privacy model

- The link and the fetched events are stored only in this browser's `localStorage`
  (`tennis.v2.personalCalendar`, keyed by member id). Nothing is written to Supabase.
- Another member selected on the same device sees nothing.
- Personal events are excluded from the club schedule list (`일정` tab) and cannot be shared or edited.

## Pilot gate

Only member ids in `PERSONAL_CALENDAR_MEMBER_IDS` (index.html, default `member-kim-jiseok`)
see the settings row. `env.js` can override it with `personalCalendarMemberIds: [...]`.
Add ids there to open it up to more members.

## Edge Function: `personal-calendar-feed`

Browsers cannot fetch Google/iCloud `.ics` feeds directly (no CORS), so the function fetches
the feed and returns parsed events. It never stores or logs the link.

- Access: review-mode token (`x-review-token`, checked with `review_access_check`) or an approved
  member's Supabase session JWT.
- Only `https` links to `calendar.google.com`, `*.icloud.com`, `outlook.live.com`,
  `outlook.office365.com` (redirects are re-checked), max 5 MB, max 500-day range.
- Parsing lives in `ics.mjs` (ical.js), shared with `tests/v2-personal-calendar.test.cjs`:
  recurrences, EXDATE, moved occurrences, all-day and cross-midnight events, all in Seoul time.
- Deploy with `verify_jwt = false` (review mode has no user JWT; the function checks access itself).
  Upload both `index.ts` and `ics.mjs`.

The client refreshes on app start, when the app becomes visible again, and on "새로고침",
at most every 15 minutes automatically. On failure the last good events are kept.
