// Read-only diagnostic. Executes downloaded worker code only in a restricted mock context.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
async function probe(file,scope){
 const handlers={},deleted=[],navigated=[];
 const context={URL,self:{registration:{scope},location:{origin:'https://cafesowoo.github.io'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}}},
 caches:{keys:async()=>['tennis-homepage-old','tennis-homepage-v2-probe'],delete:async key=>{deleted.push(key);return true;}},
 clients:{matchAll:async()=>[{url:'https://cafesowoo.github.io/tennis-homepage-v2/',focus(){},navigate:async url=>navigated.push(url)}],openWindow:async url=>navigated.push(url)}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{timeout:1000});
 let pending;
 handlers.activate({waitUntil:p=>pending=p});await pending;
 handlers.notificationclick({notification:{close(){},data:{url:'https://cafesowoo.github.io/tennis-homepage/'}},waitUntil:p=>pending=p});await pending;
 return {deleted,navigated};
}
(async()=>{
 const legacy=await probe('tmp/v1-deployed-sw.js','https://cafesowoo.github.io/tennis-homepage/');
 const current=await probe('sw.js','https://cafesowoo.github.io/tennis-homepage-v2/');
 assert(legacy.deleted.includes('tennis-homepage-v2-probe'));
 assert.deepEqual(current.deleted,['tennis-homepage-v2-probe']);
 assert(current.navigated.every(url=>url.startsWith('https://cafesowoo.github.io/tennis-homepage-v2/')));
 console.log(JSON.stringify({legacy,current,finding:'V1 activation deletes V2 cache; V1 notification can navigate a V2 window. V2 cannot prevent V1 same-origin code from doing so.'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
