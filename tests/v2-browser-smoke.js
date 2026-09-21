async page => {

 page.removeAllListeners('dialog');
 page.removeAllListeners('pageerror');
 const errors=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
 await page.addInitScript({content:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true,reviewMode:false};\n'+MOCK_SDK_SOURCE});
 await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true};'}));
 await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:'/* Supabase mock injected by Playwright. */'}));
 await page.route('**/sw.js*',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.setViewportSize(VIEWPORT);
 await page.goto('http://127.0.0.1:8766/?schedule=kakao-fixture');
 await page.waitForTimeout(1500);
 await page.waitForFunction(()=>document.body.classList.contains('approved-club-member'));
 await page.waitForFunction(()=>document.querySelector('#detail.active') && document.querySelector('#detailContent')?.innerText.includes('10월 Kakao Mirror 시험'));
 await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__sharedPayload=payload;}}));
 await page.evaluate(()=>shareCurrentSchedule());
 const deepLink=await page.evaluate(()=>({
   detailTitle:document.querySelector('#detailContent h2')?.textContent || '',
   query:new URLSearchParams(location.search).get('schedule'),
   authRedirect:authRedirectUrl(),
   shared:window.__sharedPayload,
   shareButton:!!document.querySelector('[data-share-current]')
 }));
 await page.evaluate(()=>switchView('dashboard'));
 const clearedDeepLink=await page.evaluate(()=>new URLSearchParams(location.search).has('schedule'));
 const mirror=await page.evaluate(()=>{
   const item=schedules.find(schedule=>schedule.source==='kakao');
   if(!item)return null;
   const card=document.createElement('div');card.innerHTML=scheduleRow(item);
   renderDetail(item);
   return {
     attendeeIds:item.attendeeIds,
     absenteeIds:item.absenteeIds,
     capacity:item.capacity,
     badge:card.innerText.includes('Kakao'),
     cardRsvp:!!card.querySelector('[data-set-rsvp]'),
     detailReadOnly:document.querySelector('#detailContent').innerText.includes('카카오 일정 · 읽기 전용'),
     join:!!document.querySelector('#detailContent [data-join-current]'),
     composer:!!document.querySelector('#detailContent [data-discussion-input]'),
     commentCount:document.querySelector('#detailContent').innerText.includes('카카오 댓글 2개'),
     kakaoLinks:document.querySelectorAll('#detailContent a[href^="kakao"]').length,
     kakaoHref:document.querySelector('#detailContent a[href^="kakao"]')?.getAttribute('href') || '',
     macDesktop:/Macintosh/i.test(navigator.userAgent || '') && !/Mobile/i.test(navigator.userAgent || ''),
     discussionGuide:document.querySelector('#detailContent').innerText.includes('Test 댓글 필드는 2차 테스트에서 구현 예정입니다.')
   };
 });
 if (await page.locator('#pwaInstallDismiss').isVisible()) await page.locator('#pwaInstallDismiss').click();
 if (page.viewportSize().width < 600) await page.locator('#calendarAddBtn').click();
 else await page.locator('#sideScheduleAddBtn').click();
 await page.locator('[data-add-schedule]:visible').first().click();
 await page.locator('#addScheduleDate').fill('2099-01-20');
 const title = `<b data-title-probe="yes">제목</b> " ' & (토)`;
 await page.locator('#addScheduleTitle').fill(title);
 await page.locator('#addScheduleCapacity').fill('5');
 await page.locator('#addScheduleSubmit').click();
 await page.waitForFunction(()=>window.__v2Mock.tables.v2_schedules.length===1);
 await page.waitForTimeout(250);
 const afterCreate=await page.evaluate(()=>({calls:__v2Mock.calls.length,detail:document.querySelector('#detailContent').innerText,formHidden:document.querySelector('#addScheduleSheet').classList.contains('hidden')}));
 const titleSafety=await page.evaluate(expected=>{
   const h=document.querySelector('#detailContent h2');
   const container=document.createElement('div');container.innerHTML=scheduleRow(schedules.find(schedule=>schedule.source==='v2'));
   return h.textContent===expected && !h.querySelector('[data-title-probe]') &&
     container.querySelector('h4').textContent===expected &&
     container.querySelector('[data-detail-id]').getAttribute('aria-label')===expected+' 상세 보기' &&
     !container.querySelector('[data-title-probe]');
 },title);
 if(!titleSafety)throw Error('Schedule title was interpreted as HTML');
 await page.locator('[data-edit-current]').first().click();
 await page.locator('#addScheduleTitle').fill('수정한 V2 일정');
 await page.locator('#addScheduleSubmit').click();
 await page.waitForFunction(()=>__v2Mock.tables.v2_schedules[0].version===2);
 await page.locator('[data-join-current]').click();
 await page.waitForFunction(()=>document.querySelector('#detailContent').innerText.includes('참석자 (1/5)'));
 if (await page.locator('#pwaInstallDismiss').isVisible()) await page.locator('#pwaInstallDismiss').click();
 await page.locator('[data-discussion-input]').fill('브라우저 시험 댓글');
 await page.locator('[data-send-discussion]').evaluate(el=>el.scrollIntoView({block:'center'}));
 await page.locator('[data-send-discussion]').click();
 await page.waitForFunction(()=>document.querySelector('#detailContent').innerText.includes('브라우저 시험 댓글'));
 await page.locator('[data-delete-current]').first().click();
 await page.waitForFunction(()=>document.querySelector('#detailContent').innerText.includes('취소된 일정'));
 const cancelled=await page.evaluate(()=>({responses:__v2Mock.tables.v2_schedule_rsvps.length,comments:__v2Mock.tables.v2_discussions.length,join:!!document.querySelector('[data-join-current]'),composer:!!document.querySelector('[data-discussion-input]'),deleteComment:!!document.querySelector('[data-delete-discussion]')}));
 await page.locator('[data-delete-discussion]').click();
 await page.waitForFunction(()=>__v2Mock.tables.v2_discussions.length===0);
 await page.locator('#authButton').click();
 await page.waitForFunction(()=>!document.querySelector('#memberGate').hidden);
 const loggedOut=await page.evaluate(()=>({detail:document.querySelector('#detailContent').innerText,schedules:typeof schedules==='undefined'?null:schedules.length,gate:!document.querySelector('#memberGate').hidden,calls:__v2Mock.calls.map(c=>c.name)}));
 return {errors,dialogs,deepLink,clearedDeepLink,mirror,cancelled,loggedOut,titleSafety};
}
