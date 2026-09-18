const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const cli=path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh');
const sdk=fs.readFileSync('tests/fixtures/v2-mock-sdk.js','utf8')+`
__v2Mock.tables.v2_feedback=[];
const originalCreate=window.supabase.createClient;
window.supabase.createClient=function(){const c=originalCreate();const rpc=c.rpc;c.rpc=async(name,p)=>{
 const rows=__v2Mock.tables.v2_feedback;
 if(name==='v2_submit_feedback'){let row=rows.find(x=>x.id===p.p_id);if(!row){row={id:p.p_id,category:p.p_category,body:p.p_body,view_name:p.p_view,schedule_id:p.p_schedule_id,client_version:p.p_client_version,status:'new',version:1,author_name:'테스트 회원',created_at:new Date().toISOString()};rows.push(row);}return{data:row,error:null};}
 if(name==='v2_set_feedback_status'){const row=rows.find(x=>x.id===p.p_id);row.status=p.p_status;row.version++;return{data:row,error:null};}
 return rpc(name,p);
};return c;};`;
const viewport=process.argv.includes('--mobile')?{width:390,height:844}:{width:1280,height:900};
const code=fs.readFileSync('tests/v2-feedback-browser-smoke.js','utf8').replace('MOCK_SDK_SOURCE',JSON.stringify(sdk)).replace('VIEWPORT',JSON.stringify(viewport));
const r=spawnSync(cli,['-s=v2-feedback-test','run-code',code],{encoding:'utf8',timeout:120000});
const output=r.stdout?.split('### Ran Playwright code')[0]||'';assert.equal(r.status,0,output||r.stderr);
const match=/### Result\s*\n([^\n]+)/.exec(output);assert.ok(match,output);const result=JSON.parse(match[1]);
assert.deepEqual(result.errors,[]);assert.equal(result.count,1);assert.equal(result.status,'resolved');assert.equal(result.safe,true);assert.equal(result.cleared,true);assert.equal(result.overflow,false);console.log(JSON.stringify({viewport,...result},null,2));
