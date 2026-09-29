const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const load = () => Promise.all([import('ical.js'), import('../supabase/functions/personal-calendar-feed/ics.mjs')]);
const ics = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body.trim().split('\n').map(l => l.trim()).join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const pick = rows => rows.map(({ date, startTime, endTime, allDay, title }) => ({ date, startTime, endTime, allDay, title }));

test('personal calendar feed parses single, UTC, all-day and cross-midnight events in Seoul time', async () => {
  const [{ default: ICAL }, { parseIcsEvents }] = await load();
  const text = ics(`
    BEGIN:VEVENT
    UID:single@google.com
    DTSTART;TZID=Asia/Seoul:20261005T190000
    DTEND;TZID=Asia/Seoul:20261005T210000
    SUMMARY:저녁 약속
    LOCATION:송도
    END:VEVENT
    BEGIN:VEVENT
    UID:utc@google.com
    DTSTART:20261006T233000Z
    DTEND:20261007T010000Z
    SUMMARY:UTC 회의
    END:VEVENT
    BEGIN:VEVENT
    UID:trip@google.com
    DTSTART;VALUE=DATE:20261010
    DTEND;VALUE=DATE:20261012
    SUMMARY:여행
    END:VEVENT
    BEGIN:VEVENT
    UID:late@google.com
    DTSTART;TZID=Asia/Seoul:20261013T230000
    DTEND;TZID=Asia/Seoul:20261014T010000
    SUMMARY:야간
    END:VEVENT
    BEGIN:VEVENT
    UID:cancelled@google.com
    STATUS:CANCELLED
    DTSTART;TZID=Asia/Seoul:20261015T100000
    DTEND;TZID=Asia/Seoul:20261015T110000
    SUMMARY:취소됨
    END:VEVENT
    BEGIN:VEVENT
    UID:outside@google.com
    DTSTART;TZID=Asia/Seoul:20261201T100000
    DTEND;TZID=Asia/Seoul:20261201T110000
    SUMMARY:범위 밖
    END:VEVENT
  `);
  const { events, truncated } = parseIcsEvents(ICAL, text, { from: '2026-10-01', to: '2026-11-01' });
  assert.equal(truncated, false);
  assert.deepEqual(pick(events), [
    { date: '2026-10-05', startTime: '19:00', endTime: '21:00', allDay: false, title: '저녁 약속' },
    { date: '2026-10-07', startTime: '08:30', endTime: '10:00', allDay: false, title: 'UTC 회의' },
    { date: '2026-10-10', startTime: '', endTime: '', allDay: true, title: '여행' },
    { date: '2026-10-11', startTime: '', endTime: '', allDay: true, title: '여행' },
    { date: '2026-10-13', startTime: '23:00', endTime: '24:00', allDay: false, title: '야간' },
    { date: '2026-10-14', startTime: '00:00', endTime: '01:00', allDay: false, title: '야간' }
  ]);
  assert.equal(events[0].location, '송도');
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
});

