const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],requests=[];let command=null,polls=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test-signed',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){},openLink(u){window.__link=u}}};localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,gizmo_user_id:7,username:'guest',balance:321.5}))});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){const raw=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=fs.existsSync('miniapp/'+raw)?'miniapp/'+raw:raw;if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(file)});return route.fulfill({status:404,body:''})}
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:[]})});
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();requests.push(b);let r={ok:true};
    if(b.action==='capabilities')r={desk:{online:true,valid_for_ms:30000},enabled:true,protocol:2};
    if(b.action==='list')r={bookings:[]};
    if(b.action==='command'){command={id:'cmd-topup',kind:'topup',status:'queued',message:null};r={id:command.id}}
    if(b.action==='account'){if(command&&++polls>=2)Object.assign(command,{status:'done',message:'https://pay.tbank.ru/abc'});r={account:{data:{username:'guest',firstName:'Андрей',balance:321.5,session:null},updated_at:new Date().toISOString()},commands:command?[command]:[]}}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(r)})}
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  await page.locator('.app-header .balance-chip').click();await page.waitForSelector('#topup[open]');
  assert.match(await page.locator('#topup .topup-now').innerText(),/321,5/);
  await page.locator('#topup .topup-close').click();
  await page.locator('#nav-profile').click();await page.waitForSelector('#ov-profile .ov-balance');
  assert.equal(await page.locator('#ov-profile .bal-card').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(163, 255, 16)','lime balance cell');
  await page.locator('#ov-profile .bal-topup').click();await page.waitForSelector('#topup[open]');
  await page.locator('#topup [data-sum="2000"]').click();assert.match(await page.locator('#topup .topup-bonus').innerText(),/4h STD/);
  await page.locator('#topup-amount').fill('50');assert.equal(await page.locator('#topup .topup-pay').isDisabled(),true,'below 100 ₽ cannot pay');
  await page.locator('#topup-amount').fill('1500');await page.locator('#topup .topup-pay').click();
  await page.waitForFunction(()=>window.__link);
  assert.equal(await page.evaluate(()=>window.__link),'https://pay.tbank.ru/abc');
  const cmd=requests.find(b=>b.action==='command');assert.equal(cmd.kind,'topup');assert.deepEqual(cmd.payload,{amount:1500});
  assert.match(await page.locator('#topup .topup-pay').innerText(),/ещё раз/i);
  assert.deepEqual(errors,[]);
  console.log('Top-up PASS: balance chip on every section, lime profile cell, amount limits, bonus line, Desk link opened.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
