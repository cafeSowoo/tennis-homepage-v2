const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const sdk=fs.readFileSync('tests/fixtures/v2-mock-sdk.js','utf8')+`
Object.assign(__v2Mock.account,{member_id:null,status:'pending'});
const original=window.supabase.createClient;
window.supabase.createClient=function(){const c=original(),rpc=c.rpc;c.rpc=async(n,p)=>{
 if(n==='v2_member_link_candidates')return{data:__v2Mock.tables.members.map(({id,name})=>({id,name})),error:null};
 if(n==='v2_submit_member_request'){
 __v2Mock.calls.push({name:n,args:p});Object.assign(__v2Mock.account,{request_kind:p.p_kind,requested_member_id:p.p_member_id,requested_name:p.p_kind==='existing'?__v2Mock.tables.members.find(m=>m.id===p.p_member_id).name:p.p_name,request_submitted_at:new Date().toISOString()});return{data:__v2Mock.account,error:null};}
 return rpc(n,p);
};return c;};`;
const code=`async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true};'}));
 await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:${JSON.stringify(sdk)}}));
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:8766');
 await page.locator('[name=requestKind][value=existing]').check();
 await page.locator('[data-member] option[value=member-b]').waitFor({state:'attached'});
 await page.locator('[data-member]').selectOption('member-b');await page.locator('#memberRequest button[type=submit]').click();
 await page.locator('[data-waiting]').waitFor({state:'visible'});
 const existing=await page.locator('[data-summary]').innerText();
 await page.locator('[data-refresh]').first().click();
 await page.locator('[data-edit]').click();await page.locator('[name=requestKind][value=new]').check();await page.locator('[data-name]').fill('새 회원');
 await page.locator('#memberRequest button[type=submit]').click();await page.locator('[data-waiting]').waitFor({state:'visible'});
 const newly=await page.locator('[data-summary]').innerText();
 await page.evaluate(()=>__v2Mock.onAuth('TOKEN_REFRESHED',{user:__v2Mock.user}));
 await page.waitForFunction(()=>document.querySelector('[data-summary]').textContent.includes('새 회원'));
 await page.screenshot({path:'output/playwright/member-request-mobile.png'});
 const state=await page.evaluate(()=>({status:__v2Mock.account.status,member:__v2Mock.account.member_id,calls:__v2Mock.calls}));
 await page.locator('#authButton').click();await page.locator('#memberRequest').waitFor({state:'hidden'});
 return{errors,existing,newly,...state};
}`;
fs.mkdirSync('output/playwright',{recursive:true});
const r=spawnSync(path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh'),['-s=member-link','run-code',code],{encoding:'utf8',timeout:120000});
const output=r.stdout?.split('### Ran Playwright code')[0]||'';assert.equal(r.status,0,output||r.stderr);const match=/### Result\s*\n([^\n]+)/.exec(output);assert.ok(match,output);const result=JSON.parse(match[1]);assert.deepEqual(result.errors,[]);assert.match(result.existing,/다른 회원/);assert.match(result.newly,/새 회원/);assert.equal(result.status,'pending');assert.equal(result.member,null);assert.equal(result.calls.length,2);console.log(JSON.stringify(result,null,2));
