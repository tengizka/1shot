const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];let registration=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123},start_param:'headshot'},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){
    let file;
    const rawPath=url.pathname==='/'?'index.html':url.pathname.slice(1);
    file=fs.existsSync('miniapp/'+rawPath)?'miniapp/'+rawPath:rawPath;
    if(fs.existsSync(file)){let body=fs.readFileSync(file);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body})}
   }
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();calls.push(b);return route.fulfill({contentType:'application/json',body:JSON.stringify(b.action==='capabilities'?{enabled:true,protocol:2,poll_bundle:1,registration_approval:1,registration,desk:{online:true,valid_for_ms:30000}}:{bookings:[],hosts:[],account:null,commands:[],desk:{online:true,valid_for_ms:30000}})})}
   if(url.pathname.endsWith('/club-auth')){const b=route.request().postDataJSON();calls.push(b);if(b.action==='registration_cancel'){registration={id:'request-1',status:'rejected'};return route.fulfill({contentType:'application/json',body:'{"ok":true}'})}assert.equal(b.action,'register_application');registration={id:'request-1',status:'awaiting_admin'};return route.fulfill({contentType:'application/json',body:JSON.stringify({request_id:'request-1'})})}
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  // One field per step: fill the visible step, then «Дальше»; the last step sends the form.
  for(const [id,value] of [['r-user','new_guest'],['r-pass','x'],['r-phone','8 (999) 123-45-67'],['r-name','Test'],['r-last','Guest']]){await page.locator('#'+id).fill(value);await page.locator('#btn-reg').click()}
  await page.locator('.gender-choice label').first().click();await page.locator('#btn-reg').click();
  await page.evaluate(()=>document.getElementById('r-birth').value='2000-01-01');await page.locator('#btn-reg').click();
  assert.equal(await page.locator('#r-promo').inputValue(),'HEADSHOT');await page.locator('#r-promo').fill('blogger1');await page.locator('#btn-reg').click();
  await page.waitForSelector('#registration-wait:not([hidden])');assert.match(await page.locator('#registration-wait').innerText(),/администратор/);assert.equal(await page.locator('#r-pass').inputValue(),'');assert.equal(calls.filter(c=>c.action==='register_application').length,1);assert.equal(calls.find(c=>c.action==='register_application').password,'x');const sent=calls.find(c=>c.action==='register_application');assert.equal(sent.mobile_phone,'+79991234567','phone normalised to +7');assert.equal(sent.promo_code,'BLOGGER1','promo code sent upper-case');
  await page.reload();await page.waitForSelector('#registration-wait:not([hidden])');assert.ok(calls.some(c=>c.action==='capabilities'&&c.registration_pending===true));assert.equal(calls.filter(c=>c.action==='registration_status').length,0);
  assert.equal(await page.locator('#registration-wait .rw-cancel').isVisible(),true,'a waiting application can be cancelled');
  assert.equal(await page.locator('#registration-wait .oneshot-loader').count(),1,'1SHOT loader instead of technical text');
  registration={id:'request-1',status:'processing'};await page.evaluate(()=>window.dispatchEvent(new Event('club:resume')));await page.waitForFunction(()=>document.querySelector('#registration-wait .rw-cancel').hidden);
  assert.doesNotMatch(await page.locator('#registration-wait').innerText(),/провер(яем|ка)|синхрон|подтверждени/i,'no technical wording');
  registration={id:'request-1',status:'done',profile:{telegram_id:123,gizmo_user_id:7,username:'new_guest'}};await page.evaluate(()=>window.dispatchEvent(new Event('club:resume')));await page.waitForFunction(()=>JSON.parse(localStorage.getItem('1shot_v2_profile')||'null')?.gizmo_user_id===7);
  assert.deepEqual(errors,[]);
  const desk=await context.newPage();await desk.setViewportSize({width:1100,height:800});desk.on('pageerror',e=>errors.push(e.message));desk.on('dialog',d=>d.accept());
  await desk.addInitScript(()=>{
   window.approvals=[];window.reconciliations=[];window.row={id:'request-1',status:'awaiting_admin',public_data:{username:'<img src=x onerror=alert(1)>',first_name:'Test',mobile_phone:'+79991234567',promo_code:'HEADSHOT'}};
   window.pywebview={api:{snapshot:async()=>({online:true,protocol_ready:true,registration_ready:true,registrations:[row],last_sync:Date.now()/1000,rows:[],hosts:[],password_requests:[],alerts:0}),approve_registration:async(...args)=>{approvals.push(args);return {status:'attention',gizmo_user_id:7}},review_registration:async()=>({proof_id:'fresh-proof',gizmo_user_id:7,username:'guest',first_name:'Test'}),reconcile_registration:async(...args)=>{reconciliations.push(args);row.status='done';return {ok:true}}}};
   document.addEventListener('DOMContentLoaded',()=>dispatchEvent(new Event('pywebviewready')));
  });
  await desk.route('**/*',r=>{const u=new URL(r.request().url()),file='desktop/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));if(u.host==='desk.test'&&fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});return r.abort()});
  await desk.goto('https://desk.test');await desk.waitForSelector('#desk-splash',{state:'detached'});await desk.locator('[data-panel="registrations"]').click();
  const create=desk.getByRole('button',{name:'Подтвердить и создать'});assert.match(await desk.locator('.registration-list').innerText(),/Промокод HEADSHOT: час Standart/);assert.equal(await create.isDisabled(),true);assert.equal(await desk.locator('.registration-list img').count(),0);
  await desk.locator('.registration-list input').check();await create.click();assert.equal(await create.isDisabled(),true);assert.deepEqual(await desk.evaluate(()=>approvals),[['request-1',true]]);
  await desk.evaluate(()=>refresh());assert.equal(await create.isDisabled(),true);assert.deepEqual(errors,[]);
  await desk.evaluate(async()=>{row.status='attention';await refresh()});
  const finish=desk.getByRole('button',{name:'Завершить сверку',exact:true});assert.equal(await finish.isDisabled(),true);
  await desk.getByRole('button',{name:'Проверить вход гостя',exact:true}).click();assert.equal(await finish.isDisabled(),true);
  await desk.locator('.registration-list input').check();await finish.click();assert.deepEqual(await desk.evaluate(()=>reconciliations),[['request-1','fresh-proof',7,true]]);
  assert.equal(await desk.locator('.registration-list input[type=password]').count(),0);assert.equal(await desk.evaluate(()=>approvals.length),1);assert.deepEqual(errors,[]);
  console.log('Registration browser PASS: staged one-character submission, reload/shared polling, verified profile, staff confirmation, escaped fields and no repeat approval.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
