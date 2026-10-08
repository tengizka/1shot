const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{
   const booking=(id,host)=>({id,host_id:host,username:'Гость '+id,first_name:'Анна',last_name:'Иванова',mobile_phone:'+79991234567',gizmo_user_id:7,telegram_id:100,status:'holding',mode:'scheduled',duration_kind:'open',starts_at:'2026-10-09T10:00:00+03:00'});
   window.state={online:true,protocol_ready:true,last_sync:Date.now()/1000,hosts:[{host_id:'11',status:'free'},{host_id:'12',status:'busy'}],rows:[booking('a','11'),booking('b','12')],password_requests:[{id:'reset-a',gizmo_user_id:7,telegram_id:100}],alerts:0};
   window.calls=[];window.copied=[];
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.failCopy)throw Error('denied');copied.push(text)}}});
   window.pywebview={api:{snapshot:async()=>structuredClone(state),booking_guest:async id=>{calls.push(['guest',id]);return {user:{firstName:'Анна',lastName:'Иванова',username:'verified',mobilePhone:'+79990000001'},gizmo_user_id:7,telegram_id:100}},search_accounts:async q=>({users:[{id:7,username:q,mobilePhone:'+79991234567'}]}),cancel_booking:async id=>{calls.push(['cancel',id]);return {ok:true}},prepare_password_request:async id=>{calls.push(['prepare',id]);await new Promise(r=>setTimeout(r,300));return {error:'Тестовая ошибка'}}}};
   document.addEventListener('DOMContentLoaded',()=>dispatchEvent(new Event('pywebviewready')));
  });
  await page.route('**/*',r=>{const u=new URL(r.request().url()),file='desktop/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));if(u.host==='desk.test'&&fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});return r.abort()});
  await page.goto('https://desk.test');await page.waitForSelector('#desk-splash',{state:'detached'});
  await page.locator('[data-panel="bookings"]').click();
  const first=page.locator('[data-booking-id="a"]');await first.locator('summary').click();await page.waitForFunction(()=>document.querySelector('[data-booking-id="a"] details').dataset.loaded==='1');
  await page.evaluate(()=>{
   window.originalCard=document.querySelector('[data-booking-id="a"]');window.originalDetail=originalCard.querySelector('details');window.originalHost=document.querySelector('[data-host-id="11"]');
   const range=document.createRange();range.selectNodeContents(originalCard.querySelector('h2'));getSelection().removeAllRanges();getSelection().addRange(range);
   window.observed=[];window.observer=new MutationObserver(changes=>observed.push(...changes));observer.observe(originalCard,{childList:true,characterData:true,subtree:true});
  });
  await page.evaluate(async()=>{for(let i=0;i<20;i++){state.rows[1].message='Новое событие '+i;state.rows[0].updated_at=new Date().toISOString();state.hosts[1].status=i%2?'free':'busy';state.last_sync=Date.now()/1000;await refresh()}});
  assert.deepEqual(await page.evaluate(()=>({card:originalCard===document.querySelector('[data-booking-id="a"]'),detail:originalDetail.open,host:originalHost===document.querySelector('[data-host-id="11"]'),selection:getSelection().toString(),mutations:observed.length,fetches:calls.filter(c=>c[0]==='guest').length})),{card:true,detail:true,host:true,selection:'ПК 11',mutations:0,fetches:1});
  await page.evaluate(async()=>{observer.disconnect();state.rows[0].status='attention';await refresh()});
  assert.equal(await page.evaluate(()=>getSelection().toString()),'ПК 11');assert.match(await first.getAttribute('class'),/attention/);
  await first.getByRole('button',{name:'Копировать телефон'}).click();await first.getByRole('button',{name:'Копировать номер брони'}).click();assert.deepEqual(await page.evaluate(()=>copied),['+79990000001','a']);
  await page.evaluate(()=>window.failCopy=true);await first.getByRole('button',{name:'Копировать номер брони'}).click();assert.match(await first.innerText(),/Ctrl\+C/);
  await page.locator('[data-panel="accounts"]').click();await page.locator('#account-search').fill('Иванова');await page.waitForSelector('#account-options button');
  await page.evaluate(()=>{const input=document.querySelector('#account-search');input.focus();input.setSelectionRange(2,5);window.option=document.querySelector('#account-options button')});
  await page.evaluate(async()=>{state.rows[1].status='waiting';state.password_requests.push({id:'reset-b',gizmo_user_id:8,telegram_id:101});await refresh()});
  assert.deepEqual(await page.evaluate(()=>{const input=document.querySelector('#account-search');return [document.activeElement===input,input.value,input.selectionStart,input.selectionEnd,option===document.querySelector('#account-options button')]}),[true,'Иванова',2,5,true]);
  await page.locator('[data-request-id="reset-a"] button').first().click();
  await page.evaluate(async()=>{window.resetCard=document.querySelector('[data-request-id="reset-a"]');state.password_requests.push({id:'reset-c',gizmo_user_id:9,telegram_id:102});await refresh()});
  assert.equal(await page.evaluate(()=>resetCard===document.querySelector('[data-request-id="reset-a"]')),true);
  await page.waitForFunction(()=>document.querySelector('[data-request-id="reset-a"]').textContent.includes('Тестовая ошибка'));
  await page.evaluate(async()=>{state.rows=state.rows.filter(b=>b.id!=='b');state.password_requests=state.password_requests.filter(r=>r.id!=='reset-b');await refresh()});
  assert.equal(await page.locator('[data-booking-id="b"]').count(),0);assert.equal(await page.locator('[data-request-id="reset-b"]').count(),0);
  await page.locator('[data-panel="bookings"]').click();await first.getByRole('button',{name:'Отменить бронь',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c[0]==='cancel')),[['cancel','a']]);
  assert.equal(await first.locator('h2').evaluate(e=>getComputedStyle(e).userSelect),'text');
  assert.deepEqual(errors,[]);console.log('Desk stability PASS: stable cards/hosts, no unchanged-card mutations, details/selection/caret/search preserved, keyed request queue, copy success/failure, cancellation identity.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
