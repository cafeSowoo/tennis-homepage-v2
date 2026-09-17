/* Member approval UI. All authorization and account transitions are checked by the RPC. */
window.V2MemberAdmin = {
  create({client, isAdmin, members, userId}) {
    const button = document.querySelector('#memberAdminButton');
    const dialog = document.createElement('dialog');
    dialog.id = 'memberAdminDialog';
    dialog.setAttribute('aria-labelledby', 'memberAdminTitle');
    dialog.style.cssText = 'width:min(720px,calc(100% - 24px));max-height:85dvh;border:0;border-radius:20px;padding:24px;color:#1d1d1f;background:white;overflow:auto';
    dialog.innerHTML = `<div class="flex items-center justify-between gap-3"><h2 id="memberAdminTitle" class="text-xl font-bold">회원 승인 관리</h2><button type="button" class="btn-outline px-3 py-2" data-close>닫기</button></div>
      <p class="mt-3 text-sm">카카오 닉네임만으로 본인을 판단하지 말고, 회원에게 확인한 뒤 명단에서 직접 선택해 주세요.</p>
      <p class="mt-2 text-xs text-on-surface-variant">기존 Google 계정과 관리자 계정의 권한은 여기서 변경하지 않습니다.</p>
      <div class="my-4 flex flex-wrap gap-2"><select aria-label="승인 상태 필터" class="rounded-lg border p-2"><option value="pending">승인 대기</option><option value="approved">승인 완료</option><option value="disabled">이용 중지</option></select><button type="button" class="btn-outline px-3 py-2" data-refresh>새로고침</button></div>
      <p data-notice role="status" aria-live="polite" class="mb-3 text-sm"></p><div data-accounts class="space-y-3"></div>`;
    document.body.append(dialog);
    const list = dialog.querySelector('[data-accounts]'), notice = dialog.querySelector('[data-notice]');
    const filter = dialog.querySelector('select'), refresh = dialog.querySelector('[data-refresh]');
    let accounts=[], epoch=0, busy=false, owner=null;
    const statuses={pending:'승인 대기',approved:'승인 완료',disabled:'이용 중지'};
    const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    function valid(n,actor){return epoch===n && isAdmin() && userId()===actor && dialog.open;}
    function invalidate(){epoch++;accounts=[];owner=null;busy=false;list.replaceChildren();notice.textContent='';if(dialog.open)dialog.close();}
    function sync(){button.hidden=!isAdmin();button.classList.toggle('hidden',!isAdmin());if(!isAdmin() || (owner && owner!==userId()))invalidate();}
    function showError(error){
      const messages={'42501':'관리자 권한이 없거나 변경할 수 없는 계정입니다.','40001':'다른 관리자가 먼저 변경했습니다. 새로고침 후 확인해 주세요.','23505':'이 회원에게 이미 승인된 카카오 계정이 있습니다. 중복 가입인지 확인해 주세요.','22023':'활성 회원을 선택해 주세요. 이미 연결된 회원은 다른 사람으로 변경할 수 없습니다.','P0002':'계정을 찾을 수 없습니다. 새로고침해 주세요.'};
      return messages[error?.code] || '처리하지 못했습니다. 연결 상태를 확인하고 새로고침해 주세요.';
    }
    function render(){
      list.replaceChildren();
      const rows=accounts.filter(a=>a.status===filter.value);
      if(!rows.length){list.append(node('p','해당 상태의 회원이 없습니다.','py-6 text-center text-sm'));return;}
      for(const a of rows){
        const card=node('article',undefined,'rounded-xl border p-4');
        const member=members().find(m=>String(m.id)===a.member_id);
        card.append(node('h3',a.requested_name || '닉네임 없음','font-bold'));
        card.append(node('p',`${statuses[a.status]} · 가입 ${new Date(a.created_at).toLocaleDateString('ko-KR')} · 계정 ${a.user_id.slice(0,8)}`,'mt-1 text-xs text-on-surface-variant'));
        card.append(node('p',`연결 회원: ${member?.name || (a.member_id ? '비활성 또는 삭제된 회원' : '미연결')}`,'my-3 text-sm'));
        if(a.role==='admin' || a.user_id===userId()){
          card.append(node('p','관리자 보호 계정','text-sm'));list.append(card);continue;
        }
        let select;
        if(a.status!=='approved'){
          select=node('select');select.className='w-full rounded-lg border p-2 mb-3';select.setAttribute('aria-label',`${a.requested_name||'닉네임 없음'} 연결 회원`);
          const blank=node('option','회원 명단에서 선택');blank.value='';select.append(blank);
          for(const m of members().filter(m=>(m.status||'active')==='active' && (!a.member_id||String(m.id)===a.member_id)).sort((x,y)=>x.name.localeCompare(y.name,'ko'))){
            const o=node('option',`${m.name} (${m.id})`);o.value=m.id;select.append(o);
          }
          select.value=a.member_id||'';select.disabled=busy;card.append(select);
        }
        const actions=node('div',undefined,'flex gap-2');
        if(a.status!=='approved'){
          const approve=node('button',a.status==='disabled'?'이용 재개':'승인','btn-primary px-4 py-2');approve.type='button';approve.disabled=busy;
          approve.addEventListener('click',()=>change(a,select.value,'approved'));actions.append(approve);
        }
        if(a.status!=='disabled'){
          const disable=node('button','이용 중지','btn-outline px-4 py-2');disable.type='button';disable.disabled=busy;
          disable.addEventListener('click',()=>change(a,a.member_id,'disabled'));actions.append(disable);
        }
        card.append(actions);list.append(card);
      }
    }
    async function load(success=''){
      const n=++epoch,actor=userId();
      if(!isAdmin()){invalidate();return;}
      owner=actor;busy=true;refresh.disabled=true;list.replaceChildren();notice.textContent='불러오는 중…';
      try{
        const rows=[];
        for(let offset=0;;offset+=200){
          const {data,error}=await client().rpc('v2_admin_list_accounts',{p_offset:offset});
          if(!valid(n,actor))return;if(error)throw error;
          rows.push(...data);if(data.length<200)break;
        }
        accounts=rows;notice.textContent=success || `승인 대기 ${rows.filter(a=>a.status==='pending').length}명`;
      }catch(error){if(valid(n,actor)){accounts=[];notice.textContent=(success?success+' 목록 새로고침에 실패했습니다. ': '')+showError(error);}}
      finally{if(valid(n,actor)){busy=false;refresh.disabled=false;render();}}
    }
    async function change(account,memberId,status){
      if(busy||!isAdmin())return;
      const member=members().find(m=>String(m.id)===memberId);
      if(status==='approved' && !member){notice.textContent='연결할 회원을 직접 선택해 주세요.';return;}
      const message=status==='approved'?`${account.requested_name||'닉네임 없음'} 계정을 ${member.name} 회원으로 승인할까요?`:`${account.requested_name||'닉네임 없음'} 계정의 이용을 중지할까요? 기존 일정과 댓글은 보존됩니다.`;
      if(!window.confirm(message))return;
      const n=epoch,actor=userId();busy=true;refresh.disabled=true;render();notice.textContent='저장 중…';
      try{
        const {error}=await client().rpc('v2_admin_manage_account',{p_user_id:account.user_id,p_member_id:memberId||null,p_status:status,p_expected_updated_at:account.updated_at});
        if(!valid(n,actor))return;if(error)throw error;
        await load(status==='approved'?'승인했습니다. 해당 회원에게 새로고침을 안내해 주세요.':'이용을 중지했습니다.');
      }catch(error){if(valid(n,actor)){busy=false;refresh.disabled=false;notice.textContent=showError(error);render();}}
    }
    button.addEventListener('click',()=>{if(!isAdmin())return;dialog.showModal();filter.value='pending';void load();});
    dialog.querySelector('[data-close]').addEventListener('click',invalidate);
    dialog.addEventListener('cancel',invalidate);
    refresh.addEventListener('click',()=>{if(!busy)void load();});
    filter.addEventListener('change',render);
    return {sync,invalidate};
  }
};
