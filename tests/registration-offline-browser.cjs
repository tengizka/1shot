const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
// Registration happens at the reception only: «Нет аккаунта?» explains it, with the promo word, and sends nothing online.
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123},start_param:'headshot'},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){const raw=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=fs.existsSync('miniapp/'+raw)?'miniapp/'+raw:raw;
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(file)});return route.fulfill({status:404,body:''})}
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')||url.pathname.endsWith('/club-auth')){const b=route.request().postDataJSON();calls.push(b);return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,protocol:2,desk:{online:true,valid_for_ms:30000}})})}
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  await page.getByRole('button',{name:'Нет аккаунта?',exact:true}).click();
  await page.waitForSelector('#auth-offline:not([hidden])');
  assert.equal(await page.locator('#offline-word b').innerText(),'HEADSHOT','promo word from the bot link');
  assert.equal(await page.locator('#form-register.active').count(),0,'online form never opens');
  assert.ok(!calls.some(b=>/register|application/.test(String(b.action))),'nothing is sent online');
  assert.deepEqual(errors,[]);
  console.log('Registration offline PASS: reception-only explanation with the promo word, no online application.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
