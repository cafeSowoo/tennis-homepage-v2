const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('member requests preserve approval boundaries and expose only candidate identity',async()=>{
 const db=new PGlite();
 try {
  await db.exec(fs.readFileSync('tests/v2-database.test.cjs','utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
  for(const suffix of ['club_member_accounts_and_member_rsvp','v2_member_approval_admin','v2_member_link_requests']) {
   const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+suffix+'.sql'));
   await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  }
  const [user,other,admin]=Array.from({length:3},randomUUID);
  await db.exec("insert into members values ('a','Same name','active'),('b','Same name','active'),('hidden','Inactive','inactive');");
  for(const id of [user,other,admin]) await db.query("insert into auth.users(id,raw_app_meta_data) values($1,'{\"provider\":\"kakao\"}')",[id]);
  await db.query("insert into club_member_accounts(user_id) values($1),($2)",[user,other]);
  await db.query("insert into club_member_accounts(user_id,member_id,status,role) values($1,'b','approved','admin')",[admin]);
  async function actor(id,role='authenticated') {await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role})]);await db.exec('set role '+role);}
  const submit=(kind,id,name)=>db.query('select * from v2_submit_member_request($1,$2,$3)',[kind,id,name]);
  const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  await actor(null,'anon');await denied(()=>submit('existing','a',null),'42501');
  await denied(()=>db.query('select * from v2_member_link_candidates()'),'42501');
  await actor(user);
  const candidates=(await db.query('select * from v2_member_link_candidates()')).rows;
  assert.deepEqual(candidates,[{id:'a',name:'Same name'},{id:'b',name:'Same name'}]);
  const before=(await db.query('select * from club_member_accounts')).rows[0];
  await denied(()=>submit('existing','hidden',null),'22023');
  await denied(()=>submit('existing','missing',null),'22023');
  await denied(()=>submit('new',null,'  '),'22023');
  await denied(()=>submit('new','a','Name'),'22023');
  let row=(await submit('existing','a','Forged name')).rows[0];
  assert.equal(row.requested_name,'Same name');assert.equal(row.requested_member_id,'a');
  assert.equal(row.member_id,null);assert.equal(row.status,'pending');assert.equal(row.role,'member');
  assert.equal(row.approved_at,null);assert(row.request_submitted_at);
  assert.equal((await db.query("update club_member_accounts set status='approved',member_id='a' returning *")).rows.length,0);
  row=(await submit('new',null,' New person ')).rows[0];
  assert.equal(row.requested_member_id,null);assert.equal(row.request_kind,'new');assert.equal(row.requested_name,'New person');
  await actor(other);assert.equal((await db.query('select * from club_member_accounts')).rows[0].request_kind,null);
  await actor(admin);
  await denied(()=>db.query('select * from v2_admin_manage_account($1,$2,$3,$4)',[user,'a','approved',before.updated_at]),'40001');
  const version=(await db.query('select updated_at from club_member_accounts where user_id=$1',[user])).rows[0].updated_at;
  await db.query('select * from v2_admin_manage_account($1,$2,$3,$4)',[user,'a','approved',version]);
  await actor(user);await denied(()=>submit('existing','b',null),'42501');
  await denied(()=>db.query('select * from v2_member_link_candidates()'),'42501');
  await db.exec('reset role');await db.query("update club_member_accounts set status='disabled' where user_id=$1",[user]);
  await actor(user);await denied(()=>submit('new',null,'Name'),'42501');
 } finally {await db.close();}
});
