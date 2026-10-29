const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const freeAt=new Date(Date.now()+47*60000).toISOString();
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test-signed',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,gizmo_user_id:7,username:'guest',balance:100}))});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){const raw=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=fs.existsSync('miniapp/'+raw)?'miniapp/'+raw:raw;if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(file)});return route.fulfill({status:404,body:''})}
   const now=new Date().toISOString();
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:[{host_id:'13',status:'busy',free_at:freeAt,updated_at:now},{host_id:'14',status:'busy',free_at:null,updated_at:now},{host_id:'11',status:'free',updated_at:now}]})});
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();requests.push(b);let r={ok:true};
    if(b.action==='capabilities')r={desk:{online:true,valid_for_ms:30000},enabled:true,protocol:2};
    if(b.action==='list')r={bookings:[]};
    if(b.action==='account')r={account:{data:{username:'guest',balance:100,session:null},updated_at:now},commands:[]};
    if(b.action==='create_v2')r={booking_id:'b1'};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(r)})}
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForFunction(()=>window.clubV2);
  await page.evaluate(()=>switchZone('vip'));await page.waitForTimeout(800);
  await page.locator('[data-hid="14"]').click();await page.waitForSelector('#occupied-dialog[open]');
  assert.match(await page.locator('.occupied-free').innerText(),/надолго/);assert.equal(await page.locator('.occupied-after').isVisible(),false,'no end time — no button');
  await page.locator('#occupied-dialog .btn-main').click();await page.waitForTimeout(300);
  await page.locator('[data-hid="13"]').click();await page.waitForSelector('#occupied-dialog[open]');
  const hm=t=>new Date(t).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
  assert.equal(await page.locator('.occupied-free').innerText(),'Освободится примерно в '+hm(freeAt));
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/busy.png'});
  const at=Math.ceil(Date.parse(freeAt)/300000)*300000;
  assert.match(await page.locator('.occupied-after').innerText(),new RegExp(hm(at)));
  await page.locator('.occupied-after').click();await page.waitForSelector('#club-booking[open]');
  assert.equal(await page.locator('#instant-mode').isVisible(),false,'no «sit now» on a busy PC');
  assert.match(await page.locator('#club-submit').innerText(),new RegExp(hm(at)));
  if(process.env.SHOTS){await page.waitForTimeout(900);await page.screenshot({path:process.env.SHOTS+'/after.png'})}
  await page.locator('#club-submit').click();await page.waitForFunction(()=>true);await page.waitForTimeout(800);
  const c=requests.find(b=>b.action==='create_v2');assert.ok(c,'booking sent');assert.equal(c.host_id,'13');assert.equal(Date.parse(c.starts_at),at);
  assert.deepEqual(errors,[]);
  console.log('Book-after PASS: busy PC shows when it frees, books right after, «надолго» without a time.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
