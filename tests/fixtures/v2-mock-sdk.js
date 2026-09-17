window.__v2Mock={
 user:{id:'11111111-1111-4111-8111-111111111111',app_metadata:{provider:'kakao'},user_metadata:{nickname:'테스트 회원'}},
 account:{user_id:'11111111-1111-4111-8111-111111111111',member_id:'member-a',status:'approved',role:'member'},
 tables:{members:[{id:'member-a',name:'테스트 회원',status:'active'},{id:'member-b',name:'다른 회원',status:'active'}],courts:[{id:'court-a',name:'테스트 코트',type:'인조잔디',location:'인천'}],court_units:[],v2_schedules:[],v2_schedule_rsvps:[],v2_discussions:[]},calls:[]
};
window.supabase={createClient(){const m=window.__v2Mock;return {
 auth:{getSession:async()=>({data:{session:m.user?{user:m.user}:null}}),onAuthStateChange:fn=>{m.onAuth=fn;return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>{m.user=null;m.onAuth('SIGNED_OUT',null);return{};}},
 from(table){let filters=[];const q={select(){return q},order(){return q},eq(k,v){filters.push([k,v]);return q},range(a,b){return Promise.resolve({data:read().slice(a,b+1),error:null})},maybeSingle(){return Promise.resolve({data:read()[0]||null,error:null})},then(resolve,reject){return Promise.resolve({data:read(),error:null}).then(resolve,reject)}};function read(){return (table==='club_member_accounts'?[m.account]:(m.tables[table]||[])).filter(r=>filters.every(([k,v])=>r[k]===v));}return q;},
 async rpc(name,p){m.calls.push({name,args:p});let s=m.tables.v2_schedules.find(x=>x.id===p.p_id);const now=new Date().toISOString();
 if(name==='v2_create_schedule'){s={...p.p_input,id:p.p_id,host_member_id:p.p_input.host?'member-a':null,creator_member_id:'member-a',creator_name_snapshot:'테스트 회원',court_name_snapshot:'테스트 코트',version:1,status:'active',created_at:now,updated_at:now};m.tables.v2_schedules.push(s);}
 if(name==='v2_update_schedule'){Object.assign(s,p.p_input,{version:s.version+1,updated_at:now});}
 if(name==='v2_cancel_schedule'){s.status='cancelled';s.version++;}
 if(name==='v2_set_my_rsvp'){m.tables.v2_schedule_rsvps=m.tables.v2_schedule_rsvps.filter(x=>x.schedule_id!==p.p_id);m.tables.v2_schedule_rsvps.push({schedule_id:p.p_id,member_id:'member-a',state:p.p_state});}
 if(name==='v2_add_discussion'){m.tables.v2_discussions.push({id:p.p_id,schedule_id:p.p_schedule_id,member_id:'member-a',message:p.p_message,created_at:now});}
 if(name==='v2_delete_discussion'){m.tables.v2_discussions=m.tables.v2_discussions.filter(x=>x.id!==p.p_id);return{data:true,error:null};}
 return {data:s||{},error:null};}
};}};
