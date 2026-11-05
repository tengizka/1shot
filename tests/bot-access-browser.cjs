// After a booking the mini-app asks Telegram for write access only when the bot cannot reach the guest.
const {chromium}=require('playwright');const path=require('path');const assert=require('assert');
const src=path.join(__dirname,'..','miniapp','bot-access.js');
async function run(reachable,mode,withCard){
 const b=await chromium.launch();const p=await b.newPage();
 await p.route('http://club.test/',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await p.goto('http://club.test/');
 await p.evaluate(({reachable})=>{
  window.asked=0;window.calls=[];window.SUPA='x';
  window.apiFetch=async(u,o)=>{calls.push(JSON.parse(o.body).action);return {reachable}};
  window.Telegram={WebApp:{initData:'q',isVersionAtLeast:()=>true,requestWriteAccess:cb=>{asked++;cb(true)}}};
 },{reachable});
 await p.addScriptTag({path:src});
 await p.evaluate(({mode,withCard})=>{
  dispatchEvent(new CustomEvent('club:booked',{detail:{mode}}));
  if(withCard){const d=document.createElement('dialog');d.id='bk-welcome';document.body.append(d);setTimeout(()=>d.show(),300);setTimeout(()=>d.close(),1500)}
 },{mode,withCard});
 await p.waitForTimeout(800);const early=await p.evaluate(()=>asked);
 await p.waitForTimeout(2600);
 const r=await p.evaluate(()=>({asked,calls,store:localStorage.getItem('1shot_bot_access')}));
 await b.close();return {...r,early};
}
(async()=>{
 const a=await run(true,'scheduled',true);
 assert.equal(a.asked,0,'reachable guest sees no popup');assert.deepEqual(a.calls,['bot_reach']);
 const c=await run(false,'scheduled',true);
 assert.equal(c.early,0,'popup waits for the «Ждём вас» card');assert.equal(c.asked,1,'unreachable guest is asked once');
 assert.match(c.store,/"ok":true/);
 const i=await run(false,'instant',false);assert.equal(i.asked,1);
 console.log('bot-access ok');
})().catch(e=>{console.error(e);process.exit(1)});
