const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../supabase/functions/parse-reservation-image/limits.ts');

test('oversized uploads are refused before the whole body is read',async()=>{
 const {readBodyWithin}=await load();
 await assert.rejects(readBodyWithin(new Request('https://x.test',{method:'POST',body:'x',headers:{'content-length':'999'}}),10),/TOO_LARGE/);
 let pulled=0;
 const stream=new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array(8));if(pulled>100)c.close();}});
 const req=new Request('https://x.test',{method:'POST',body:stream,duplex:'half'});
 await assert.rejects(readBodyWithin(req,20),/TOO_LARGE/);
 assert.ok(pulled<10,'reading stopped early');
 const ok=await readBodyWithin(new Request('https://x.test',{method:'POST',body:'hello'}),10);
 assert.equal(new TextDecoder().decode(ok),'hello');
});

test('AI drafts keep only well-formed dates and times and at most 20 rows',async()=>{
 const {cleanDraft}=await load();
 const row={use_date:'2026-10-03',start_time:'8:00',end_time:'24:00',facility_name:'코트',court_number:'2',status:'won',application_date:'2026.09.30',notification_date:null};
 const cleaned=cleanDraft({schedules:Array.from({length:25},()=>({...row}))});
 assert.equal(cleaned.schedules.length,20);
 assert.deepEqual(cleaned.schedules[0],{...row,start_time:'08:00',application_date:null});
 assert.equal(cleanDraft({schedules:[{...row,use_date:'2026-13-01',end_time:'25:00'}]}).schedules[0].use_date,null);
});
