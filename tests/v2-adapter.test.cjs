const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),acorn=require('acorn');
const adapter=require('../v2-data.js');
test('schedule adapter preserves KST ordering, capacity and response states',()=>{
 const row={id:'a',title:'match',starts_at:'2099-01-20T11:00:00Z',ends_at:'2099-01-20T13:00:00Z',capacity:5,version:2,status:'active'};
 const mapped=adapter.schedule(row,[{schedule_id:'a',member_id:'m',state:'declined'},{schedule_id:'b',member_id:'x',state:'attending'}]);
 assert.equal(mapped.date,'2099-01-20');assert.equal(mapped.time,'오후 8:00 ~ 오후 10:00');assert.equal(mapped.capacity,5);
 assert.deepEqual(mapped.absenteeIds,['m']);assert.deepEqual(mapped.attendeeIds,[]);
 const imported=adapter.schedule({...row,legacy_schedule_id:'old-id',create_payload:{imported_at:'2026-09-17',v1_snapshot:{kakao_creator_name:'Original creator'}}},[{schedule_id:'a',member_id:'m',state:'attending',response_source:'v1'},{schedule_id:'a',member_id:'n',state:'attending',response_source:'member'}]);
 assert.deepEqual(imported.importedResponseIds,['m']);assert.equal(imported.originalCreator,'Original creator');assert.equal(imported.legacyScheduleId,'old-id');
 assert.equal(adapter.input({...mapped,creatorMemberId:'forged'}).creator_member_id,undefined);
});
test('pagination does not truncate after the API page limit',async()=>{
 let calls=0;const rows=Array.from({length:1001},(_,id)=>({id}));
 const client={from(){return{select(){return this},order(){return this},async range(a,b){calls++;return{data:rows.slice(a,b+1),error:null}}}}};
 assert.equal((await adapter.rows(client,'v2_schedules')).length,1001);assert.equal(calls,3);
});
test('RPC conflicts have actionable errors and no success fallback',async()=>{
 await assert.rejects(adapter.rpc({rpc:async()=>({error:{code:'40001'}})},'v2_update_schedule',{}),/새로고침/);
});
test('all inline scripts parse and legacy mutable tables are no longer queried',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))acorn.parse(m[1],{ecmaVersion:'latest'});
 assert.doesNotMatch(html,/\.from\(["'](?:schedules|discussions|schedule_declines|schedule_rsvp_overrides|events|courts|court_units)["']\)/);
 const loader=html.slice(html.indexOf('async function loadData()'),html.indexOf('function fromSupabaseSchedule('));
 assert.doesNotMatch(loader,/fetchJSON/);
 const workflow=fs.readFileSync('.github/workflows/pages.yml','utf8');
 assert.doesNotMatch(workflow,/cp -R assets data/);assert.match(workflow,/v2-data\.js/);assert.match(workflow,/v2-admin\.js/);
 acorn.parse(fs.readFileSync('v2-admin.js','utf8'),{ecmaVersion:'latest'});
 assert.doesNotMatch(fs.readFileSync('club/app.js','utf8'),/fetch\(/);
});
