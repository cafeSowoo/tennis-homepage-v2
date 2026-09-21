async page => {
  page.removeAllListeners('pageerror');
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true,reviewMode:true};'}));
  await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:MOCK_SDK_SOURCE}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8766');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await page.getByRole('textbox',{name:'클럽 비밀번호'}).fill('review-pass');
  await page.getByRole('button',{name:'입장하기',exact:true}).click();
  await page.getByRole('combobox',{name:'내 이름 선택'}).selectOption('member-a');
  await page.getByRole('button',{name:'이 이름으로 보기',exact:true}).click();
  await page.evaluate(()=>Object.defineProperty(window.crypto,'randomUUID',{value:undefined,configurable:true}));
  const button=page.locator('[data-feedback-button]:visible');
  await button.waitFor({state:'visible'});
  await button.click();
  const dialog=page.getByRole('dialog',{name:'의견 보내기'});
  const historyHidden=await dialog.locator('[data-history]').isHidden();
  await dialog.getByRole('textbox',{name:'내용'}).fill('리뷰 모드 피드백 테스트');
  await dialog.getByRole('button',{name:'의견 등록',exact:true}).click();
  await page.getByText('전송 완료!',{exact:true}).waitFor();
  const successUi=await page.evaluate(()=>({
    dialogClosed:!document.querySelector('#feedbackDialog').open,
    toastVisible:!document.querySelector('#feedbackToast').hidden
  }));
  await page.waitForTimeout(2200);
  const toastDismissed=await page.evaluate(()=>document.querySelector('#feedbackToast').hidden);
  const result=await page.evaluate(()=>({
    feedbacks:__v2Mock.tables.v2_feedback.map(x=>({member_id:x.member_id,author_name:x.author_name,body:x.body,author_user_id:x.author_user_id})),
    calls:__v2Mock.calls.filter(x=>x.name==='review_submit_feedback')
  }));
  return {historyHidden,successUi,toastDismissed,errors,...result};
}
