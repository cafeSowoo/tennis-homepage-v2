const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('admin approval RPC enforces identity, role, active membership and stale-write boundaries',async()=>{
 const db=new PGlite();
 try{
 const base=fs.readFileSync('tests/v2-database.test.cjs','utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1];
 await db.exec(base);
 await db.exec(fs.readFileSync('supabase/migrations/20260916152242_club_member_accounts_and_member_rsvp.sql','utf8'));
 const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_v2_member_approval_admin.sql'));
 await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const [admin,user,target,duplicate,google]=Array.from({length:5},randomUUID);
 await db.exec("insert into members values ('admin','Admin','active'),('user','User','active'),('target','Target','active'),('inactive','Inactive','inactive');");
 for(const id of [admin,user,target,duplicate,google]) await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[id,JSON.stringify({provider:id===google?'google':'kakao'})]);
 for(const [id,member,status,role] of [[admin,'admin','approved','admin'],[user,'user','approved','member'],[target,null,'pending','member'],[duplicate,null,'pending','member'],[google,null,'pending','member']]){
  await db.query("insert into club_member_accounts(user_id,member_id,status,role,provider) values($1,$2,$3,$4,'kakao')",[id,member,status,role]);
 }
 async function actor(id,role='authenticated') {await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role})]);await db.exec('set role '+role);}
 async function row(id){return (await db.query('select * from club_member_accounts where user_id=$1',[id])).rows[0];}
 const list=()=>db.query('select * from v2_admin_list_accounts(0)');
 const manage=(id,member,status,version)=>db.query('select * from v2_admin_manage_account($1,$2,$3,$4)',[id,member,status,version]);
 const denies=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 await actor(user);await denies(list,'42501');await denies(()=>manage(target,'target','approved',new Date()),'42501');
 assert.equal((await db.query("update club_member_accounts set role='admin' where user_id=$1 returning *",[user])).rows.length,0);
 await actor(null,'anon');await denies(list,'42501');
 await actor(admin);const rows=(await list()).rows;assert.equal(rows.length,4);assert(!rows.some(x=>x.user_id===google));
 const initial=await row(target);
 await denies(()=>manage(target,'inactive','approved',initial.updated_at),'22023');
 await denies(()=>manage(target,'target','admin',initial.updated_at),'22023');
 await manage(target,'target','approved',initial.updated_at);
 const approved=await row(target);assert.equal(approved.status,'approved');assert.equal(approved.role,'member');assert.equal(approved.member_id,'target');assert(approved.approved_at);
 await denies(()=>manage(target,'target','disabled',initial.updated_at),'40001');
 const dup=await row(duplicate);await denies(()=>manage(duplicate,'target','approved',dup.updated_at),'23505');
 await denies(()=>manage(target,'user','approved',approved.updated_at),'22023');
 await denies(()=>manage(target,null,'disabled',approved.updated_at),'22023');
 await manage(target,'target','disabled',approved.updated_at);const disabled=await row(target);assert.equal(disabled.member_id,'target');assert.equal(disabled.status,'disabled');
 await actor(target);assert.equal((await db.query('select club_private.club_current_member_id() as id')).rows[0].id,null);await denies(list,'42501');
 await actor(admin);await manage(target,'target','approved',disabled.updated_at);
 await denies(()=>manage(admin,'admin','disabled',(new Date()).toISOString()),'42501');
 await denies(()=>manage(google,null,'disabled',(new Date()).toISOString()),'42501');
 await db.exec('reset role');await db.query("update club_member_accounts set status='disabled' where user_id=$1",[admin]);
 await actor(admin);await denies(list,'42501');await denies(()=>manage(target,'target','disabled',approved.updated_at),'42501');
 }finally{await db.close();}
});
