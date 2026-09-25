const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)})}
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:[{host_id:'11',status:'busy',updated_at:new Date().toISOString()},{host_id:'12',status:'free',updated_at:new Date().toISOString()}]})});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(b.action==='capabilities'?{enabled:true,protocol:2}:b.action==='list'?{bookings:[{id:'old',host_id:'12',status:'attention',mode:'arrival',protocol:2,hold_until:new Date().toISOString()}]}:{ok:true})})}
   if(url.pathname.endsWith('/club-auth')){requests.push(route.request().postDataJSON());return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'TEST: request received'})})}
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  for(const [id,value] of [['r-user','guest_test'],['r-pass','secret123'],['r-phone','+79991234567'],['r-name','Иван'],['r-last','Тест']])await page.locator('#'+id).fill(value);
  await page.locator('.gender-choice label').first().click();await page.locator('#btn-reg').click();assert.match(await page.locator('#err-reg').textContent(),/дату рождения/);assert.equal(requests.length,0);
  await page.locator('#birthday-open').click();await page.waitForSelector('.birthday-dialog[open]');
  const year=page.getByRole('listbox',{name:'Год'});await year.focus();await page.keyboard.press('ArrowUp');await page.waitForTimeout(180);
  await page.locator('.birthday-dialog .btn-main').click();assert.match(await page.locator('#r-birth').inputValue(),/^\d{4}-\d{2}-\d{2}$/);
  await page.locator('#btn-reg').click();await page.waitForFunction(()=>document.querySelector('#err-reg').textContent.includes('TEST'));assert.equal(requests[0].last_name,'Тест');assert.equal(requests[0].sex,1);assert.ok(requests[0].birth_date);assert.ok(requests[0].initData);
  await page.evaluate(()=>{profile={telegram_id:123,gizmo_user_id:7,username:'guest'};showApp()});await page.waitForSelector('[data-hid="11"].busy');
  await page.locator('[data-hid="11"]').click();await page.waitForSelector('#occupied-dialog[open]');assert.ok((await page.locator('#occupied-dialog p').textContent()).length>5);assert.equal(await page.locator('#club-booking[open]').count(),0);await page.locator('#occupied-dialog button').click();
  await page.locator('.header-logo').click();assert.equal(await page.locator('.secret-burst').count(),0);assert.equal(await page.locator('.header-logo .logo-letter').count(),5);assert.equal(await page.locator('.header-logo').evaluate(e=>getComputedStyle(e).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');assert.ok(await page.locator('.header-logo').evaluate(e=>e.getAnimations({subtree:true}).length>0));await page.locator('#nav-profile').click();
  await page.evaluate(()=>navTo('hall'));await page.locator('[data-hid="12"]').click();assert.equal(await page.locator('.club-help').getAttribute('href'),'tel:+74955837811');assert.equal(await page.getByRole('button',{name:'Отменить бронь',exact:true}).count(),1);assert.ok(!(await page.locator('#club-mine').textContent()).includes('Нужна помощь администратора'));
  assert.deepEqual(errors,[]);console.log('Polish UI passed: mandatory registration, DOB wheels, payload, occupied-PC refusal, SVG, logo secret, old attention cancellation and telephone link.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
