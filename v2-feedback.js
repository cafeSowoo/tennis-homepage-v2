/* Private pilot feedback. All member-provided strings use textContent. */
window.V2Feedback = {
  create({client, isApproved, isAdmin, userId, context, scheduleTitle, isReviewMode = () => false, reviewToken = () => '', memberId = () => '', memberName = () => ''}) {
    const button = document.createElement('button');
    button.id = 'feedbackButton'; button.type = 'button'; button.textContent = '의견 보내기'; button.hidden = true;
    document.body.append(button);
    const dialog = document.createElement('dialog');
    dialog.id = 'feedbackDialog'; dialog.setAttribute('aria-labelledby', 'feedbackHeading');
    dialog.innerHTML = `<div class="feedback-header"><h2 id="feedbackHeading">의견 보내기</h2><button type="button" data-close>닫기</button></div>
      <p data-intro>작성자 본인과 관리자만 볼 수 있습니다. 비밀번호나 인증번호는 적지 마세요.</p>
      <form><label>종류<select name="category"><option value="error">오류</option><option value="inconvenience">불편</option><option value="suggestion">제안</option></select></label>
      <label>내용<textarea name="body" required maxlength="4000" rows="4" placeholder="무엇을 하려 했고, 실제로 어떻게 되었나요?"></textarea></label>
      <p data-context></p><button type="submit">의견 등록</button></form>
      <p data-notice role="status" aria-live="polite"></p>
      <div data-history><div class="feedback-header"><h3 data-list-title>내 의견</h3><button type="button" data-refresh>새로고침</button></div>
      <div data-list></div><button type="button" data-more hidden>더 보기</button></div>`;
    document.body.append(dialog);
    const $ = s => dialog.querySelector(s), form = $('form'), list = $('[data-list]'), notice = $('[data-notice]'), history = $('[data-history]'), intro = $('[data-intro]');
    const statuses = {new:'접수',in_progress:'확인 중',resolved:'수정 완료'};
    const categories = {error:'오류',inconvenience:'불편',suggestion:'제안'};
    const views = {dashboard:'홈',schedule:'일정 목록',detail:'일정 상세',members:'회원 목록','member-detail':'회원 상세',other:'기타 화면'};
    let epoch = 0, identity = '', busy = false, rows = [], captured = {}, request = null;
    const reviewing = () => Boolean(isReviewMode());
    const key = () => reviewing() ? `review:${memberId() || ''}` : `${userId() || ''}:${isAdmin()}`;
    const valid = n => n === epoch && isApproved() && identity === key() && dialog.open;
    function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
    function lock(value) { busy = value; dialog.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = value && !el.matches('[data-close]'); }); }
    function invalidate() {
      epoch++; rows = []; request = null; captured = {}; identity = ''; list.replaceChildren(); notice.textContent = ''; form.reset(); lock(false);
      if (dialog.open) dialog.close();
    }
    function sync() {
      button.hidden = !isApproved();
      if (!isApproved() || (identity && identity !== key())) invalidate();
    }
    function render() {
      list.replaceChildren();
      if (!rows.length) list.append(node('p','아직 등록된 의견이 없습니다.'));
      for (const row of rows) {
        const article = document.createElement('article');
        article.append(node('h4', `${categories[row.category]} · ${statuses[row.status]}`));
        const body = node('p',row.body); body.className = 'feedback-body'; article.append(body);
        article.append(node('small',`${row.author_name} · ${new Date(row.created_at).toLocaleString('ko-KR')} · ${views[row.view_name] || '기타 화면'} · 버전 ${row.client_version}`));
        if (row.schedule_id) article.append(node('small',`관련 일정: ${scheduleTitle(row.schedule_id) || '현재 목록에서 찾을 수 없는 일정'}`));
        if (isAdmin()) {
          const label = node('label','처리 상태'); const select = document.createElement('select'); select.setAttribute('aria-label','처리 상태');
          for (const [value,text] of Object.entries(statuses)) { const option = node('option',text); option.value=value; select.append(option); }
          select.value=row.status; label.append(select); const save = node('button','상태 저장'); save.type='button';
          save.onclick = () => change(row,select.value);
          const remove = node('button','삭제'); remove.type='button'; remove.className='feedback-danger';
          remove.setAttribute('aria-label',`${row.author_name} 의견 삭제`); remove.onclick = () => destroy(row);
          const actions = document.createElement('div'); actions.className='feedback-admin-actions'; actions.append(save,remove);
          article.append(label,actions);
        }
        list.append(article);
      }
    }
    function errorText(error) {
      return error?.code === '40001' ? '다른 곳에서 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.' :
        error?.code === '42501' ? '이용 권한을 확인해 주세요. 다시 로그인해야 할 수 있습니다.' : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    async function load(append = false, success = '') {
      if (reviewing()) return;
      const n=epoch; lock(true); notice.textContent='불러오는 중…';
      if (!append) { rows=[]; list.replaceChildren(); }
      try {
        const offset=rows.length;
        let query=client().from('v2_feedback').select('*');
        if (!isAdmin()) query=query.eq('author_user_id',userId());
        const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);
        if (!valid(n)) return;
        if (error) throw error;
        rows=append ? rows.concat(data || []) : (data || []); render(); $('[data-more]').hidden=(data || []).length<50; notice.textContent=success;
      } catch(error) { if(valid(n)) notice.textContent=success ? `${success} 목록은 새로고침해 주세요.` : errorText(error); }
      finally { if(valid(n)) lock(false); }
    }
    async function change(row,status) {
      if(busy || !isAdmin()) return;
      const n=epoch; lock(true);
      try {
        const {error}=await client().rpc('v2_set_feedback_status',{p_id:row.id,p_status:status,p_version:row.version});
        if(!valid(n)) return; if(error) throw error;
        await load(false,'상태를 저장했습니다.');
      } catch(error) { if(valid(n)) notice.textContent=errorText(error); }
      finally { if(valid(n)) lock(false); }
    }
    async function destroy(row) {
      if(busy || !isAdmin()) return;
      if(!window.confirm('이 의견을 삭제할까요? 삭제 후 복구할 수 없습니다.')) return;
      const n=epoch; lock(true);
      try {
        const {error}=await client().rpc('v2_delete_feedback',{p_id:row.id,p_version:row.version});
        if(!valid(n)) return; if(error) throw error;
        await load(false,'의견을 삭제했습니다.');
      } catch(error) { if(valid(n)) notice.textContent=errorText(error); }
      finally { if(valid(n)) lock(false); }
    }
    form.addEventListener('submit',async event => {
      event.preventDefault(); if(busy || !isApproved()) return;
      const body=form.elements.body.value.trim(); if(!body) { notice.textContent='내용을 입력해 주세요.'; return; }
      const payload={p_category:form.elements.category.value,p_body:body,p_view:captured.view,p_schedule_id:captured.scheduleId,p_client_version:captured.version};
      const fingerprint=JSON.stringify(payload);
      if(!request || request.fingerprint!==fingerprint) request={fingerprint,id:crypto.randomUUID()};
      const n=epoch; lock(true); notice.textContent='등록 중…';
      try {
        const {error}=reviewing()
          ? await client().rpc('review_submit_feedback',{
              p_token:reviewToken(),
              p_member_id:memberId(),
              p_id:request.id,
              p_category:payload.p_category,
              p_body:payload.p_body,
              p_view:payload.p_view,
              p_client_version:payload.p_client_version
            })
          : await client().rpc('v2_submit_feedback',{p_id:request.id,...payload});
        if(!valid(n)) return; if(error) throw error;
        request=null; form.reset();
        if(reviewing()) notice.textContent='의견이 접수되었습니다. 감사합니다.';
        else await load(false,'의견이 접수되었습니다. 감사합니다.');
      } catch(error) { if(valid(n)) notice.textContent=errorText(error); }
      finally { if(valid(n)) lock(false); }
    });
    button.onclick=()=>{
      if(!isApproved()) return; identity=key(); epoch++;
      const c=context(); captured={view:views[c.view]?c.view:'other',scheduleId:c.scheduleId || null,version:/^([a-f0-9]{7,40}|development)$/.test(window.TENNIS_BUILD)?window.TENNIS_BUILD:'development'};
      const review = reviewing();
      intro.textContent=review
        ? '선택한 이름과 함께 운영자에게 전달됩니다. 비밀번호나 인증번호는 적지 마세요.'
        : '작성자 본인과 관리자만 볼 수 있습니다. 비밀번호나 인증번호는 적지 마세요.';
      $('[data-context]').textContent=review
        ? `${memberName() || '선택한 회원'} · 현재 화면(${views[captured.view]}), 배포 버전이 함께 저장됩니다.`
        : `현재 화면(${views[captured.view]})${captured.scheduleId?'과 관련 일정':''}, 배포 버전이 함께 저장됩니다.`;
      history.hidden=review;
      $('[data-list-title]').textContent=isAdmin()?'전체 의견':'내 의견';
      dialog.showModal();
      if(!review) load();
    };
    $('[data-close]').onclick=()=>invalidate();
    dialog.addEventListener('cancel',event=>{event.preventDefault();invalidate();});
    $('[data-refresh]').onclick=()=>{if(!busy) load();};
    $('[data-more]').onclick=()=>{if(!busy) load(true);};
    return {sync,invalidate};
  }
};
