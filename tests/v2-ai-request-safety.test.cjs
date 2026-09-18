const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const names=['setCaptureResultMode','invalidateAiTestAnalysis','clearAiTestImage','selectAiTestImage','analyzeAiTestImage'];
const functions=[];
for(const source of scripts) for(const n of acorn.parse(source,{ecmaVersion:'latest'}).body) if(n.type==='FunctionDeclaration'&&names.includes(n.id.name)) functions.push(source.slice(n.start,n.end));
function setup(){
 const nodes=new Map(),calls=[];let status='';
 const node=()=>({innerHTML:'분석하기',disabled:false,textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},removeAttribute(){}});
 const c={aiTestAnalysis:null,aiTestFile:null,aiTestPreviewUrl:'',aiTestDrafts:[],aiTestRawResponse:null,authState:{user:{id:'A'}},approved:true,
 document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);}},URL:{createObjectURL:()=> 'blob:mock',revokeObjectURL(){}},
 isApprovedMember:()=>c.approved,renderAiTestDrafts(){},makeAiTestDraft:x=>x,aiTestFormatBytes:()=>'',setAiTestStatus:x=>status=x,aiTestErrorMessage:async()=> 'failed',FormData:class{append(){}},
 supabaseClient:{functions:{invoke:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))}}};
 vm.createContext(c);vm.runInContext(functions.join('\n'),c);
 const choose=name=>c.selectAiTestImage({name,type:'image/png',size:100});
 return {c,calls,choose,status:()=>status,button:()=>nodes.get('#aiTestAnalyzeButton')};
}
const result=name=>({data:{schedules:[{facility_name:name}]}});
test('changing image ignores old success and failure without unlocking the new request',async()=>{
 for(const fail of [false,true]){
 const h=setup();h.choose('A');const a=h.c.analyzeAiTestImage();h.choose('B');const b=h.c.analyzeAiTestImage();
 if(fail)h.calls[0].reject(new Error('old'));else h.calls[0].resolve(result('A'));
 await a;assert.equal(h.c.aiTestDrafts.length,0);assert.equal(h.button().disabled,true);assert(h.button().innerHTML.includes('불러오는 중'));
 h.calls[1].resolve(result('B'));await b;assert.equal(h.c.aiTestDrafts[0].facility_name,'B');assert.equal(h.button().disabled,false);assert.equal(h.button().innerHTML,'분석하기');
 }
});
test('clear and logout leave no late AI result; changed identity and revoked approval reject responses',async()=>{
 for(const mode of ['clear','logout','identity','revoked']){
 const h=setup();h.choose('A');const a=h.c.analyzeAiTestImage();
 if(mode==='clear'||mode==='logout')h.c.clearAiTestImage();
 if(mode==='logout')h.c.authState.user=null;
 if(mode==='identity')h.c.authState.user={id:'B'};
 if(mode==='revoked')h.c.approved=false;
 h.calls[0].resolve(result('A'));await a;assert.equal(h.c.aiTestDrafts.length,0);assert.equal(h.c.aiTestRawResponse,null);
 }
 assert.match(html,/function clearV2Data\(\)[\s\S]*?clearAiTestImage\(\);/);
});
test('duplicate starts are suppressed and delayed error decoding cannot overwrite a replacement',async()=>{
 const h=setup();h.choose('A');let decode;h.c.aiTestErrorMessage=()=>new Promise(r=>decode=r);
 const a=h.c.analyzeAiTestImage();await h.c.analyzeAiTestImage();assert.equal(h.calls.length,1);
 h.calls[0].resolve({error:{}});await new Promise(setImmediate);
 h.choose('B');const b=h.c.analyzeAiTestImage();h.calls[1].resolve(result('B'));await b;
 decode('old error');await a;assert.equal(h.c.aiTestDrafts[0].facility_name,'B');assert(h.status().includes('건을 찾았습니다.'));assert.equal(h.button().innerHTML,'분석하기');
});
