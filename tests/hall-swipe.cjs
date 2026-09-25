// Real Chromium touch events: page transitions must never open a booking by accident.
const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default;
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ids=[11,12,13,14,15,21,22,23,24,25,101,102,103,104,105,106,201,202,203,204,205,206,207,208,301,302,303,304,401,402,1];
  await page.addInitScript(()=>localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:0,username:'Test',gizmo_user_id:7})));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});
   }
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:JSON.stringify({hosts:ids.map(id=>({host_id:String(id),status:'free',updated_at:new Date().toISOString()}))})});
   if(url.pathname.endsWith('/club-bookings'))return route.fulfill({contentType:'application/json',body:'{"enabled":false}'});
   return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});await page.waitForSelector('.map-pc.free');
  const cdp=await page.context().newCDPSession(page);
  const settled=()=>page.waitForFunction(()=>!document.getElementById('seat-viewport').classList.contains('is-moving'));
  const position=()=>page.evaluate(()=>hallPageIndex());
  async function swipe(dx,dy=0,cancel=false){
   await settled();const box=await page.locator('#seat-viewport').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
   const point=(x,y)=>({x,y,id:1,radiusX:2,radiusY:2,force:1});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
   for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x+dx*i/6,y+dy*i/6)]});
   await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
   await settled();
   assert.equal(await page.locator('#booking-sheet.open').count(),0,'swipe must not click PC');
   assert.equal(await page.locator('.hall-page-ghost').count(),0,'old page disposed');
   assert.equal(await page.locator('.map-pc').count(),await page.evaluate(()=>getZonePages(activeZone)[seatPage].length));
   assert.equal(await page.locator('#seat-viewport').evaluate(e=>e.scrollLeft),0);
  }
  assert.equal(await position(),0);
  await swipe(-130);assert.equal(await position(),1);assert.equal(await page.locator('[data-zone="standard"]').getAttribute('aria-pressed'),'true');
  await swipe(-130);assert.equal(await position(),2);
  await swipe(-130);assert.equal(await position(),3);await swipe(-130);assert.equal(await position(),3,'no wrapping beyond last page');await swipe(130);assert.equal(await position(),2);
  await swipe(130);assert.equal(await position(),1);
  await swipe(20);assert.equal(await position(),1,'short drag returns to current page');
  await swipe(0,70);assert.equal(await position(),1,'vertical movement must not navigate');
  await swipe(130,0,true);assert.equal(await position(),1,'cancelled gesture must not navigate');
  await page.locator('.map-pc').first().tap();await page.waitForSelector('#booking-sheet.open');await page.evaluate(()=>closeSheet());
  await page.locator('#seat-prev').click();await settled();assert.equal(await position(),0,'arrows cross zone boundary');
  await page.evaluate(()=>{hostsData={};renderHall()});
  await swipe(-130);assert.equal(await position(),1,'disabled unknown PCs must not block swipe');
  await page.emulateMedia({reducedMotion:'reduce'});await swipe(-130);assert.equal(await position(),2);
  await page.locator('[data-zone="vip"]').click();assert.equal(await position(),0);assert.equal(await page.locator('.hall-page-ghost').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Touch swipe passed: all pages, zone tabs, edge resistance, vertical/short/cancelled gestures, disabled PCs, tap safety, arrows and reduced motion.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
