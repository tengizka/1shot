const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];let registration=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const file=url.pathname==='/'?'index.html':['/registration-wait.js','/registration-wait.css'].includes(url.pathname)?'release/registration'+url.pathname:url.pathname.slice(1);
    if(fs.existsSync(file)){let body=fs.readFileSync(file);if(file==='index.html')body=body.toString().replace('<script src="club-booking.js?', '<link rel="stylesheet" href="registration-wait.css"><script src="registration-wait.js"></script><script src="club-booking.js?');return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body})}
   }
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();calls.push(b);return route.fulfill({contentType:'application/json',body:JSON.stringify(b.action==='capabilities'?{enabled:true,protocol:2,poll_bundle:1,registration_approval:1,registration,desk:{online:true,valid_for_ms:30000}}:{bookings:[],hosts:[],account:null,commands:[],desk:{online:true,valid_for_ms:30000}})})}
   if(url.pathname.endsWith('/club-auth')){const b=route.request().postDataJSON();calls.push(b);assert.equal(b.action,'register_application');registration={id:'request-1',status:'awaiting_admin'};return route.fulfill({contentType:'application/json',body:JSON.stringify({request_id:'request-1'})})}
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  for(const [id,value] of [['r-user','new_guest'],['r-pass','x'],['r-name','Test'],['r-last','Guest'],['r-phone','+79991234567']])await page.locator('#'+id).fill(value);
  await page.locator('.gender-choice label').first().click();await page.evaluate(()=>document.getElementById('r-birth').value='2000-01-01');await page.locator('#btn-reg').click();
  await page.waitForSelector('#registration-wait:not([hidden])');assert.match(await page.locator('#registration-wait').innerText(),/очн/);assert.equal(await page.locator('#r-pass').inputValue(),'');assert.equal(calls.filter(c=>c.action==='register_application').length,1);assert.equal(calls.find(c=>c.action==='register_application').password,'x');
  await page.reload();await page.waitForSelector('#registration-wait:not([hidden])');assert.ok(calls.some(c=>c.action==='capabilities'&&c.registration_pending===true));assert.equal(calls.filter(c=>c.action==='registration_status').length,0);
  registration={id:'request-1',status:'processing'};await page.evaluate(()=>window.dispatchEvent(new Event('club:resume')));await page.waitForFunction(()=>document.querySelector('#registration-wait').textContent.includes('Администратор проверяет'));
  registration={id:'request-1',status:'done',profile:{telegram_id:123,gizmo_user_id:7,username:'new_guest'}};await page.evaluate(()=>window.dispatchEvent(new Event('club:resume')));await page.waitForFunction(()=>JSON.parse(localStorage.getItem('1shot_v2_profile')||'null')?.gizmo_user_id===7);
  assert.deepEqual(errors,[]);
  const desk=await context.newPage();await desk.setViewportSize({width:1100,height:800});desk.on('pageerror',e=>errors.push(e.message));desk.on('dialog',d=>d.accept());
  await desk.addInitScript(()=>{
   window.approvals=[];window.reconciliations=[];window.row={id:'request-1',status:'awaiting_admin',public_data:{username:'<img src=x onerror=alert(1)>',first_name:'Test',mobile_phone:'+79991234567'}};
   window.pywebview={api:{snapshot:async()=>({online:true,protocol_ready:true,registration_ready:true,registrations:[row],last_sync:Date.now()/1000,rows:[],hosts:[],password_requests:[],alerts:0}),approve_registration:async(...args)=>{approvals.push(args);return {status:'attention',gizmo_user_id:7}},review_registration:async()=>({proof_id:'fresh-proof',gizmo_user_id:7,username:'guest',first_name:'Test'}),reconcile_registration:async(...args)=>{reconciliations.push(args);row.status='done';return {ok:true}}}};
   document.addEventListener('DOMContentLoaded',()=>dispatchEvent(new Event('pywebviewready')));
  });
  await desk.route('**/*',r=>{const u=new URL(r.request().url()),file='desktop/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));if(u.host==='desk.test'&&fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});return r.abort()});
  await desk.goto('https://desk.test');await desk.waitForSelector('#desk-splash',{state:'detached'});await desk.locator('[data-panel="registrations"]').click();
  const create=desk.getByRole('button',{name:'Подтвердить и создать'});assert.equal(await create.isDisabled(),true);assert.equal(await desk.locator('.registration-list img').count(),0);
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
