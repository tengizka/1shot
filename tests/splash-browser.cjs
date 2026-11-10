// Ten start screens: each one renders, ends with the whole logo visible, and its mascot never overlaps the logo.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert');
(async()=>{
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:390,height:844}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.host!=='club.test')return r.abort();
  const f='miniapp/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));
  return fs.existsSync(f)?r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)}):r.fulfill({status:404,body:''})});
 const seen=new Set();
 for(let n=1;n<=10;n++){
  await p.goto('https://club.test/?splash='+n);await p.waitForSelector('#splash.splash-started');await p.waitForTimeout(2300);
  const r=await p.evaluate(()=>{const box=e=>{const q=e.getBoundingClientRect();return [q.left,q.top,q.right,q.bottom]};
   const logo=document.querySelector('#splash .sp-logo'),m=document.querySelector('#splash .sp-mascot');
   return {name:document.getElementById('splash').dataset.splash,logo:box(logo),mascot:m&&getComputedStyle(m).opacity>0.05?box(m):null}});
  seen.add(r.name);assert.ok(r.logo[2]-r.logo[0]>150,r.name+': the logo is on screen');
  if(r.mascot){const [al,at,ar,ab]=r.logo,[bl,bt,br,bb]=r.mascot;assert.ok(br<=al||bl>=ar||bb<=at||bt>=ab,r.name+': the mascot must not overlap the logo')}
 }
 assert.equal(seen.size,10,'ten different splashes');
 // Without ?splash the choice is random and never repeats the previous one.
 const picks=[];for(let i=0;i<6;i++){await p.goto('https://club.test/');await p.waitForSelector('#splash.splash-started');picks.push(await p.evaluate(()=>document.getElementById('splash').dataset.splash))}
 for(let i=1;i<picks.length;i++)assert.notEqual(picks[i],picks[i-1],'no splash twice in a row');
 assert.deepEqual(errors,[]);await b.close();console.log('splash ok: 10 variants, no overlap, no repeats');
})().catch(e=>{console.error(e);process.exit(1)});
