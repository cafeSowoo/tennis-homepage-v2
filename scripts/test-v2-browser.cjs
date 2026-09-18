// Requires a local server on 127.0.0.1:8766 and the playwright skill CLI.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const cli=process.env.PLAYWRIGHT_CLI || path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh');
const session='v2-independent';
const viewport=process.argv.includes('--mobile')?{width:390,height:844}:{width:1280,height:900};
let code=fs.readFileSync('tests/v2-browser-smoke.js','utf8').replace('MOCK_SDK_SOURCE',JSON.stringify(fs.readFileSync('tests/fixtures/v2-mock-sdk.js','utf8'))).replace('VIEWPORT',JSON.stringify(viewport));
const r=spawnSync(cli,['-s='+session,'run-code',code],{encoding:'utf8',timeout:120000});
const output=r.stdout?.split('### Ran Playwright code')[0]||'';
assert.equal(r.status,0,output||r.stderr);
const match=/### Result\s*\n([^\n]+)/.exec(output);assert.ok(match,output);
const result=JSON.parse(match[1]);
assert.deepEqual(result.errors,[]);assert.equal(result.titleSafety,true);
assert.equal(result.cancelled.responses,1);assert.equal(result.cancelled.comments,1);
assert.equal(result.cancelled.join,false);assert.equal(result.cancelled.composer,false);assert.equal(result.cancelled.deleteComment,true);
assert.equal(result.loggedOut.detail,'');assert.equal(result.loggedOut.schedules,0);assert.equal(result.loggedOut.gate,true);
assert.deepEqual(result.loggedOut.calls,['v2_create_schedule','v2_update_schedule','v2_set_my_rsvp','v2_add_discussion','v2_cancel_schedule','v2_delete_discussion']);
console.log(JSON.stringify({viewport,...result},null,2));
