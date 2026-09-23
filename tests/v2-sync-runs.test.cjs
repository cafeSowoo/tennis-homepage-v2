const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

const OWNER='{"email":"harminis@gmail.com"}', MEMBER='{"email":"member@example.invalid"}';
const run=(started,status='ok')=>`insert into public.kakao_sync_runs(started_at,finished_at,status,consecutive_failures)
  values ('${started}','${started}','${status}',0)`;

async function denied(db,sql){
  await assert.rejects(db.exec(sql),e=>/permission denied|row-level security|42501|Invalid sync admin/i.test(String(e.message||e)),sql);
}

test('Kakao sync run history: owner writes, only the admin password reads',async()=>{
  const db=new PGlite();
  // Supabase provides these; bcrypt is replaced by a deterministic stand-in because
  // PGlite has no pgcrypto. The permission logic under test does not depend on it.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema club_private;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    grant usage on schema auth, extensions to anon, authenticated;
    create function extensions.crypt(p text, salt text) returns text language sql immutable as $$select 'test-hash:'||md5(p)$$;`);
  await db.exec(fs.readFileSync('supabase/migrations/20260923155918_kakao_sync_runs.sql','utf8'));
  await db.exec(`insert into club_private.sync_admin_config(password_hash) values ('test-hash:'||md5('correct horse battery'))`);
  await db.exec(`grant usage on schema public to anon, authenticated`);

  await db.exec(`set role authenticated; select set_config('request.jwt.claims','${MEMBER}',false)`);
  await denied(db,run('2026-09-24T00:00:00Z'));
  await db.exec(`select set_config('request.jwt.claims','${OWNER}',false)`);
  await db.exec(run('2026-09-24T00:00:00Z'));
  await db.exec(run('2026-09-24T00:20:00Z','error'));
  await denied(db,'select * from public.kakao_sync_runs');  // even the owner has no direct read
  await denied(db,`update public.kakao_sync_runs set status='ok'`);
  await denied(db,'delete from public.kakao_sync_runs');

  await db.exec('reset role; set role anon');
  await denied(db,'select * from public.kakao_sync_runs');
  await denied(db,run('2026-09-24T00:40:00Z'));
  await denied(db,'select * from club_private.sync_admin_config');
  await denied(db,`select * from public.sync_admin_runs('wrong password')`);
  await denied(db,`select * from public.sync_admin_runs(null)`);
  const rows=(await db.query(`select status from public.sync_admin_runs('correct horse battery', 10)`)).rows;
  assert.deepEqual(rows.map(r=>r.status),['error','ok']);  // newest first
  const limited=(await db.query(`select 1 from public.sync_admin_runs('correct horse battery', 1)`)).rows;
  assert.equal(limited.length,1);
  await db.close();
});

test('review page flags a stale Kakao check and summarizes runs for the admin view',()=>{
  const vm=require('node:vm'),acorn=require('acorn');
  const html=fs.readFileSync('index.html','utf8'),names=['kakaoSyncIsStale','formatSyncRun'];let source='';
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))for(const n of acorn.parse(m[1],{ecmaVersion:'latest'}).body)
    if(n.type==='FunctionDeclaration'&&names.includes(n.id.name))source+=m[1].slice(n.start,n.end)+'\n';
  const c={};vm.createContext(c);vm.runInContext(source,c);
  const now=new Date('2026-09-24T12:00:00Z');
  assert.equal(c.kakaoSyncIsStale(new Date('2026-09-24T11:01:00Z'),now),false);  // 59 minutes: two runs may be pending
  assert.equal(c.kakaoSyncIsStale(new Date('2026-09-24T10:59:00Z'),now),true);
  assert.equal(c.formatSyncRun({status:'ok',operation_count:0,held_count:0,elapsed_seconds:23.4}).text,'변경 없음 · 23초');
  assert.equal(c.formatSyncRun({status:'ok',operation_count:3,held_count:1,recovery:'recovered:board_refresh',elapsed_seconds:47.9}).text,
    '반영 3건 · 보류 1건 · 자동 복구 후 성공 · 48초');
  const failed=c.formatSyncRun({status:'error',error_kind:'recovery_action_required',recovery:'blocked:chat_window_not_open',consecutive_failures:3,elapsed_seconds:4});
  assert.deepEqual([failed.ok,failed.text],[false,'자동 복구에 확인 필요 · 채팅창 닫힘 · 연속 3회 · 4초']);
});
