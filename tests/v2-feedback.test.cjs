const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('feedback privacy, input validation, retry identity and admin optimistic locking',async()=>{
 const db=new PGlite();
 try {
 await db.exec(fs.readFileSync('tests/v2-database.test.cjs','utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
 for(const suffix of ['club_member_accounts_and_member_rsvp','v2_independent_schedules','v2_feedback','v2_feedback_admin_delete']) {
 const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+suffix+'.sql'));await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8')); }
 const [a,b,admin,pending]=Array.from({length:4},randomUUID),id=randomUUID();
 for(const [i,uid] of [a,b,admin,pending].entries()) {
 await db.query('insert into auth.users(id) values($1)',[uid]);await db.query("insert into members values($1,$2,'active')",['m'+i,'Member '+i]);
 await db.query("insert into club_member_accounts(user_id,member_id,role,status) values($1,$2,$3,$4)",[uid,'m'+i,uid===admin?'admin':'member',uid===pending?'pending':'approved']); }
 async function actor(uid,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid,role})]);await db.exec('set role '+role);}
 const submit=(body='<b>literal</b>',which=id,version='development')=>db.query("select * from v2_submit_feedback($1,'error',$2,'dashboard',null,$3)",[which,body,version]);
 const list=()=>db.query('select * from v2_feedback');
 const change=(version=1)=>db.query("select * from v2_set_feedback_status($1,'resolved',$2)",[id,version]);
 const remove=(version=1)=>db.query("select v2_delete_feedback($1,$2)",[id,version]);
 const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 await actor(a); const row=(await submit()).rows[0];assert.equal(row.author_user_id,a);assert.equal(row.member_id,'m0');assert.equal(row.status,'new');assert.equal(row.body,'<b>literal</b>');
 await submit();assert.equal((await list()).rows.length,1);
 await deny(()=>submit('changed'),'23505');await deny(()=>submit(' ',randomUUID()),'22023');await deny(()=>submit('x'.repeat(4001),randomUUID()),'22023');await deny(()=>submit('body',randomUUID(),'token=secret'),'22023');
 await deny(()=>change(),'42501');await deny(()=>remove(),'42501');
 for(const sql of ["update v2_feedback set status='resolved'",'delete from v2_feedback',"insert into v2_feedback(id) values(gen_random_uuid())"]) await deny(()=>db.exec(sql),'42501');
 await actor(b);assert.equal((await list()).rows.length,0);await deny(()=>submit(),'42501');await submit('mine',randomUUID());assert.equal((await list()).rows.length,1);
 await actor(admin);assert.equal((await list()).rows.length,2);assert.equal((await change()).rows[0].version,2);await deny(()=>change(),'40001');await deny(()=>remove(),'40001');assert.equal((await remove(2)).rows[0].v2_delete_feedback,true);assert.equal((await list()).rows.length,1);
 await actor(pending);assert.equal((await list()).rows.length,0);await deny(()=>submit(),'42501');
 await actor(null,'anon');await deny(list,'42501');await deny(()=>submit(),'42501');
 await db.exec('reset role');await db.query("update club_member_accounts set status='disabled' where user_id=$1",[a]);await actor(a);assert.equal((await list()).rows.length,0);await deny(()=>submit(),'42501');
 } finally {await db.close();}
});
test('feedback scripts parse and are included in the deployment',()=>{
 const acorn=require('acorn');for(const file of ['v2-feedback.js','build-info.js']) acorn.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest'});
 const html=fs.readFileSync('index.html','utf8'),workflow=fs.readFileSync('.github/workflows/pages.yml','utf8');
 for(const file of ['v2-feedback.js','build-info.js']) {assert(html.includes('src="'+file+'"'));assert(workflow.includes(file));}
});
