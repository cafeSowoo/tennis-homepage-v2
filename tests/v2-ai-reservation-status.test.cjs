const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const html=fs.readFileSync('index.html','utf8');
const names=['aiReservationWarning','makeAiTestDraft','snapshotAiDraftForSchedule','fillAddScheduleFormFromAiDraft'];
const functions=[];
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))for(const n of acorn.parse(m[1],{ecmaVersion:'latest'}).body)if(n.type==='FunctionDeclaration'&&names.includes(n.id.name))functions.push(m[1].slice(n.start,n.end));
function setup(){
 const nodes=new Map();function get(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',className:'',dataset:{},reset(){},querySelector:get});return nodes.get(id);}
 const c={matchAiTestCourt:()=>({id:'court'}),matchAiTestCourtUnit:()=>null,document:{querySelector:get},crypto:{randomUUID:()=> 'id'},window:{setTimeout(){}},renderScheduleTimePicker(){},scrollScheduleTimePickerToSelection(){},renderAddScheduleFormOptions(){},renderAddScheduleCourtUnitOptions(){},aiScheduleImportQueue:[{},{}],aiScheduleImportPosition:0};
 vm.createContext(c);vm.runInContext(functions.join('\n'),c);return {c,get};
}
test('waiting and cancelled drafts are unselected, while normal reservations retain selection',()=>{
 const {c}=setup();for(const status of ['lottery_waiting','cancelled','won','paid','confirmed',null]){
 const d=c.makeAiTestDraft({status});assert.equal(d._selected,!['lottery_waiting','cancelled'].includes(status));assert.equal(c.snapshotAiDraftForSchedule(d).status,status);
 }
 assert(html.includes('data-ai-reservation-warning>${escapeHTML(aiReservationWarning(draft.status))}'));
});
test('reservation warnings survive handoff and clear when the next draft is confirmed',()=>{
 const {c,get}=setup();const indicator=get('#addScheduleAiImportStatus');
 for(const status of ['lottery_waiting','cancelled']){
 const draft=c.snapshotAiDraftForSchedule(c.makeAiTestDraft({status,use_date:'2026-10-01',start_time:'09:00',end_time:'12:00'}));
 c.fillAddScheduleFormFromAiDraft(draft);assert(indicator.textContent.includes(c.aiReservationWarning(status)));assert(indicator.className.includes('text-amber-700'));
 }
 c.aiScheduleImportPosition=1;c.fillAddScheduleFormFromAiDraft(c.snapshotAiDraftForSchedule(c.makeAiTestDraft({status:'confirmed'})));
 assert(!indicator.textContent.includes('취소'));assert(!indicator.textContent.includes('추첨'));assert(indicator.textContent.includes('2/2'));assert(indicator.className.includes('text-primary'));
});
