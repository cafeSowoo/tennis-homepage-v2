async page => {
  page.removeAllListeners('pageerror');
  page.removeAllListeners('dialog');
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{await d.accept();});
  await page.addInitScript({content:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true,reviewMode:true};\n'+MOCK_SDK_SOURCE});
  await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true,reviewMode:true};'}));
  await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:'/* Supabase mock injected by Playwright. */'}));
  await page.setViewportSize(VIEWPORT);
  await page.goto('http://127.0.0.1:8766/?schedule=kakao-fixture');
  await page.waitForFunction(()=>!document.querySelector('#reviewGate').hidden);

  const locked=await page.evaluate(()=>({
    gate:!document.querySelector('#reviewGate').hidden,
    password:!document.querySelector('#reviewPasswordForm').hidden,
    memberStep:!document.querySelector('#reviewMemberStep').hidden,
    kakaoAuthVisible:getComputedStyle(document.querySelector('#authButton')).display!=='none',
    scheduleCount:typeof schedules==='undefined'?null:schedules.length
  }));

  await page.locator('#reviewPasswordInput').fill('wrong');
  await page.locator('#reviewPasswordButton').click();
  await page.waitForFunction(()=>document.querySelector('#reviewPasswordNotice').textContent.includes('맞지 않습니다'));
  const wrongRejected=await page.locator('#reviewPasswordNotice').innerText();

  await page.locator('#reviewPasswordInput').fill('review-pass');
  await page.locator('#reviewPasswordButton').click();
  await page.waitForFunction(()=>!document.querySelector('#reviewMemberStep').hidden);
  await page.locator('#reviewMemberSelect').selectOption('member-a');
  await page.locator('#reviewMemberConfirm').click();
  await page.waitForFunction(()=>document.querySelector('#reviewGate').hidden && document.body.classList.contains('approved-club-member'));
  await page.waitForFunction(()=>document.querySelector('#detail.active') && document.querySelector('#detailContent')?.innerText.includes('10월 Kakao Mirror 시험'));

  const entered=await page.evaluate(()=>({
    member:myMemberName(),
    schedules:schedules.length,
    sources:[...new Set(schedules.map(s=>s.source))],
    selected:state.selectedId,
    detailReadOnly:document.querySelector('#detailContent').innerText.includes('카카오 일정 · 읽기 전용'),
    rsvp:!!document.querySelector('[data-set-rsvp],[data-join-current],[data-decline-current]'),
    composer:!!document.querySelector('[data-discussion-input]'),
    addSchedule:!!document.querySelector('[data-add-schedule]:not([style*="display: none"])') && getComputedStyle(document.querySelector('[data-add-schedule]')).display!=='none',
    authVisible:getComputedStyle(document.querySelector('#authButton')).display!=='none',
    profileVisible:[...document.querySelectorAll('.member-profile-nav')].some(el=>el.getClientRects().length>0 && getComputedStyle(el).display!=='none'),
    memberButton:document.querySelector('#reviewMemberButton')?.innerText || '',
    remoteWrites:remoteWritesEnabled(),
    localToken:localStorage.getItem('tennis.v2.reviewAccessToken'),
    localMember:localStorage.getItem('tennis.v2.reviewMemberId')
  }));

  const visibleProfileNav=page.locator('.member-profile-nav:visible').first();
  await visibleProfileNav.click();
  await page.waitForFunction(()=>document.querySelector('#member-detail.active'));
  const profile=await page.evaluate(()=>({
    active:document.querySelector('#member-detail.active')!==null,
    selectedMemberId:String(state.selectedMemberId||''),
    text:document.querySelector('#member-detail')?.innerText||''
  }));
  await page.locator('.nav-item[data-view="dashboard"]:visible').first().click();
  await page.waitForFunction(()=>document.querySelector('#dashboard.active'));

  await page.evaluate(async()=>{
    const source=__v2Mock.tables.schedules[0];
    __v2Mock.tables.schedules.push({...source,id:'kakao-refresh-fixture',date:'2026-10-05',title:'자동 갱신 시험',kakao_synced_at:'2026-09-21T05:30:00Z'});
    await refreshReviewKakaoSchedules();
  });
  await page.waitForFunction(()=>schedules.some(schedule=>schedule.id==='kakao-refresh-fixture'));
  const refreshed=await page.evaluate(()=>({count:schedules.length,hasRefresh:schedules.some(schedule=>schedule.id==='kakao-refresh-fixture')}));

  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#reviewGate').hidden && document.body.classList.contains('approved-club-member'));
  const persisted=await page.evaluate(()=>({member:myMemberName(),gate:document.querySelector('#reviewGate').hidden,schedules:schedules.length}));

  await page.locator('#reviewMemberButton').click();
  await page.waitForFunction(()=>!document.querySelector('#reviewGate').hidden && !document.querySelector('#reviewMemberStep').hidden);
  await page.locator('#reviewMemberSelect').selectOption('member-b');
  await page.locator('#reviewMemberConfirm').click();
  await page.waitForFunction(()=>document.querySelector('#reviewGate').hidden);
  const switched=await page.evaluate(()=>({member:myMemberName(),declined:isDeclinedSchedule(schedules[0])}));

  const calls=await page.evaluate(()=>__v2Mock.calls.map(c=>c.name));
  return {errors,locked,wrongRejected,entered,profile,refreshed,persisted,switched,calls};
}
