const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

// schema.sql is the idempotent base; these early Kakao migrations were folded into it
// and are not re-runnable on top of it.
const IN_SCHEMA_SQL=new Set([
 '20260912050547_kakao_schedule_metadata.sql',
 '20260912054128_kakao_sync_state.sql',
 '20260912060214_kakao_rsvp_sources.sql'
]);

async function freshDatabase(){
 const db=new PGlite();
 // Supabase provides these; bcrypt is replaced by a deterministic stand-in because PGlite has no pgcrypto.
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema extensions; create schema storage;
 create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
 alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 create function extensions.crypt(p text, salt text) returns text language sql immutable as $$select 'test-hash:'||md5(p)$$;
 create function extensions.gen_salt(t text) returns text language sql as $$select 'salt'$$;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
 grant usage on schema auth, extensions to anon, authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
 for(const file of fs.readdirSync('supabase/migrations').sort()){
  if(IN_SCHEMA_SQL.has(file))continue;
  try{await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));}
  catch(error){throw new Error(`${file}: ${error.message}`);}
 }
 return db;
}

test('schema.sql plus every migration builds a fresh database in file order',async()=>{
 const db=await freshDatabase();
 const {rows}=await db.query(`select to_regprocedure('public.review_kakao_comments(text,text)') is not null as ok`);
 assert.equal(rows[0].ok,true);
 await db.close();
});

test('review login hands out expiring tokens and locks out repeated wrong passwords',async()=>{
 const db=await freshDatabase();
 await db.exec(`insert into club_private.review_access_config(password_hash) values (extensions.crypt('club-pass','salt'))`);
 const legacy=(await db.query(`select access_token::text t from club_private.review_access_config`)).rows[0].t;
 await db.exec(`grant usage on schema public to anon; set role anon`);
 const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
 const login=async p=>(await one(`select public.review_access_login($1) v`,[p])).v;
 const valid=async t=>(await one(`select public.review_access_check($1) v`,[t])).v;
 const renew=async t=>(await one(`select public.review_access_renew($1) v`,[t])).v;

 const token=await login('club-pass');
 assert.match(token,/^[0-9a-f-]{36}$/);
 assert.notEqual(token,legacy,'each login gets its own token');
 assert.equal(await valid(token),true);
 assert.equal(await renew(token),token,'renewing keeps the same token');
 assert.equal(await valid('00000000-0000-0000-0000-000000000000'),false);

 const legacyStillAccepted=Date.now()<Date.parse('2026-10-16T00:00:00+09:00');
 assert.equal(await valid(legacy),legacyStillAccepted);
 const traded=await renew(legacy);
 if(legacyStillAccepted){assert.notEqual(traded,legacy);assert.equal(await valid(traded),true);}
 else assert.equal(traded,null);

 for(let i=0;i<10;i++)assert.equal(await login('wrong-pass'),null);
 await assert.rejects(login('club-pass'),/Too many attempts/,'even the right password waits out the lock');

 await db.exec(`reset role; update club_private.review_access_sessions set expires_at=clock_timestamp()-interval '1 second' where token::text='${token}'; set role anon`);
 assert.equal(await valid(token),false,'idle tokens lapse');
 assert.equal(await renew(token),null);
 await assert.rejects(db.query(`select * from club_private.review_access_sessions`),/permission denied/);
 await db.close();
});

test('AI image reads are capped per login each hour',async()=>{
 const db=await freshDatabase();
 await db.exec(`grant usage on schema public to anon, authenticated`);
 const claim=async()=>(await db.query(`select public.claim_ai_image_request() v`)).rows[0].v;
 await db.exec(`set role authenticated; select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',false)`);
 for(let i=0;i<30;i++)assert.equal(await claim(),true);
 assert.equal(await claim(),false,'the 31st read in an hour is refused');
 await db.exec(`select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',false)`);
 assert.equal(await claim(),true,'other logins keep their own allowance');
 await db.exec(`select set_config('request.jwt.claims','',false)`);
 assert.equal(await claim(),false,'no login, no read');
 await db.exec(`reset role; set role anon`);
 await assert.rejects(db.query(`select public.claim_ai_image_request()`),/permission denied/);
 await db.close();
});

module.exports={freshDatabase};
