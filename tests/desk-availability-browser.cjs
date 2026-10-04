const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),calls=[],errors=[];
  let online=false,missing=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.Telegram={WebApp:{initData:'test-only',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};
   window.testHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.testHidden});
  });
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});
   }
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){
    const b=route.request().postDataJSON();calls.push(b.action);
    const data=b.action==='capabilities'?{enabled:true,protocol:2,poll_bundle:1}:{bookings:[],hosts:[],account:null,commands:[]};
    if(!missing)data.desk={online,valid_for_ms:online?30000:0};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});
   return route.abort();
  });
  const shown=()=>page.waitForSelector('#desk-availability[open]');
  const hidden=()=>page.waitForFunction(()=>!document.querySelector('#desk-availability').open);
  const resume=()=>page.evaluate(()=>window.dispatchEvent(new Event('club:resume')));
  await page.goto('https://club.test/');await shown();
  assert.equal(await page.textContent('#desk-availability-title'),'Ведутся тех. работы');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#desk-availability').getAttribute('open'),'');
  for(const [endpoint,action] of [['club-bookings','create_v2'],['club-bookings','command'],['club-auth','login'],['club-auth','register']]){
   const result=await page.evaluate(async({endpoint,action})=>{try{await apiFetch(`${SUPA}/${endpoint}`,{method:'POST',body:JSON.stringify({action})});return 'sent'}catch(e){return e.message}},{endpoint,action});
   assert.match(result,/тех\. работы/);
  }
  assert.ok(calls.every(x=>x==='capabilities'),'writes blocked before network');
  const box=await page.locator('#desk-availability').boundingBox();
  assert.ok(Math.abs(box.x+box.width/2-195)<2&&Math.abs(box.y+box.height/2-422)<2,'maintenance dialog centered');
  await page.screenshot({path:'/tmp/1shot-maintenance.png'});
  online=true;await hidden(); // automatic guest recovery, no reload
  await page.evaluate(()=>{
   deskAvailability.accept({online:true,valid_for_ms:100},performance.now());
   deskAvailability.accept({online:true,valid_for_ms:30000},performance.now()-1000);
  });await shown();
  await resume();await hidden();await page.waitForTimeout(250);
  await page.evaluate(()=>deskAvailability.accept({online:true,valid_for_ms:100},performance.now()-200));await shown();
  calls.length=0;
  await page.evaluate(()=>{testHidden=true;document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForTimeout(5500);assert.deepEqual(calls,[]);
  await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'))});await hidden();
  online=false;await shown();assert.equal(await page.textContent('#desk-availability-title'),'Ведутся тех. работы');
  online=true;await resume();await hidden();
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await shown();
  assert.equal(await page.textContent('#desk-availability-title'),'Не удалось проверить связь');
  missing=true;await resume();await shown();assert.equal(await page.evaluate(()=>deskAvailability.blocked),true);
  missing=false;await resume();await hidden();
  await page.evaluate(()=>localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'guest',gizmo_user_id:7})));
  await page.reload();await hidden();await page.waitForTimeout(1000);calls.length=0;
  await page.waitForTimeout(5500);assert.deepEqual(calls,['state']);
  online=false;await shown();online=true;await hidden();
  assert.deepEqual(errors,[]);
  console.log('PASS: guest/signed startup, blocked writes/Escape, auto loss/recovery, stale/delayed lease, hidden pause, safe errors and one bundled poll.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
