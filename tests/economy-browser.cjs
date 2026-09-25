const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.Telegram={WebApp:{initData:'test-only',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};
   localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'guest',gizmo_user_id:7}));
   window.testHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.testHidden});
  });
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)})}
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){
    const b=route.request().postDataJSON();calls.push(b.action);
    const data=b.action==='capabilities'?{enabled:true,protocol:2,poll_bundle:1}:{bookings:[],hosts:[11,12,13,14,15,21,22,23,24,25].map(id=>({host_id:String(id),status:'free',updated_at:new Date().toISOString()})),account:{data:{username:'guest',balance:123,session:null},updated_at:new Date().toISOString()},commands:[],password_request:null};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.pathname.endsWith('/hosts')){calls.push('hosts');return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'})}
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForSelector('.map-pc.free');
  await page.waitForTimeout(1000);calls.length=0;
  await page.waitForTimeout(6000);assert.deepEqual(calls,['state'],'idle refresh must be one shared packet, not three calls');
  calls.length=0;
  await page.evaluate(()=>{testHidden=true;document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForTimeout(6000);assert.deepEqual(calls,[],'hidden app must not poll');
  await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(1000);assert.deepEqual(calls,['state'],'resume sends one fresh shared request');
  assert.deepEqual(errors,[]);console.log('Economy browser: one packet/5s, shared hosts/account/bookings, no hidden polls, one resume request.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
