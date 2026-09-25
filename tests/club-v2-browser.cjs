const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],requests=[];let rows=[],session=null,passwordRequest=null;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test-signed',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'guest',gizmo_user_id:7}))});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){
    if(url.pathname==='/avatar.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="white"/></svg>'});
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});
   }
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:[11,12,13,14,15,21,22,23,24,25].map(id=>({host_id:String(id),status:'free',updated_at:new Date().toISOString()}))})});
   if(url.pathname.endsWith('/club-bookings')){
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
    const b=route.request().postDataJSON();requests.push(b);let result={ok:true};
    if(b.action==='capabilities')result={enabled:true,protocol:2};
    if(b.action==='list')result={bookings:rows};
    if(b.action==='account')result={account:{data:{username:'guest',firstName:'Андрей',lastName:'Тест',birthDate:'2000-01-02',balance:321.5,session},updated_at:new Date().toISOString()},commands:[],password_request:passwordRequest,telegram:{first_name:'Андрей',photo_url:'https://club.test/avatar.svg'}};
    if(b.action==='create_v2'){const now=new Date().toISOString();rows.push({id:'b'+rows.length,host_id:b.host_id,mode:b.mode==='instant'?'arrival':b.mode,protocol:2,instant:b.mode==='instant',for_friend:b.for_friend,duration_kind:b.duration_kind,starts_at:now,ends_at:new Date(Date.now()+3600000).toISOString(),hold_until:new Date(Date.now()+3600000).toISOString(),status:b.mode==='instant'?'in_session':'holding'});if(b.mode==='instant')session={key:'session-1',host_id:b.host_id,last_login:now};result={booking_id:rows.at(-1).id}}
    if(b.action==='release')rows.find(x=>x.id===b.id).status='completed';
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
   }
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForSelector('.map-pc.free');await page.waitForFunction(()=>window.clubV2);
  await page.locator('[data-hid="11"]').click();assert.equal(await page.locator('[data-mode="instant"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-kind="hour"]').count(),0);
  await page.locator('#club-submit').click();await page.waitForSelector('.club-reservation');assert.equal(requests.find(b=>b.action==='create_v2').mode,'instant');
  await page.waitForSelector('.current-session');assert.equal(await page.locator('.club-reservation input').count(),0);
  assert.equal(await page.locator('#friend-option').count(),0);assert.equal(await page.getByRole('button',{name:'Забронировать для друга',exact:true}).count(),0);
  await page.getByRole('button',{name:'Завершить мою сессию',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#club-error').textContent.includes('Команда отправлена'));
  const logout=requests.find(b=>b.action==='command'&&b.kind==='logout');assert.equal(logout.payload.session_key,'session-1');assert.ok(!('gizmo_user_id' in logout));
  await page.locator('#club-close').click();await page.locator('#nav-profile').click();await page.waitForSelector('.prof-ava img');
  assert.equal(await page.locator('#prof-name').textContent(),'Андрей');assert.match(await page.locator('#prof-balance').textContent(),/321/);assert.equal(await page.locator('#account-birthday').inputValue(),'2000-01-02');assert.equal(await page.locator('#account-birthday').getAttribute('readonly'),'');assert.equal(await page.locator('.profile-booking').count(),0);assert.equal(await page.locator('#ov-profile #club-my-bookings').count(),0);
  await page.locator('#edit-account [name=username]').fill('new_guest');await page.locator('#edit-account .btn-main').click();await page.waitForFunction(()=>document.querySelector('#account-result').textContent.includes('Запрос отправлен'));
  const edit=requests.find(b=>b.kind==='profile_edit');assert.equal(edit.payload.username,'new_guest');assert.ok(!('birthDate' in edit.payload));
  await page.locator('#request-password').click();assert.ok(requests.some(b=>b.kind==='password_request'));
  rows.push({id:'scheduled-own',ends_at:new Date(Date.now()+1800000).toISOString(),host_id:'21',status:'holding',mode:'scheduled',protocol:2,starts_at:new Date().toISOString(),hold_until:new Date(Date.now()+1800000).toISOString()});
  for(const status of ['done','rejected']){
   passwordRequest={kind:'password_request',status,message:status==='done'?'Услуга предоставлена: пароль проверен в Gizmo':'Закрыта без выполнения'};await page.waitForFunction(s=>document.querySelector('#password-result')?.dataset.status===s,status);await page.evaluate(()=>navTo('hall'));await page.waitForSelector('#my-session-banner:not([hidden])');
   assert.equal(await page.locator('#club-booking[open]').count(),0,'session must not force a popup');
   await page.locator('#my-session-banner').click();await page.waitForSelector('.current-session');assert.match(await page.locator('.current-session').innerText(),/ПК 11/);await page.locator('#club-close').click();
   await page.locator('#nav-profile').click();await page.waitForFunction(s=>document.querySelector('#password-result')?.dataset.status===s,status);assert.match(await page.locator('#password-result').innerText(),status==='done'?/Услуга предоставлена/:/без выполнения/);
   assert.equal(await page.locator('#club-my-bookings').count(),0);assert.doesNotMatch(await page.locator('#ov-profile').innerText(),/gizmo/i);await page.evaluate(()=>navTo('hall'));
  }
  assert.equal(await page.locator('[data-hid="21"] .map-monitor').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(105, 165, 255)');await page.locator('[data-hid="21"]').click();assert.match(await page.locator('#club-mine').innerText(),/ПК 21/);assert.equal(await page.locator('#club-mine .current-session').count(),0,'other PC must not show current session');assert.equal(await page.getByRole('button',{name:'Отменить бронь',exact:true}).count(),1);await page.locator('#club-close').click();
  await page.evaluate(()=>{hostsData={};renderHall()});assert.equal(await page.locator('[data-hid="21"]').isDisabled(),false);await page.locator('[data-hid="21"]').click();assert.equal(await page.getByRole('button',{name:'Отменить бронь',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('v2 UI passed: direct entry, no code, friend flow removed, current session/logout, real cached balance, avatar, profile edit, immutable birthday and admin password request.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
