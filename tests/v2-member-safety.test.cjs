const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const TennisV2 = require('../v2-data.js');
const sw = fs.readFileSync(new URL('../sw.js', `file://${__filename}`), 'utf8');
function source(name) {
  const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(html);
  assert.ok(match, name);
  const end = html.indexOf(`\n${match[1]}}`, match.index);
  return html.slice(match.index, end + match[1].length + 2);
}
function memberContext() {
  const calls = [];
  const member = { id: 'member-a', status: 'active' };
  const ctx = {
    authState: { initialized: true, user: { id: 'user-a' }, member, memberAccount: { user_id: 'user-a', member_id: member.id, status: 'approved', role: 'member' } },
    remoteWritesEnabled: () => true,
    schedules: [{ id: 'schedule-a', attendeeIds: [], closed: false, source: 'v2' }],
    state: { selectedId: 'schedule-a' },
    MATCH_CAPACITY: 16, TennisV2, clearV2Data: () => {},
    isMySchedule: schedule => schedule.attendeeIds.includes(member.id),
    attendeeIdsForSchedule: schedule => schedule.attendeeIds,
    supabaseClient: { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } },
    loadSupabaseData: async () => {}, refreshViews: () => {}, calls
  };
  vm.createContext(ctx);
  vm.runInContext('const pendingRsvpRequests = new Set();\n' + ['myMemberId', 'isApprovedMember', 'requireApprovedMember', 'reloadV2AfterWrite', 'persistMyScheduleRsvp', 'joinCurrentSchedule', 'leaveCurrentSchedule', 'declineCurrentSchedule', 'clearCurrentScheduleDecline'].map(source).join('\n'), ctx);
  return ctx;
}
test('self RSVP uses V2 RPC without caller-supplied identity', async () => {
  for (const source of ['v2']) {
    const ctx = memberContext(); ctx.schedules[0].source = source;
    for (const [fn, state] of [['joinCurrentSchedule','attending'], ['leaveCurrentSchedule','pending'], ['declineCurrentSchedule','declined'], ['clearCurrentScheduleDecline','pending']]) {
      await ctx[fn]();
      assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls.at(-1))), { name: 'v2_set_my_rsvp', args: { p_id: 'schedule-a', p_state: state } });
    }
  }
});
test('Kakao mirror schedules reject RSVP before network calls', async () => {
  const c=memberContext(); c.schedules[0].source='kakao';
  await assert.rejects(c.joinCurrentSchedule(),/카카오 일정/);
  assert.equal(c.calls.length,0);
});
test('unapproved, disabled, inactive, missing and stale members cannot write', async () => {
  const mutations = [c => c.authState.user = null, c => c.authState.memberAccount.status = 'pending', c => c.authState.memberAccount.status = 'disabled', c => c.authState.member.status = 'inactive', c => c.authState.member = null, c => c.authState.memberAccount.user_id = 'other-user', c => c.authState.initialized = false, c => c.remoteWritesEnabled = () => false];
  for (const mutate of mutations) { const c = memberContext(); mutate(c); await assert.rejects(c.joinCurrentSchedule()); assert.equal(c.calls.length, 0); }
});
test('invalid state, unknown schedule, closed and full schedules are rejected', async () => {
  for (const setup of [c => c.schedules[0].closed = true, c => c.schedules[0].attendeeIds = Array.from({length:16}, (_,i) => `member-${i}`)]) {
    const c = memberContext(); setup(c); await assert.rejects(c.joinCurrentSchedule()); assert.equal(c.calls.length,0);
    await c.leaveCurrentSchedule(); assert.equal(c.calls.length,1);
  }
  const c=memberContext(); await assert.rejects(c.persistMyScheduleRsvp('missing','attending')); await assert.rejects(c.persistMyScheduleRsvp('schedule-a',null)); assert.equal(c.calls.length,0);
});
test('duplicate in-flight changes are suppressed and failures release the lock', async () => {
  const c=memberContext(); let release;
  c.supabaseClient.rpc=async () => { c.calls.push('rpc'); return new Promise(resolve => release=resolve); };
  const first=c.joinCurrentSchedule(); await c.declineCurrentSchedule(); assert.equal(c.calls.length,1);
  release({error:new Error('permission denied')}); await assert.rejects(first,/permission denied/);
  c.supabaseClient.rpc=async () => { c.calls.push('retry'); return {error:null}; };
  await c.declineCurrentSchedule(); assert.equal(c.calls.length,2);
});
test('successful write plus failed refresh reports that data was saved', async () => {
  const c=memberContext(); c.loadSupabaseData=async()=>{throw new Error('offline');};
  await assert.rejects(c.joinCurrentSchedule(),/저장됐지만/);
});
function workerContext() {
  const handlers={},deleted=[],navigated=[];
  const ctx={URL, self:{registration:{scope:'https://example.test/tennis-homepage-v2/'},addEventListener:(name,fn)=>handlers[name]=fn},caches:{keys:async()=>['tennis-homepage-v1','other-app','tennis-homepage-v2-old','tennis-homepage-v2-__CACHE_VERSION__'],delete:async key=>deleted.push(key)},clients:{claim:async()=>{},matchAll:async()=>[{url:'https://example.test/tennis-homepage/',focus:()=>navigated.push('V1 focus'),navigate:()=>navigated.push('V1 navigate')}],openWindow:async url=>navigated.push(url)}};
  ctx.self.clients = ctx.clients;vm.createContext(ctx);vm.runInContext(sw,ctx);return {handlers,deleted,navigated};
}
test('service worker removes only old V2 caches',async()=>{
  const c=workerContext();let pending;c.handlers.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual(c.deleted,['tennis-homepage-v2-old']);
});
test('notifications never reuse V1 windows or navigate outside V2',async()=>{
  for(const url of ['https://example.test/tennis-homepage/','https://outside.test/','./index.html']){
    const c=workerContext();let pending;c.handlers.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>pending=p});await pending;
    assert.equal(c.navigated.length,1);assert.ok(c.navigated[0].startsWith('https://example.test/tennis-homepage-v2/'));
  }
});
test('service worker ignores V1 resource fetches',()=>{
  const c=workerContext();let intercepted=false;c.handlers.fetch({request:{url:'https://example.test/tennis-homepage/env.js',method:'GET'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
test('approved member calendar renders attendance and host labels outside dot callback', () => {
  const grid = { innerHTML: '' }, title = {};
  const ctx = {
    document: { querySelector: selector => selector === '#calendarGrid' ? grid : title, querySelectorAll: () => [] },
    state: { currentMonth: '2026-09', selectedDate: '' }, todayIso: '2026-09-01',
    byDate: { '2026-09-01': [{ id: 'own-schedule', date: '2026-09-01' }] }, eventsByDate: {},
    firstDayOffset: () => 0, daysInMonth: () => 1, monthLabel: () => '9월', syncDocumentTitle() {},
    compareSchedulesByTime: () => 0, compareCalendarItemsByTime: () => 0,
    isMySchedule: () => true, isMyHostSchedule: () => true, isDeclinedSchedule: () => false,
    isBookClubSchedule: () => false, isYonseiSchedule: () => false,
    myMemberName: () => '김지석', escapeHTML: value => value,
    timeStart: () => '09:00', calendarTimeLabel: () => '09:00', schedulePlaceLabel: () => '테스트 코트'
  };
  vm.createContext(ctx); vm.runInContext(source('renderCalendar'),ctx);
  assert.doesNotThrow(() => ctx.renderCalendar());
  assert.match(grid.innerHTML, /김지석 참석 일정/); assert.match(grid.innerHTML, /김지석 Host 일정/);
});
function discussionContext() {
  const c = memberContext();
  Object.assign(c, {
    canManageOfficialData: () => false, isClubAdmin: () => false,
    myMember: () => c.authState.member,
    document: { querySelector: () => null },
    crypto: { randomUUID: () => 'unique-test-id' },
    dataStore: { discussions: [] }, discussions: [],
    rebuildDataIndexes: () => { c.discussions = c.dataStore.discussions; },
    renderCurrentDetail: () => {}, confirm: () => true,
    toSupabaseDiscussion: row => ({ id:row.id, schedule_id:row.scheduleId, member_id:row.memberId, message:row.message, source:row.source }),
    fromSupabaseDiscussion: row => ({ id:row.id, scheduleId:row.schedule_id, memberId:row.member_id, message:row.message, source:row.source })
  });
  vm.runInContext('const pendingDiscussionWrites = new Set();\n' + ['canDeleteDiscussion','addDiscussionMessage','deleteDiscussionMessage'].map(source).join('\n'),c);
  return c;
}
test('comment deletion requires an active approved author or admin', () => {
  const c=discussionContext();
  const own={memberId:'member-a'},other={memberId:'member-b'};
  assert.equal(c.canDeleteDiscussion(own),true);assert.equal(c.canDeleteDiscussion(other),false);
  c.authState.memberAccount.status='disabled';assert.equal(c.canDeleteDiscussion(own),false);
  c.authState.memberAccount.status='approved';c.isClubAdmin=()=>true;
  assert.equal(c.canDeleteDiscussion(other),true);
});
test('comment RPC omits author identity and rejects oversized input', async () => {
  const c=discussionContext();
  c.reloadV2AfterWrite=async()=>{};
  await c.addDiscussionMessage('  Test comment  ');
  assert.equal(c.calls[0].name,'v2_add_discussion');
  assert.equal(c.calls[0].args.p_message,'Test comment');
  assert.equal(c.calls[0].args.p_schedule_id,'schedule-a');
  assert.equal(c.calls[0].args.member_id,undefined);
  await assert.rejects(c.addDiscussionMessage('x'.repeat(2001)),/2,000/);
  c.authState.memberAccount.status='pending';await assert.rejects(c.addDiscussionMessage('blocked'));
});
test('Kakao mirror schedules reject homepage comments before network calls', async () => {
  const c=discussionContext(); c.schedules[0].source='kakao';
  await assert.rejects(c.addDiscussionMessage('카카오에서 작성해야 함'),/카카오 일정/);
  assert.equal(c.calls.length,0);
});
test('comment delete keeps visible rows when server rejects deletion', async () => {
  const c=discussionContext();c.dataStore.discussions=[{id:'own',memberId:'member-a',scheduleId:'schedule-a'}];c.rebuildDataIndexes();
  c.supabaseClient.rpc=async()=>({data:false,error:null});
  await assert.rejects(c.deleteDiscussionMessage('own'),/삭제 권한/);assert.equal(c.discussions.length,1);
  c.supabaseClient.rpc=async()=>({data:true,error:null});
  c.reloadV2AfterWrite=async()=>{c.dataStore.discussions=[];c.rebuildDataIndexes();};
  await c.deleteDiscussionMessage('own');assert.equal(c.discussions.length,0);
});
test('cancelled and started schedules reject RSVP before network calls',async()=>{
  for(const mutation of [s=>s.status='cancelled',s=>s.startsAt='2000-01-01T00:00:00Z']) {
    const c=memberContext();mutation(c.schedules[0]);await assert.rejects(c.joinCurrentSchedule());assert.equal(c.calls.length,0);
  }
});
test('schedule list encodes member titles in both text and accessible attributes',()=>{
 const c={weekendDayClass:()=> 'weekend',isBookClubSchedule:()=>false,isYonseiSchedule:()=>false,isMySchedule:()=>false,isMyHostSchedule:()=>false,isDeclinedSchedule:()=>false,scheduleAttendeesHTML:()=>'',scheduleRsvpButtonHTML:()=>'',icon:()=>'',scheduleTimeRangeLabel:()=>'',schedulePlaceLabel:()=>''};
 vm.createContext(c);vm.runInContext(['escapeHTML','weekendDayTextHTML','usesPlaceTitle','scheduleCardTitle','scheduleSurfaceLabel','scheduleTitleTagsHTML','scheduleRow'].map(source).join('\n'),c);
 const title=`<b data-title-probe="yes">제목</b> " ' & (토)`;
 const result=c.scheduleRow({id:'fixture',title,attendees:[]});
 assert.ok(result.includes('aria-label="'+c.escapeHTML(title)+' 상세 보기"'));
 assert.ok(result.includes('&lt;b data-title-probe=&quot;yes&quot;&gt;제목&lt;/b&gt;'));
 assert.ok(!result.includes('<b data-title-probe='));
 assert.ok(result.includes('<span class="weekend">(토)</span>'));
});

test('Kakao mirror cards do not render homepage RSVP controls',()=>{
 const c={myMemberId:()=> 'member-a',getScheduleRsvpState:()=> 'pending'};
 vm.createContext(c);vm.runInContext(source('scheduleRsvpButtonHTML'),c);
 assert.equal(c.scheduleRsvpButtonHTML({id:'kakao-a',source:'kakao'}),'');
 assert.match(c.scheduleRsvpButtonHTML({id:'v2-a',source:'v2'}),/data-set-rsvp="v2-a"/);
});

test('Kakao mirror adapter uses Kakao source RSVP and KST times',()=>{
 const c={};vm.createContext(c);
 vm.runInContext(['toTwentyFourHourLabel','fromSupabaseSchedule','kakaoMirrorIsoRange','fromKakaoMirrorSchedule'].map(source).join('\n'),c);
 const row={id:'kakao-a',date:'2026-10-04',day:'일요일',time:'오후 8:00 ~ 오후 10:00',title:'테스트',source:'kakao',attendee_ids:['legacy'],absentee_ids:['legacy-decline'],kakao_attendee_ids:['member-a'],kakao_absentee_ids:['member-b'],kakao_creator_name:'개설자',kakao_comment_count:2,kakao_synced_at:'2026-09-21T02:00:00Z'};
 const item=JSON.parse(JSON.stringify(c.fromKakaoMirrorSchedule(row)));
 assert.deepEqual(item.attendeeIds,['member-a']);assert.deepEqual(item.absenteeIds,['member-b']);
 assert.equal(item.capacity,4);assert.equal(item.source,'kakao');assert.equal(item.readOnlyMirror,true);
 assert.equal(item.startsAt,'2026-10-04T11:00:00.000Z');assert.equal(item.endsAt,'2026-10-04T13:00:00.000Z');
});

test('schedule ordering uses start time and Korean title regardless of RSVP', () => {
  const ctx = { isMySchedule: () => { throw Error('Attendance must not affect sorting'); } };
  vm.createContext(ctx);
  vm.runInContext(['timeStart','scheduleStartMinutes','compareSchedulesByTime','calendarItemStartMinutes','compareCalendarItemsByTime'].map(source).join('\n'),ctx);
  const rows = [
    {id:'1',date:'2026-09-20',time:'20:00 ~ 22:00',title:'새아침',attendeeIds:['me']},
    {id:'2',date:'2026-09-20',time:'오후 8:00 ~ 오후 10:00',title:'달빛'},
    {id:'3',date:'2026-09-20',time:'12:00 ~ 15:00',title:'송도지소'},
    {id:'4',date:'2026-09-21',time:'오전 9:00 ~ 오전 10:00',title:'다음날'}
  ];
  for (const compare of [ctx.compareSchedulesByTime,ctx.compareCalendarItemsByTime]) {
    assert.deepEqual([...rows].sort(compare).map(r=>r.id),['3','2','1','4']);
    rows[0].attendeeIds=[];rows[2].attendeeIds=['me'];
    assert.deepEqual([...rows].sort(compare).map(r=>r.id),['3','2','1','4']);
  }
});

test('cancelled schedules are excluded from calendar and default lists without removing records', () => {
 const c={};vm.createContext(c);vm.runInContext(source('isVisibleSchedule'),c);
 const records=[{id:'active',status:'active'},{id:'cancelled',status:'cancelled'}];
 assert.deepEqual(records.filter(c.isVisibleSchedule).map(r=>r.id),['active']);
 assert.equal(records.length,2);
 assert.match(html,/byDate = schedules\.filter\(isVisibleSchedule\)\.reduce/);
 assert.match(html,/schedules\.filter\(item => isVisibleSchedule\(item\) && inScheduleWindow/);
});
