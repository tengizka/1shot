// Queue bar: joining shows the bar with the time left, the server state keeps it in sync, the cross leaves the queue,
// and a PC queued by another guest is reported instead of joined.
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
(async()=>{
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:390,height:844}});
 await p.route('http://club.test/',r=>r.fulfill({contentType:'text/html',body:'<div id="app" class="active"><div class="bottom-nav" style="position:fixed;bottom:0;left:0;right:0;height:70px"></div></div>'}));
 await p.goto('http://club.test/');
 await p.evaluate(()=>{
  window.calls=[];window.toasts=[];window.SUPA='x';window.clubText=t=>t;window.toast=(t,k)=>toasts.push([t,k]);
  window.hostsData={'101':{queued:false},'102':{queued:true}};
  window.serverQueue=null;
  window.apiFetch=async(u,o)=>{const body=JSON.parse(o.body);calls.push(body.action);
   if(body.action==='queue_join'){if(body.host_id==='102')throw Error('HTTP 409: На этот ПК уже стоит очередь. Выбери другое место');serverQueue={host_id:body.host_id,free_at:new Date(Date.now()+25*60000).toISOString()};return serverQueue}
   if(body.action==='queue_leave'){serverQueue=null;return {ok:true}}};
  window.getClubState=async()=>({hosts:[],bookings:[],queue:serverQueue});
 });
 await p.addScriptTag({path:path.join(__dirname,'..','miniapp','queue.js')});
 await p.evaluate(()=>joinQueue('101'));
 await p.waitForTimeout(1800);
 const text=await p.textContent('#queue-bar');
 assert.match(text,/Ты в очереди за ПК 101/);assert.match(text,/освободится через 2[45]m/);
 assert.equal(await p.evaluate(()=>document.getElementById('queue-bar').classList.contains('docked')),true,'the notice docks as the bar');
 const box=await p.$eval('#queue-bar',e=>e.getBoundingClientRect().bottom);assert.ok(box<=844-70,'the bar sits above the bottom menu');
 await p.evaluate(()=>getClubState());assert.ok(await p.$('#queue-bar'),'server state keeps the bar');
 assert.equal(await p.evaluate(()=>queueTaken('102')),true);assert.equal(await p.evaluate(()=>queueTaken('101')),false);
 await p.evaluate(()=>joinQueue('102'));
 assert.match(await p.evaluate(()=>toasts.at(-1)[0]),/уже стоит очередь/);
 await p.click('.queue-x');await p.waitForTimeout(200);
 assert.equal(await p.$('#queue-bar'),null,'the cross leaves the queue');
 assert.deepEqual(await p.evaluate(()=>calls),['queue_join','queue_join','queue_leave']);
 // The server ended the queue with a booking on that PC: the bar goes and the guest hears about it.
 await p.evaluate(()=>{serverQueue={host_id:'103',free_at:null}});await p.evaluate(()=>getClubState());
 assert.match(await p.textContent('#queue-bar'),/ждём, когда освободится/);
 await b.close();console.log('queue ok');
})().catch(e=>{console.error(e);process.exit(1)});
