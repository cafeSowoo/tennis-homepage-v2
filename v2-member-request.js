/* A request never grants membership; the existing admin approval remains authoritative. */
window.V2MemberRequest = {
  create({client, account, userId, refresh}) {
    const root = document.querySelector('#memberRequest');
    root.innerHTML = `<form data-form class="mt-6 space-y-4 text-left">
      <fieldset><legend class="font-bold mb-3">기존 회원이신가요?</legend>
        <label class="block mb-3"><input type="radio" name="requestKind" value="existing" required> 기존 회원입니다</label>
        <label class="block"><input type="radio" name="requestKind" value="new" required> 신규 회원입니다</label>
      </fieldset>
      <label data-existing hidden class="block">내 이름 선택<select data-member class="block w-full border rounded-lg p-3 mt-2"><option value="">회원 명단에서 선택해 주세요</option></select></label>
      <label data-new hidden class="block">이름<input data-name maxlength="80" autocomplete="name" class="block w-full border rounded-lg p-3 mt-2"></label>
      <p class="text-sm">관리자가 확인한 뒤 승인합니다. 기존 회원은 이전 기록이 그대로 이어집니다.</p>
      <button class="btn-primary px-5 py-3" type="submit">요청하기</button>
    </form>
    <div data-waiting hidden class="mt-6 space-y-4"><p data-summary class="font-bold"></p><p>관리자 확인을 기다리고 있습니다.</p><button type="button" data-edit class="btn-outline px-4 py-2">요청 수정</button></div>
    <p data-notice role="status" aria-live="polite" class="mt-4 text-sm"></p>
    <button type="button" data-refresh class="btn-outline px-4 py-2 mt-4">승인 상태 확인</button>`;
    const form=root.querySelector('form'),select=root.querySelector('[data-member]'),name=root.querySelector('[data-name]'),notice=root.querySelector('[data-notice]');
    let key='',epoch=0,busy=false,loaded=false,loading=false;
    const eligible=()=>userId() && account()?.user_id===userId() && account()?.status==='pending' && !account()?.member_id;
    const valid=(n,id)=>epoch===n && userId()===id && eligible();
    const kind=()=>form.querySelector('input[name="requestKind"]:checked')?.value;
    function disable(value){busy=value;root.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);}
    async function candidates(){
      if(loaded||loading||!eligible())return;
      const n=epoch,id=userId();loading=true;notice.textContent='회원 명단을 불러오는 중입니다…';
      try{
        const {data,error}=await client().rpc('v2_member_link_candidates');
        if(!valid(n,id))return;if(error)throw error;
        select.replaceChildren(new Option('회원 명단에서 선택해 주세요',''));
        const counts=new Map();for(const m of data)counts.set(m.name,(counts.get(m.name)||0)+1);
        for(const m of data)select.add(new Option(counts.get(m.name)>1?`${m.name} (${m.id})`:m.name,m.id));
        select.value=account()?.requested_member_id||'';loaded=true;notice.textContent='';
      }catch{if(valid(n,id))notice.textContent='명단을 불러오지 못했습니다. 승인 상태 확인을 눌러 다시 시도해 주세요.';}
      finally{if(valid(n,id))loading=false;}
    }
    function fields(){
      const existing=kind()==='existing';root.querySelector('[data-existing]').hidden=!existing;
      root.querySelector('[data-new]').hidden=kind()!=='new';select.required=existing;name.required=kind()==='new';
      if(existing)void candidates();
    }
    function show(edit=false){
      const a=account(),submitted=Boolean(a?.request_submitted_at)&&!edit;
      form.hidden=submitted;root.querySelector('[data-waiting]').hidden=!submitted;
      root.querySelector('[data-summary]').textContent=a?.request_kind==='existing'?`${a.requested_name} 회원으로 연결 요청 중입니다.`:`${a?.requested_name||''} 님의 신규 가입 요청입니다.`;
      for(const radio of form.querySelectorAll('[name="requestKind"]'))radio.checked=radio.value===a?.request_kind;
      name.value=a?.request_kind==='new'?a.requested_name||'':'';select.value=a?.requested_member_id||'';
      if(!submitted)fields();
    }
    function sync(){
      const next=eligible()?`${userId()}:${account().request_submitted_at||''}`:'';
      root.hidden=!next;if(next===key)return;
      key=next;epoch++;loaded=false;loading=false;disable(false);notice.textContent='';form.reset();select.replaceChildren(new Option('회원 명단에서 선택해 주세요',''));
      if(next)show();
    }
    form.addEventListener('change',fields);
    root.querySelector('[data-edit]').addEventListener('click',()=>show(true));
    root.querySelector('[data-refresh]').addEventListener('click',async()=>{
      if(busy)return;const n=epoch,id=userId();disable(true);notice.textContent='확인 중입니다…';
      try{await refresh();if(valid(n,id)){notice.textContent='아직 승인 대기 중입니다.';if(kind()==='existing'&&!loaded)void candidates();}}
      catch{if(valid(n,id))notice.textContent='상태를 확인하지 못했습니다. 다시 시도해 주세요.';}
      finally{if(valid(n,id))disable(false);}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!eligible()||!form.reportValidity())return;
      const selectedKind=kind(),newName=name.value.trim();
      if(selectedKind==='new'&&!newName){notice.textContent='이름을 입력해 주세요.';return;}
      const n=epoch,id=userId();disable(true);notice.textContent='요청을 저장하고 있습니다…';
      try{
        const {error}=await client().rpc('v2_submit_member_request',{p_kind:selectedKind,p_member_id:selectedKind==='existing'?select.value:null,p_name:selectedKind==='new'?newName:null});
        if(!valid(n,id))return;if(error)throw error;
        try{await refresh();}catch{if(valid(n,id))notice.textContent='요청은 저장됐지만 상태를 불러오지 못했습니다. 승인 상태 확인을 눌러 주세요.';}
      }catch{if(valid(n,id))notice.textContent='요청을 저장하지 못했습니다. 승인 상태를 확인한 뒤 다시 시도해 주세요.';}
      finally{if(valid(n,id))disable(false);}
    });
    return {sync};
  }
};
