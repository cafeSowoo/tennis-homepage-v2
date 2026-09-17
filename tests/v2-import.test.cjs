const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
test('V1 import preserves times and RSVP, is repeatable without overwriting V2, and rejects source drift',async()=>{
 const db=new PGlite();
 try {
 const base=fs.readFileSync('tests/v2-database.test.cjs','utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1];await db.exec(base);
 await db.exec(`alter table schedules add column date date,add column time text,add column title text,add column court_id text,add column court_unit_id text,add column host_id text,add column regular boolean;
 create table schedule_declines(schedule_id text);create table discussions(schedule_id text);create table schedule_rsvp_overrides(schedule_id text);`);
 for(const suffix of ['20260916152242_club_member_accounts_and_member_rsvp.sql','20260917095736_v2_independent_schedules.sql','20260917100945_v2_rpc_input_guards.sql',fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_v2_import_rsvp_provenance.sql'))])await db.exec(fs.readFileSync('supabase/migrations/'+suffix,'utf8'));
 const actor='754b454d-0793-477b-96c6-300dbce34b4c';
 await db.exec(`insert into auth.users(id) values('${actor}');insert into members values('member-kim-jiseok','Operator','active'),('other','Other','active');insert into courts values('court','Court');
 insert into club_member_accounts(user_id,member_id,status,role) values('${actor}','member-kim-jiseok','approved','admin');
 insert into schedules(id,date,time,title,court_id,attendee_ids,absentee_ids) values
 ('old-a','2099-01-20','오전 9:00 ~ 오후 12:00','Noon','court',array['member-kim-jiseok'],array['other']),
 ('old-b','2099-01-21','오후 11:00 ~ 오전 1:00','Overnight','court','{}','{}');`);
 const hashQuery="select md5(jsonb_agg(to_jsonb(s) order by id)::text) hash from schedules s where date>=date '2026-09-17'";
 const before=(await db.query(hashQuery)).rows[0].hash;
 const script=fs.readFileSync('supabase/imports/v1_future_20260917.sql','utf8').replace('99185c77e86ab71ece02fbd409df0bb1',before).replace('<>20 then','<>2 then');
 async function run(){return db.exec('begin;'+script+'commit;');}
 const results=await run();assert.equal(results.find(x=>x.rows?.[0]?.inserted_schedules!==undefined).rows[0].inserted_schedules,2);
 const a=(await db.query("select * from v2_schedules where legacy_schedule_id='old-a'")).rows[0];
 assert.equal(new Date(a.starts_at).toISOString(),'2099-01-20T00:00:00.000Z');assert.equal(new Date(a.ends_at).toISOString(),'2099-01-20T03:00:00.000Z');
 const b=(await db.query("select * from v2_schedules where legacy_schedule_id='old-b'")).rows[0];assert.equal(new Date(b.ends_at).toISOString(),'2099-01-21T16:00:00.000Z');
 assert.equal((await db.query('select count(*) n from v2_schedule_rsvps where response_source=\'v1\'')).rows[0].n,2);
 await db.exec(`begin;select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);set local role authenticated;select v2_set_my_rsvp('${a.id}','declined');commit;`);
 const response=(await db.query('select * from v2_schedule_rsvps where schedule_id=$1 and member_id=$2',[a.id,'member-kim-jiseok'])).rows[0];assert.equal(response.state,'declined');assert.equal(response.response_source,'member');assert(response.imported_at);
 await db.query("update v2_schedules set title='V2 edited' where id=$1",[a.id]);
 const retry=await run();assert.equal(retry.find(x=>x.rows?.[0]?.inserted_schedules!==undefined).rows[0].inserted_schedules,0);
 assert.equal((await db.query('select title from v2_schedules where id=$1',[a.id])).rows[0].title,'V2 edited');
 assert.equal((await db.query(hashQuery)).rows[0].hash,before);
 await db.exec("update schedules set title='Source changed' where id='old-a';");await assert.rejects(run(),/source changed/);await db.exec('rollback');
 }finally{await db.close();}
});
