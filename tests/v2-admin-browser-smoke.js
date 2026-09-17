async page => {
  page.removeAllListeners('dialog');page.removeAllListeners('pageerror');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/env.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.TENNIS_CONFIG={supabaseUrl:"https://test.invalid",supabaseAnonKey:"test",allowRemoteWrites:true};'}));
  await page.route('**/@supabase/supabase-js@*/dist/umd/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:MOCK_SDK_SOURCE}));
  await page.setViewportSize(VIEWPORT);
  await page.goto('http://127.0.0.1:8766');
  await page.locator('#memberAdminButton').waitFor({state:'visible'});
  await page.locator('#memberAdminButton').click();
  const dialog=page.getByRole('dialog',{name:'회원 승인 관리'});
  await dialog.getByRole('heading',{name:'승인 시험 회원',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'승인',exact:true}).click();
  await dialog.getByText('연결할 회원을 직접 선택해 주세요.',{exact:true}).waitFor();
  await dialog.getByRole('combobox',{name:'승인 시험 회원 연결 회원'}).selectOption('member-b');
  await page.screenshot({path:'output/playwright/v2-admin-'+page.viewportSize().width+'.png'});
  await dialog.getByRole('button',{name:'승인',exact:true}).click();
  await dialog.getByText('승인했습니다. 해당 회원에게 새로고침을 안내해 주세요.',{exact:true}).waitFor();
  await dialog.getByRole('combobox',{name:'승인 상태 필터'}).selectOption('approved');
  await dialog.getByText('연결 회원: 다른 회원',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'이용 중지',exact:true}).click();
  await dialog.getByText('이용을 중지했습니다.',{exact:true}).waitFor();
  await dialog.getByRole('combobox',{name:'승인 상태 필터'}).selectOption('disabled');
  await dialog.getByRole('button',{name:'이용 재개',exact:true}).click();
  await dialog.getByText('승인했습니다. 해당 회원에게 새로고침을 안내해 주세요.',{exact:true}).waitFor();
  const result=await page.evaluate(()=>({states:__adminCalls.map(p=>p.p_status),member:__adminAccount.member_id,role:__adminAccount.role,versionArguments:__adminCalls.every(p=>!!p.p_expected_updated_at),hasRoleInput:__adminCalls.some(p=>'role' in p)}));
  // Revoke the role while the modal is open; no private account rows should remain.
  await page.evaluate(()=>{__v2Mock.account.role='member';authState.memberAccount.role='member';renderAuthStatus();});
  await dialog.waitFor({state:'hidden'});
  result.hiddenAfterRevocation=await page.locator('#memberAdminButton').isHidden();
  result.remainingRows=await page.locator('#memberAdminDialog [data-accounts]').textContent();
  return {...result,errors};
}
