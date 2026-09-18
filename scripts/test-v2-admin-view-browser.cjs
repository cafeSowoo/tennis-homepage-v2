const fs=require('node:fs'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const sdk=fs.readFileSync('tests/fixtures/v2-mock-sdk.js','utf8')+`
__v2Mock.account.role='admin';
__v2Mock.tables.v2_feedback=[{id:'own',author_user_id:__v2Mock.user.id,author_name:'나',category:'error',status:'new',body:'내 의견 테스트',view_name:'dashboard',client_version:'development',created_at:new Date().toISOString()},{id:'other',author_user_id:'other',author_name:'다른 회원',category:'error',status:'new',body:'타인 의견 테스트',view_name:'dashboard',client_version:'development',created_at:new Date().toISOString()}];`;
const code=`async page=>{
 await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true};'}));
 await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:${JSON.stringify(sdk)}}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:8766');
 await page.locator('#adminViewToggle').waitFor({state:'visible'});await page.locator('#feedbackButton').click();await page.getByText('타인 의견 테스트',{exact:true}).waitFor();
 await page.locator('#feedbackDialog [data-close]').click();await page.locator('#adminViewToggle').click();
 const hidden=await page.locator('#memberAdminButton').isHidden();await page.locator('#feedbackButton').click();await page.getByText('내 의견 테스트',{exact:true}).waitFor();
 const privateCount=await page.getByText('타인 의견 테스트',{exact:true}).count();const controls=await page.locator('#feedbackDialog article button').count();
 await page.locator('#feedbackDialog [data-close]').click();await page.screenshot({path:'output/playwright/member-view-mobile.png'});
 await page.locator('#adminViewToggle').click();const restored=await page.locator('#memberAdminButton').isVisible();
 const identity=await page.evaluate(()=>({id:authState.user.id,role:authState.memberAccount.role,overflow:document.documentElement.scrollWidth>innerWidth}));
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'output/playwright/admin-view-desktop.png'});
 return {hidden,privateCount,controls,restored,identity,errors};
}`;
const r=spawnSync('/Users/dorm/.codex/skills/playwright/scripts/playwright_cli.sh',['-s=admin-view-check','run-code',code],{encoding:'utf8',timeout:120000});const output=r.stdout.split('### Ran')[0];const m=/### Result\s*\n([^\n]+)/.exec(output);assert(m,output);const v=JSON.parse(m[1]);assert(v.hidden);assert(v.restored);assert.equal(v.privateCount,0);assert.equal(v.controls,0);assert.equal(v.identity.role,'admin');assert.equal(v.identity.overflow,false);assert.deepEqual(v.errors,[]);console.log(v);
