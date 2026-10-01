const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

// schema.sql is the idempotent base; these early Kakao migrations were folded into it
// and are not re-runnable on top of it.
const IN_SCHEMA_SQL=new Set([
 '20260912050101_kakao_schedule_metadata.sql',
 '20260912053018_kakao_sync_state.sql',
 '20260912055816_kakao_rsvp_sources.sql'
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

module.exports={freshDatabase};
