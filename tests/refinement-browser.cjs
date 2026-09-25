const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'guest',gizmo_user_id:7}))});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)})}
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:[11,12,13,14,15,21,22,23,24,25].map(id=>({host_id:String(id),status:id===11?'busy':'free',updated_at:new Date().toISOString()}))})});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(b.action==='capabilities'?{enabled:true,protocol:2}:b.action==='list'?{bookings:[{id:'old',host_id:'21',status:'completed',mode:'arrival',protocol:2}]}:b.action==='account'?{account:{updated_at:new Date().toISOString(),data:{username:'guest',balance:123,session:null}},commands:[{kind:'logout',status:'done',message:'Выход подтверждён Gizmo'}]}:{ok:true})})}
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForFunction(()=>window.clubV2);
  assert.equal(await page.locator('#app #club-my-bookings').count(),0);assert.equal(await page.locator('#ov-profile #club-my-bookings').count(),0);
  const variants=new Set();let lastPhrase,lastButton;
  for(let i=0;i<6;i++){await page.locator('[data-hid="11"]').click();const box=page.locator('#occupied-dialog');variants.add(await box.getAttribute('data-variant'));const phrase=await box.locator('p').textContent(),button=await box.locator('button').textContent();assert.notEqual(phrase,lastPhrase);assert.notEqual(button,lastButton);lastPhrase=phrase;lastButton=button;const rect=await box.boundingBox();assert.ok(Math.abs(rect.x+rect.width/2-195)<2);assert.ok(Math.abs(rect.y+rect.height/2-422)<2);assert.ok(rect.width<=250);assert.equal(await box.locator('svg').count(),1);await box.locator('button').click()}
  assert.equal(variants.size,6);
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.locator('[data-hid="12"]').click();await page.locator('[data-mode="scheduled"]').click();
   assert.equal(await page.locator('#club-minutes button').count(),12);assert.deepEqual(await page.locator('#club-minutes button').allTextContents(),['00','05','10','15','20','25','30','35','40','45','50','55']);assert.equal(await page.locator('[data-kind],#friend-option').count(),0);
   const button=await page.locator('#club-submit').boundingBox();assert.ok(button.y>=0&&button.y+button.height<=viewport.height,JSON.stringify({viewport,button}));assert.equal(await page.locator('#club-booking').evaluate(e=>e.scrollTop),0);await page.locator('#club-close').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('[data-hid="12"]').click();await page.locator('[data-mode="scheduled"]').click();
  await page.locator('#club-minutes').focus();await page.keyboard.press('End');assert.equal(await page.locator('#club-booking').evaluate(e=>e.open),true);
  let header=await page.locator('.club-sheet-head').boundingBox();const x=header.x+20,y=header.y+20;
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(130);await page.mouse.move(x,y+40,{steps:4});await page.mouse.up();assert.equal(await page.locator('#club-booking').evaluate(e=>e.open),true);
  header=await page.locator('.club-sheet-head').boundingBox();await page.mouse.move(x,header.y+15);await page.mouse.down();await page.waitForTimeout(140);await page.mouse.move(x,header.y+150,{steps:8});await page.mouse.up();assert.equal(await page.locator('#club-booking').evaluate(e=>e.open),false);
  await page.locator('#nav-profile').click();await page.waitForSelector('#request-password');const text=await page.locator('#ov-profile').innerText();assert.ok(!/Мои компьютеры|Выход подтверждён|Мини-апп|Сервер:/.test(text));assert.match(text,/version 1.5.0/);assert.ok(await page.locator('#request-password').evaluate(e=>e.classList.contains('btn-main')));
  assert.equal(await page.locator('.club-history,#club-my-bookings').count(),0);
  await page.evaluate(()=>navTo('tariffs'));await page.waitForSelector('.ps5-rate');assert.match(await page.locator('.ps5-rate').innerText(),/299/);assert.match(await page.locator('.ps5-rate').innerText(),/1 час/);assert.ok(!/\p{Extended_Pictographic}/u.test(await page.locator('body').innerText()));
  assert.deepEqual(errors,[]);console.log('1.4 UI: six centered SVG variants, compact 5-min picker at 3 sizes, cautious swipe, profile cleanup, no friend/history, SVG-only icons, PS5 tariff.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
