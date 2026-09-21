async page => {
 page.removeAllListeners('pageerror');page.removeAllListeners('dialog');const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true};'}));
 await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:MOCK_SDK_SOURCE}));
 await page.setViewportSize(VIEWPORT);await page.goto('http://127.0.0.1:8766');
 await page.locator('[data-feedback-button]:visible').click();
 const dialog=page.getByRole('dialog',{name:'의견 보내기'});
 await dialog.getByText('아직 등록된 의견이 없습니다.',{exact:true}).waitFor();
 await dialog.getByRole('textbox',{name:'내용'}).fill('<b data-feedback-probe="yes">테스트 의견</b> & "');
 await dialog.getByRole('button',{name:'의견 등록',exact:true}).click();
 await dialog.getByText('의견이 접수되었습니다. 감사합니다.',{exact:true}).waitFor();
 const safe=await dialog.locator('[data-feedback-probe]').count()===0 && (await dialog.locator('.feedback-body').textContent()).startsWith('<b');
 await dialog.getByRole('button',{name:'새로고침',exact:true}).click();await dialog.locator('.feedback-body').waitFor();
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 await page.evaluate(()=>{__v2Mock.account.role='admin';authState.memberAccount.role='admin';renderAuthStatus();});
 await page.locator('[data-feedback-button]:visible').click();await dialog.getByRole('combobox',{name:'처리 상태',exact:true}).selectOption('resolved');
 await dialog.getByRole('button',{name:'상태 저장',exact:true}).click();await dialog.getByText('상태를 저장했습니다.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'테스트 회원 의견 삭제',exact:true}).click();await dialog.getByText('의견을 삭제했습니다.',{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/v2-feedback-'+page.viewportSize().width+'.png'});
 const result=await page.evaluate(()=>({count:__v2Mock.tables.v2_feedback.length,deleted:document.querySelector('#feedbackDialog [data-list]').textContent.includes('아직 등록된 의견이 없습니다.'),overflow:document.documentElement.scrollWidth>innerWidth}));
 await page.evaluate(()=>{__v2Mock.account.role='member';authState.memberAccount.role='member';renderAuthStatus();});
 const cleared=!(await dialog.isVisible()) && (await page.locator('#feedbackDialog [data-list]').textContent())==='';
 return {...result,safe,cleared,errors};
}
