const {chromium}=require('playwright-core');
const binary=require('@sparticuz/chromium').default;
const fs=require('node:fs');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:700},timezoneId:'America/Los_Angeles',reducedMotion:'reduce'});
  const now=Date.UTC(2026,10,27,13);
  await page.clock.install({time:now});
  const at=h=>new Date(now+h*3600000).toISOString();
  const iso=h=>String(now+h*3600000);
  const hosts=[{host_id:'104',status:'free'},{host_id:'105',status:'free'},{host_id:'106',status:'busy',free_at:at(0.5)}];
  const reservations=[{host_id:'105',starts_at:at(2),ends_at:at(4)}];
  let rows=[],creates=[],scheduleReady=true;
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};
   localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,username:'Guest',gizmo_user_id:123}));
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const file=fs.existsSync('miniapp/'+path)?'miniapp/'+path:path;
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404});
    return route.fulfill({path:file});
   }
   if(url.host==='telegram.org')return route.fulfill({contentType:'text/javascript',body:''});
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   const live=hosts.map(h=>({...h,updated_at:at(0)}));
   const bookingBackend={booking_backend:'gizmo',enabled:true,protocol:2,poll_bundle:1,desk:{online:true,valid_for_ms:30000}};
   if(url.pathname.endsWith('/hosts'))return route.fulfill({json:{hosts:live}});
   if(!url.pathname.endsWith('/club-bookings'))return route.abort();
   const body=route.request().postDataJSON();
   switch(body.action){
    case 'capabilities':return route.fulfill({json:bookingBackend});
    case 'state':return route.fulfill({json:{...bookingBackend,hosts:live,bookings:[]}});
    case 'native_schedule':return route.fulfill({json:{ready:scheduleReady,server_time:at(0),valid_for_ms:30000,hosts,reservations}});
    case 'native_list':return route.fulfill({json:{bookings:rows}});
    case 'native_create':
     creates.push(body);rows=[{...body,status:'queued'}];return route.fulfill({status:202,json:{id:body.id,status:'queued'}});
    case 'native_cancel':
     rows=rows.map(r=>({...r,status:'cancelled'}));return route.fulfill({json:{ok:true}});
    default:return route.fulfill({json:{}});
   }
  });
  await page.goto('https://club.test/');
  await page.waitForSelector('#splash',{state:'hidden'});
  await page.waitForSelector('#gizmo-filter');
  await page.locator('.ztab[data-zone="z1"]').click();
  await page.locator('[data-hid="105"]').click();
  await page.getByText(/Свободен до .*18:00.*Ближайшая бронь/).waitFor();
  await page.locator('#gizmo-start').selectOption(iso(0.5));
  await page.locator('#gizmo-end').selectOption(iso(3.5));
  assert.equal(await page.locator('#gizmo-submit').isDisabled(),true);
  await page.locator('#gizmo-shorten').click();
  assert.equal(await page.locator('#gizmo-end').inputValue(),iso(2));
  assert.equal(await page.locator('#gizmo-submit').isEnabled(),true);
  await page.locator('#gizmo-end').selectOption(iso(3.5));
  await page.locator('#gizmo-other').click();
  assert.match(await page.locator('#gizmo-filter').innerText(),/16:30.*19:30/);
  assert.equal(await page.locator('.map-pc[data-hid="105"].reserved').count(),1);
  assert.equal(await page.locator('.map-pc[data-hid="106"].free').count(),1);
  await page.locator('.ztab[data-zone="z1"]').click();
  await page.locator('[data-hid="104"]').click();
  assert.equal(await page.locator('#gizmo-end').inputValue(),iso(3.5));
  await page.locator('#gizmo-submit').click();
  await page.getByText('Оформляем бронь…',{exact:true}).waitFor();
  assert.equal(creates.length,1);
  assert.equal(creates[0].starts_at,at(0.5));
  assert.equal(creates[0].ends_at,at(3.5));
  assert.equal(await page.locator('#club-mine input').count(),0);
  await page.locator('#club-close').click();
  scheduleReady=false;
  await page.locator('[data-hid="105"]').click();
  await page.getByText(/Расписание недоступно/).waitFor();
  assert.match(await page.locator('#gizmo-submit').textContent(),/Обновить расписание/);
  scheduleReady=true;
  await page.locator('#gizmo-submit').click();
  await page.locator('#gizmo-start').selectOption(iso(7.5));
  await page.locator('#gizmo-end').selectOption(iso(9.5));
  assert.match(await page.locator('#gizmo-submit').textContent(),/27 .*23:30.*28 .*01:30/);
  assert.deepEqual(errors,[]);
  console.log('Native booking PASS: Moscow clock, manual reservation, shortening, map alternatives, pending state, stale calendar.');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
