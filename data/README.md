# Local data store

This folder contains the static seed and fallback data for the single-file SPA.
For the current operating direction, Supabase is the official source of truth.
See `../docs/storage-policy.md` for the full storage policy.

- `members.json`: member records. Schedules reference members by `member.id`.
- `courts.json`: parent court venue records. Schedules reference courts by `court.id`.
- `court-units.json`: optional sub-court records such as court numbers or A/B labels. Schedules can reference these by `courtUnitId`.
- `schedules.json`: schedule records. UI display fields such as `place`, `hostName`, and attendee names are hydrated in `index.html`; use `hostId` when the current user is responsible for the court booking.
- `events.json`: non-tennis calendar events. Use this for personal, work, book club, family, or other dates that should appear on the dashboard calendar.
- `discussions.json`: match discussion records. Discussion rows reference schedules by `schedule.id` and members by `member.id`. Use `displayTime` when the source only provides a human-readable timestamp.

`members.json`, `schedules.json` and `discussions.json` hold members' personal data
(real names, bank accounts in comments), so they are git-ignored and kept only on
the local machine. The public repo ships `courts.json`, `court-units.json` and
`events.json` only.

Keep `id` values stable. They are the bridge between these seed files, Supabase,
and any imported Kakao schedule data.

When Supabase is configured, changing these JSON files may not change what the
deployed homepage displays. Update Supabase for official schedule, attendee,
event, member, court, and discussion changes.

Example `events.json` row:

```json
{
  "id": "event-2026-06-05-personal",
  "date": "2026-06-05",
  "title": "개인 일정",
  "startTime": "14:00",
  "endTime": "16:00",
  "category": "personal",
  "location": "송도",
  "note": "달력에만 표시되는 다른 일정"
}
```

Supported categories: `personal`, `work`, `bookclub`, `family`, `other`.
