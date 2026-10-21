// Real Chromium taps: the overview zooms into a zone first, it never opens a booking by accident.
const {chromium}=require('playwright-core');
const binary=require('@sparticuz/chromium').default;
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:423,height:725}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));let live=true,sessionVisible=false;
  await page.addInitScript(()=>{
   window.Telegram={WebApp:{initData:'test-only',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};
   localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'Test',gizmo_user_id:7}));
  });
  const ids=[11,12,13,14,15,21,22,23,24,25,101,102,103,104,105,106,201,202,203,204,205,206,207,208,301,302,303,304,401,402,1];
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const rawPath=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=fs.existsSync('miniapp/'+rawPath)?'miniapp/'+rawPath:rawPath;
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});
   }
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:ids.map((id,i)=>({host_id:String(id),status:i%8===0?'reserved':i%8===1?'busy':i%8===2?'broken':'free',updated_at:new Date(Date.now()-(live?0:3600000)).toISOString()}))})});
   if(url.pathname.endsWith('/club-bookings')){
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
    const action=route.request().postDataJSON().action;
    if(action==='account'&&sessionVisible)return route.fulfill({contentType:'application/json',body:JSON.stringify({account:{updated_at:new Date().toISOString(),data:{username:'Test',session:{host_id:'11',key:'test-session'}}},commands:[]})});
    return route.fulfill({status:action==='capabilities'?200:503,contentType:'application/json',body:action==='capabilities'?'{"enabled":true,"protocol":2,"desk":{"online":true,"valid_for_ms":30000}}':'{"error":"test offline"}'});
   }
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForFunction(()=>window.clubV2);
  await page.waitForSelector('.map-pc.free');
  const dialogOpen=()=>page.evaluate(()=>!!document.querySelector('dialog[open]')||document.getElementById('booking-sheet').classList.contains('open'));
  const zoomed=()=>page.evaluate(()=>({zone:activeZone,zoomedClass:document.getElementById('hall-plan').classList.contains('zoomed'),back:!document.getElementById('map-back').hidden,scale:planScale}));
  assert.deepEqual((await zoomed()).zone,'all');
  const free=await page.locator('.map-pc.free[data-zone="z1"]').first().getAttribute('data-hid');
  await page.locator(`[data-hid="${free}"]`).click();await page.waitForTimeout(600);
  let z=await zoomed();assert.equal(z.zone,'z1');assert.ok(z.zoomedClass&&z.back&&z.scale>=46/32-0.01,JSON.stringify(z));assert.equal(await dialogOpen(),false,'first tap only zooms');
  assert.equal(await page.locator('.ztab[data-zone="z1"]').getAttribute('aria-pressed'),'true');
  await page.click('#map-back');await page.waitForTimeout(600);z=await zoomed();assert.equal(z.zone,'all');assert.equal(z.back,false);
  await page.click('.ztab[data-zone="vip"]');await page.waitForTimeout(600);assert.equal((await zoomed()).zone,'vip');
  const empty=await page.evaluate(()=>{const r=document.getElementById('hall-plan').getBoundingClientRect();for(let y=r.top+20;y<r.bottom;y+=9)for(let x=r.left+10;x<r.right;x+=9){const e=document.elementFromPoint(x,y);if(e&&e.closest('#hall-plan')&&!e.closest('.map-pc,.plan-ps5'))return [x,y]}});
  await page.mouse.click(empty[0],empty[1]);await page.waitForTimeout(600);assert.equal((await zoomed()).zone,'all','a tap on empty floor returns to the overview');assert.equal(await dialogOpen(),false);
  await page.click('.ztab[data-zone="vip"]');await page.waitForTimeout(600);
  const other=await page.locator('.map-pc.free[data-zone="z1"]').first();await other.scrollIntoViewIfNeeded();await other.click();await page.waitForTimeout(600);
  assert.equal((await zoomed()).zone,'z1','tapping a seat of another zone moves there');assert.equal(await dialogOpen(),false);
  await page.locator(`[data-hid="${free}"]`).click();await page.waitForTimeout(500);assert.equal(await dialogOpen(),true,'tap inside the zoomed zone books');
  assert.deepEqual(errors,[]);console.log('Hall zoom passed: overview tap zooms, chips and back button, cross-zone taps, booking only inside the zoomed zone.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
