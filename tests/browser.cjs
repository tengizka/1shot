// npm install --prefix /tmp/1shot-browser @sparticuz/chromium playwright-core
// NODE_PATH=/tmp/1shot-browser/node_modules node tests/browser.cjs
const {chromium}=require('playwright-core');
const binary=require('@sparticuz/chromium').default;
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let hosts=[],reservationCalls=0;
  await page.route('**/*',route=>{
   const url=route.request().url();
   for(const file of ['hall-map.js','hall-swipe.js','experience.js','club-booking.js'])if(url.startsWith('https://club.test/'+file))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')});
   if(url.startsWith('https://club.test/assets/fonts/')) {
    const file=new URL(url).pathname.slice(1);
    return route.fulfill({contentType:file.endsWith('.css')?'text/css':'font/woff2',body:fs.readFileSync(file)});
   }
   if(url.startsWith('https://club.test/hall.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync('hall.css','utf8')});
   if(url.startsWith('https://club.test/club-booking.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync('club-booking.css','utf8')});
   if(url.includes('/functions/v1/club-bookings'))return route.fulfill({contentType:'application/json',body:'{"enabled":false}'});
   if(url==='https://club.test/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('index.html','utf8')});
   if(url.includes('/functions/v1/hosts'))return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({hosts})});
   if(url.includes('/functions/v1/reservations')){reservationCalls++;return route.fulfill({contentType:'application/json',body:'{}'});}
   return route.abort();
  });
  await page.addInitScript(()=>localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:0,username:'Test',gizmo_user_id:1})));
  await page.goto('https://club.test/');
  await page.waitForSelector('#splash.splash-started');
  const entrance=await page.locator('.logo-fragment').first().evaluate(e=>getComputedStyle(e).animationName);
  assert.equal(entrance,'assembleLogo');
  assert.equal(await page.locator('.logo-fragment').count(),9);
  assert.equal(await page.locator('.logo-fragment').first().evaluate(e=>getComputedStyle(e).animationDuration),'1.65s');
  await page.screenshot({path:'/tmp/1shot-splash-unbounded.png'});
  await page.waitForSelector('.map-pc');
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('600 12px Unbounded','КИБЕРХАУС')),true);
  assert.match(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily),/Unbounded/);
  assert.match(await page.locator('.map-number').first().evaluate(e=>getComputedStyle(e).fontFamily),/Unbounded/);
  assert.equal(await page.locator('.map-pc').count(),10);
  assert.equal(await page.locator('.map-pc:not(:disabled)').count(),0);
  await page.waitForFunction(()=>document.getElementById('hall-loading').textContent.includes('пустой'));
  async function noOverflow(){
   const sizes=await page.evaluate(()=>['app','hall-area','floor-map'].map(id=>{const e=document.getElementById(id);return {id,h:e.scrollHeight,ch:e.clientHeight,w:e.scrollWidth,cw:e.clientWidth};}));
   sizes.forEach(s=>{assert.ok(s.h<=s.ch+1,JSON.stringify(s));assert.ok(s.w<=s.cw+1,JSON.stringify(s));});
   const card=await page.locator('.map-pc').first().boundingBox();assert.ok(card.width>=44&&card.height>=44,JSON.stringify(card));
  }
  for(const [width,height] of [[390,844],[320,568],[375,667],[844,390]]){
   await page.setViewportSize({width,height});await noOverflow();
   await page.evaluate(()=>switchZone('standard'));await noOverflow();
   await page.evaluate(()=>{seatPage=1;renderHall()});await noOverflow();
   await page.evaluate(()=>switchZone('vip'));
  }
  await page.setViewportSize({width:390,height:844});
  hosts=await page.evaluate(()=>HALL_LAYOUT.map((p,i)=>({host_id:p.id,zone:p.zone,status:i===6?'reserved':i===7?'busy':i===8?'broken':'free',updated_at:new Date().toISOString()})));
  await page.evaluate(()=>fetchHosts());
  assert.equal(await page.locator('.map-pc.reserved svg').count(),1);
  await page.screenshot({path:'/tmp/1shot-seats-vip.png'});
  await page.locator('[data-zone="standard"]').click();
  const ids=()=>page.locator('.map-pc').evaluateAll(els=>els.map(e=>e.dataset.hid));
  const first=await ids();await page.locator('#seat-next').click();const second=await ids();
  await page.locator('#seat-next').click();const third=await ids();assert.equal(new Set([...first,...second,...third]).size,20);assert.ok(!first.includes('1')&&!second.includes('1'));
  assert.equal(await page.locator('#seat-next').isDisabled(),true);
  await page.screenshot({path:'/tmp/1shot-seats-standard.png'});
  await page.locator('.ps5-phone-card').click();
  assert.equal(await page.locator('#club-contact').evaluate(e=>e.open),true);
  await page.evaluate(()=>closeClubContact());
  await page.evaluate(()=>openBooking('1','ps5',false));
  assert.equal(await page.locator('#club-contact').evaluate(e=>e.open),true);
  assert.equal(await page.locator('#booking-sheet.open').count(),0);
  await page.evaluate(()=>closeClubContact());
  await page.evaluate(()=>{booking={hostId:'1',zone:'ps5'};return confirmBooking();});
  assert.equal(reservationCalls,0);await page.evaluate(()=>closeClubContact());
  await page.locator('[data-zone="vip"]').click();
  await page.locator('[data-hid="14"]').click();
  await page.waitForSelector('#booking-sheet.open');
  await page.evaluate(()=>closeSheet());
  const nav=await page.locator('.nav-btn').evaluateAll(els=>els.map(e=>({id:e.id,x:e.getBoundingClientRect().x})).sort((a,b)=>a.x-b.x));
  assert.equal(nav[1].id,'nav-hall');
  await page.locator('#nav-tariffs').click();assert.equal(await page.locator('.rate-card').count(),3);
  await page.locator('#nav-hall').click();
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#matrix-rain').evaluate(e=>getComputedStyle(e).display),'none');
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: Unbounded loaded, fragment assembly, fixed seat pages, phone-only PS5, no overflow at 4 sizes, minimum 44px targets, booking and nav.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