test('personal calendar feed expands recurrences with EXDATE and moved occurrences', async () => {
  const [{ default: ICAL }, { parseIcsEvents }] = await load();
  const text = ics(`
    BEGIN:VEVENT
    UID:weekly@google.com
    DTSTART;TZID=Asia/Seoul:20260901T190000
    DTEND;TZID=Asia/Seoul:20260901T210000
    RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261031T000000Z
    EXDATE;TZID=Asia/Seoul:20261006T190000
    SUMMARY:레슨
    END:VEVENT
    BEGIN:VEVENT
    UID:weekly@google.com
    RECURRENCE-ID;TZID=Asia/Seoul:20261013T190000
    DTSTART;TZID=Asia/Seoul:20261014T200000
    DTEND;TZID=Asia/Seoul:20261014T220000
    SUMMARY:레슨 (변경)
    END:VEVENT
    BEGIN:VEVENT
    UID:ny@google.com
    DTSTART;TZID=America/New_York:20261020T090000
    DTEND;TZID=America/New_York:20261020T100000
    SUMMARY:뉴욕 통화
    END:VEVENT
  `);
  const { events } = parseIcsEvents(ICAL, text, { from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(pick(events), [
    { date: '2026-10-14', startTime: '20:00', endTime: '22:00', allDay: false, title: '레슨 (변경)' },
    { date: '2026-10-20', startTime: '19:00', endTime: '21:00', allDay: false, title: '레슨' },
    { date: '2026-10-20', startTime: '22:00', endTime: '23:00', allDay: false, title: '뉴욕 통화' },
    { date: '2026-10-27', startTime: '19:00', endTime: '21:00', allDay: false, title: '레슨' }
  ]);
});

test('personal calendar feed rejects bad input and caps output', async () => {
  const [{ default: ICAL }, { parseIcsEvents }] = await load();
  assert.throws(() => parseIcsEvents(ICAL, 'not a calendar', { from: '2026-10-01', to: '2026-11-01' }), /INVALID_ICS/);
  assert.throws(() => parseIcsEvents(ICAL, ics(''), { from: '2026-11-01', to: '2026-10-01' }), /INVALID_RANGE/);
  const daily = ics(`
    BEGIN:VEVENT
    UID:daily@google.com
    DTSTART;TZID=Asia/Seoul:20260101T070000
    DTEND;TZID=Asia/Seoul:20260101T080000
    RRULE:FREQ=DAILY
    SUMMARY:운동
    END:VEVENT
  `);
  const { events, truncated } = parseIcsEvents(ICAL, daily, { from: '2026-10-01', to: '2026-11-01', maxItems: 5 });
  assert.equal(events.length, 5);
  assert.equal(truncated, true);
  const full = parseIcsEvents(ICAL, daily, { from: '2026-10-01', to: '2026-11-01' });
  assert.equal(full.events.length, 31);
  assert.equal(full.events[0].date, '2026-10-01');
});

test('personal calendar client script parses and is included in the deployment', () => {
  const acorn = require('acorn');
  acorn.parse(fs.readFileSync('v2-personal-calendar.js', 'utf8'), { ecmaVersion: 'latest' });
  const html = fs.readFileSync('index.html', 'utf8'), workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
  assert(html.includes('src="v2-personal-calendar.js"'));
  assert(workflow.includes('v2-personal-calendar.js'));
});

test('personal calendar client keeps links per member, gates access and survives feed failures', async () => {
  const { create, normalizeUrl, STORAGE_KEY } = require('../v2-personal-calendar.js');
  assert.equal(normalizeUrl('webcal://p12-caldav.icloud.com/published/2/abc'), 'https://p12-caldav.icloud.com/published/2/abc');
  assert.equal(normalizeUrl('https://calendar.google.com/calendar/ical/x/private-y/basic.ics'), 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics');
  for (const bad of ['http://calendar.google.com/x.ics', 'https://evil.example/x.ics', 'https://calendar.google.com.evil.example/x', 'https://user:pw@calendar.google.com/x', 'https://calendar.google.com:8443/x', 'not a url']) assert.equal(normalizeUrl(bad), '', bad);

  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  let member = 'owner', calls = [], reply = { ok: true, body: { events: [{ id: 'pcal-1', date: '2026-10-05', title: '약속', startTime: '19:00', endTime: '20:00', allDay: false }] } };
  const fetchImpl = async (url, init) => { calls.push({ url, init }); if (reply.throws) throw new Error('offline'); return { ok: reply.ok, json: async () => reply.body }; };
  let clock = Date.parse('2026-09-29T03:00:00Z');
  const cal = create({ functionUrl: 'https://x.supabase.co/functions/v1/personal-calendar-feed', apiKey: 'pk', memberId: () => member, isEnabled: id => id === 'owner', authHeaders: () => ({ 'x-review-token': 'tok' }), storage, now: () => clock, fetchImpl });

  await assert.rejects(cal.connect('https://evil.example/x.ics'), /연결할 수 있어요/);
  assert.equal(calls.length, 0);
  assert.equal(await cal.connect('https://calendar.google.com/calendar/ical/a/private-b/basic.ics'), true);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual([sent.from, sent.to], ['2026-07-01', '2027-10-01']);
  assert.equal(calls[0].init.headers['x-review-token'], 'tok');
  assert.equal(calls[0].init.headers.apikey, 'pk');
  assert.deepEqual(cal.events().map(e => [e.title, e.category, e.readOnly]), [['약속', 'mycal', true]]);
  assert.equal(cal.status().color, 'sky', 'sky is the default colour');
  assert.equal(cal.setColor('grey'), false);
  assert.equal(cal.setColor('violet'), true);
  assert.equal(cal.status().color, 'violet');

  assert.equal(await cal.refresh(), false, 'fresh cache is not refetched');
  clock += 16 * 60 * 1000; reply = { ok: false, body: { code: 'FEED_NOT_FOUND' } };
  assert.equal(await cal.refresh(), false);
  assert.equal(cal.events().length, 1, 'last good events stay after a failure');
  assert.equal(cal.status().color, 'violet', 'colour survives refreshes');
  assert.match(cal.status().error, /찾을 수 없어요/);
  reply = { throws: true };
  await assert.rejects(cal.refresh({ force: true }), /인터넷 연결/);

  member = 'someone-else';
  assert.equal(cal.enabled(), false);
  assert.deepEqual(cal.events(), [], 'another member on the same device sees nothing');
  await assert.rejects(cal.connect('https://calendar.google.com/x'), /아직 사용할 수 없어요/);
  member = 'owner';
  cal.disconnect();
  assert.deepEqual(cal.events(), []);
  assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)), {});
});
