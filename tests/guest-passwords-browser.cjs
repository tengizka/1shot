const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];
  let grant={id:'11111111-1111-4111-8111-111111111111',username:'guest',status:'authorized',minimum_length:1};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:100}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}}});
  await page.route('**/*',r=>{const url=new URL(r.request().url());
   if(url.host==='club.test'){
    let file;
    if(url.pathname==='/password-choice.js'){
      file='release/registration/password-choice.js';
    } else {
      const rawPath=url.pathname==='/'?'index.html':url.pathname.slice(1);
      file=fs.existsSync('miniapp/'+rawPath)?'miniapp/'+rawPath:rawPath;
    }
    if(fs.existsSync(file)){let body=fs.readFileSync(file);if(file==='index.html'||file==='miniapp/index.html')body=body.toString().replace('<script src="club-booking.js?', '<script src="password-choice.js"></script><script src="club-booking.js?');return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body})}
   }
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){const b=r.request().postDataJSON();calls.push(b);return r.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,protocol:2,poll_bundle:1,password_grant:grant,desk:{online:true,valid_for_ms:30000}})})}
   if(url.pathname.endsWith('/club-auth')){const b=r.request().postDataJSON();calls.push(b);if(b.action==='password_submit')grant={...grant,status:'queued'};return r.fulfill({contentType:'application/json',body:JSON.stringify({status:'queued',request_id:'help'})})}
   if(url.pathname.endsWith('/hosts'))return r.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return r.abort();
  });
  await page.goto('https://club.test');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForSelector('#guest-password-panel:not([hidden])');
  await page.locator('#guest-password-panel input').fill('x');await page.getByRole('button',{name:'Установить мой пароль'}).click();await page.waitForFunction(()=>document.querySelector('#guest-password-panel').textContent.includes('Пароль принят'));
  assert.equal(await page.locator('#guest-password-panel input').inputValue(),'');assert.equal(calls.filter(c=>c.action==='password_submit').length,1);const sent=calls.find(c=>c.action==='password_submit');assert.equal(sent.password,'x');assert.equal(sent.gizmo_user_id,undefined);assert.ok(sent.initData&&sent.grant_id&&sent.request_id);
  await page.reload();await page.waitForSelector('#splash',{state:'hidden'});assert.equal(await page.locator('#guest-password-panel form').isVisible(),false);assert.equal(calls.filter(c=>c.action==='password_submit').length,1);
  assert.ok(calls.some(c=>c.action==='capabilities'&&c.recovery_pending===true));assert.equal(calls.filter(c=>c.action==='password_grant_status').length,0);
  grant={...grant,status:'done',username:''};await page.evaluate(()=>dispatchEvent(new Event('club:resume')));await page.waitForFunction(()=>document.querySelector('#guest-password-panel').textContent.includes('установлен и проверен'));
  assert.deepEqual(errors,[]);
  const desk=await context.newPage();await desk.setViewportSize({width:1100,height:800});desk.on('pageerror',e=>errors.push(e.message));desk.on('dialog',d=>d.accept());
  await desk.addInitScript(()=>{
   window.authorizations=[];window.grants=[];const user={id:7,username:'operator',group_name:'Операторы',requires_privileged_confirmation:true};
   window.pywebview={api:{snapshot:async()=>({online:true,protocol_ready:true,registration_ready:true,registrations:[],password_ready:true,password_grants:grants,rows:[],hosts:[],last_sync:Date.now()/1000,password_requests:[{id:'request-a',gizmo_user_id:7,telegram_id:100}],alerts:0}),prepare_password_request:async()=>({user}),authorize_guest_password:async(...args)=>{authorizations.push(args);grants.push({id:'grant-a',source_id:'request-a',status:'authorized',username:'operator'});return {ok:true}},review_guest_password:async()=>({proof_id:'proof',gizmo_user_id:7,username:'operator',requires_privileged_confirmation:true}),resolve_guest_password:async(...args)=>{authorizations.push(['resolve',...args]);grants=[];return {ok:true}}}};
   document.addEventListener('DOMContentLoaded',()=>dispatchEvent(new Event('pywebviewready')));
  });
  await desk.route('**/*',r=>{const u=new URL(r.request().url()),file='desktop/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));if(u.host==='desk.test'&&fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});return r.abort()});
  await desk.goto('https://desk.test');await desk.waitForSelector('#desk-splash',{state:'detached'});await desk.locator('[data-panel="accounts"]').click();await desk.locator('#password-requests button').first().click();
  assert.equal(await desk.locator('#new-password').isVisible(),false);assert.equal(await desk.locator('#new-password').isDisabled(),true);await desk.locator('#identity-checked').check();await desk.locator('#reset-user button').click();assert.equal(await desk.evaluate(()=>authorizations.length),0);
  await desk.locator('#privileged-checked').check();await desk.locator('#reset-user button').click();assert.deepEqual(await desk.evaluate(()=>authorizations[0]),['password_request','request-a',7,'operator',true,true]);
  await desk.evaluate(async()=>{grants[0].status='attention';await refresh()});await desk.getByRole('button',{name:'Проверить доступ владельца'}).click();
  const checks=desk.locator('#guest-password-grants input');await checks.nth(0).check();const close=desk.getByRole('button',{name:'Закрыть попытку после входа'});assert.equal(await close.isDisabled(),true);await checks.nth(1).check();await close.click();assert.equal(await desk.evaluate(()=>authorizations[1][0]),'resolve');
  assert.deepEqual(errors,[]);console.log('Guest passwords PASS: phone-only secret input, one-character guest password, shared polling/reload, hidden Desk password field, privileged authorization and explicit access reconciliation.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
