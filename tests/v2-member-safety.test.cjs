const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
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
    schedules: [{ id: 'schedule-a', attendeeIds: [], closed: false, source: 'kakao' }],
    state: { selectedId: 'schedule-a' },
    MATCH_CAPACITY: 16,
    isMySchedule: schedule => schedule.attendeeIds.includes(member.id),
    attendeeIdsForSchedule: schedule => schedule.attendeeIds,
    supabaseClient: { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } },
    loadSupabaseData: async () => {}, refreshViews: () => {}, calls
  };
  vm.createContext(ctx);
  vm.runInContext('const pendingRsvpRequests = new Set();\n' + ['myMemberId', 'isApprovedMember', 'requireApprovedMember', 'persistMyScheduleRsvp', 'joinCurrentSchedule', 'leaveCurrentSchedule', 'declineCurrentSchedule', 'clearCurrentScheduleDecline'].map(source).join('\n'), ctx);
  return ctx;
}
test('self RSVP sends only schedule and state, for normal and Kakao schedules', async () => {
  for (const source of ['supabase', 'kakao']) {
    const ctx = memberContext(); ctx.schedules[0].source = source;
    for (const [fn, state] of [['joinCurrentSchedule','attending'], ['leaveCurrentSchedule','pending'], ['declineCurrentSchedule','declined'], ['clearCurrentScheduleDecline','pending']]) {
      await ctx[fn]();
      assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls.at(-1))), { name: 'set_my_schedule_rsvp', args: { p_schedule_id: 'schedule-a', p_state: state } });
    }
  }
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
