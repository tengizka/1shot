// Regression: the schematic hall plan fits every viewport; zoomed zones keep 44px seats with no overlap.
const {chromium}=require('playwright-core');
const binary=require('@sparticuz/chromium').default;
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:423,height:725}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));let live=false,sessionVisible=false;
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
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  await page.waitForFunction(()=>window.clubV2);
  async function check(zone){
   if(await page.locator('#session-screen').isVisible()){assert.equal(await page.locator('#hall-area').isVisible(),false);assert.ok(await page.locator('#session-screen').evaluate(e=>e.scrollWidth<=e.clientWidth+1));return}
   const report=await page.evaluate(zone=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    return {containers:['app','hall-area','floor-shell'].map(id=>{const e=document.getElementById(id)||document.querySelector('.'+id);return {id,h:e.scrollHeight,ch:e.clientHeight,w:e.scrollWidth,cw:e.clientWidth}}),
     plan:rect(document.getElementById('hall-plan')),all:document.querySelectorAll('.map-pc').length,
     cards:[...document.querySelectorAll(zone==='all'?'.map-pc':`.map-pc[data-zone="${zone}"]`)].map(e=>({id:e.dataset.hid,...rect(e),number:rect(e.querySelector('.map-number'))})),
     phone:{color:getComputedStyle(document.querySelector('.ps5-phone-card')).color,decoration:getComputedStyle(document.querySelector('.ps5-phone-card')).textDecorationLine}};
   },zone);
   for(const c of report.containers)assert.ok(c.h<=c.ch+1&&c.w<=c.cw+1,JSON.stringify(c));
   assert.equal(report.all,30);assert.ok(report.cards.length>0);
   for(const c of report.cards){
    if(zone==='all')assert.ok(c.x>=report.plan.x-1&&c.right<=report.plan.right+1&&c.y>=report.plan.y-1&&c.bottom<=report.plan.bottom+1,'overview fits '+JSON.stringify(c));
    else assert.ok(c.width>=44&&c.height>=44,JSON.stringify(c));
    assert.ok(c.number.y>=c.y-.5&&c.number.bottom<=c.bottom+.5&&c.number.right<=c.right+.5,JSON.stringify(c));
    for(const b of report.cards)if(b.id!==c.id)assert.ok(c.right<=b.x+.5||b.right<=c.x+.5||c.bottom<=b.y+.5||b.bottom<=c.y+.5,`overlap ${c.id}/${b.id}`);
   }
   if(zone!=='all')for(const id of report.cards.map(c=>c.id)){const card=page.locator(`[data-hid="${id}"]`);await card.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));assert.ok(await card.evaluate(e=>{const r=e.getBoundingClientRect(),v=document.getElementById('hall-plan').getBoundingClientRect();return r.top>=v.top-1&&r.bottom<=v.bottom+1&&r.left>=v.left-1&&r.right<=v.right+1}),'seat reachable '+id)}
   assert.equal(report.phone.color,'rgb(255, 255, 255)');assert.equal(report.phone.decoration,'none');
  }
  for(const active of [false,true]){
   sessionVisible=active;await page.reload();await page.waitForSelector('#splash',{state:'hidden'});await page.waitForFunction(()=>window.clubV2);
   if(active)await page.waitForSelector('#session-screen:not([hidden])');
  for(const online of [false,true]){
   live=online;await page.evaluate(()=>fetchHosts());
   for(const [width,height] of [[423,725],[423,756],[390,700],[375,681],[320,568],[844,390],[390,844],[390,950]]){
    await page.setViewportSize({width,height});
    for(const zone of ['all','vip','z1','z2','z34']){
     await page.evaluate(zone=>{switchZone(zone);setPlanView(zone,false)},zone);await check(zone);
     if(width===390&&height===844&&zone==='vip')await page.screenshot({path:`/tmp/1shot-hall-${online?'live':'offline'}-plan.png`});
    }
   }
  }
  }
  assert.deepEqual(errors,[]);console.log('160 hall plan layouts passed: with/without active session, stale/live hosts, 8 viewports, overview + 4 zoomed zones, no overlap, 44px zoomed seats.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
