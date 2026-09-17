const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const cli=process.env.PLAYWRIGHT_CLI||path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh');
const sdk=fs.readFileSync('tests/fixtures/v2-mock-sdk.js','utf8')+`
__v2Mock.account.role='admin';
window.__adminAccount={user_id:'22222222-2222-4222-8222-222222222222',requested_name:'승인 시험 회원',member_id:null,role:'member',status:'pending',created_at:'2026-09-17T00:00:00Z',updated_at:'2026-09-17T00:00:00Z'};
window.__adminCalls=[];
const originalCreate=window.supabase.createClient;
window.supabase.createClient=function(){const c=originalCreate();const rpc=c.rpc;c.rpc=async(name,p)=>{
 if(name==='v2_admin_list_accounts')return{data:[structuredClone(__adminAccount)],error:null};
 if(name==='v2_admin_manage_account'){__adminCalls.push(p);Object.assign(__adminAccount,{status:p.p_status,member_id:p.p_member_id,updated_at:new Date().toISOString()});return{data:structuredClone(__adminAccount),error:null};}
 return rpc(name,p);
};return c;};`;
const viewport=process.argv.includes('--mobile')?{width:390,height:844}:{width:1280,height:900};
const code=fs.readFileSync('tests/v2-admin-browser-smoke.js','utf8').replace('MOCK_SDK_SOURCE',JSON.stringify(sdk)).replace('VIEWPORT',JSON.stringify(viewport));
const r=spawnSync(cli,['-s=v2-admin-test','run-code',code],{encoding:'utf8',timeout:120000});
const output=r.stdout?.split('### Ran Playwright code')[0]||'';assert.equal(r.status,0,output||r.stderr);
const match=/### Result\s*\n([^\n]+)/.exec(output);assert.ok(match,output);const result=JSON.parse(match[1]);
assert.deepEqual(result.errors,[]);assert.deepEqual(result.states,['approved','disabled','approved']);assert.equal(result.member,'member-b');assert.equal(result.role,'member');assert.equal(result.hasRoleInput,false);assert.equal(result.versionArguments,true);assert.equal(result.hiddenAfterRevocation,true);assert.equal(result.remainingRows,'');
console.log(JSON.stringify({viewport,...result},null,2));
