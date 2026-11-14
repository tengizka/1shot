/* Easter egg: «Аркада 1SHOT». In Settings, at the very bottom, a barely visible mascot; five taps open five tiny games
   starring our mascot. Keys work only while the arcade is open; Esc closes it. Best scores stay on this PC. */
(()=>{
 const LIME='#A3FF10',PINK='#E93E97',ORANGE='#FF8A1F',BLUE='#5B7BFF',INK='#F4F4EF',BG='#0E0E0D';
 const POLY=['4.62219,10.7343 4.0874,16.197 9.32084,8.74788 9.32084,12.7971 12.0713,12.7971 12.0713,0 4.62219,10.7343','0,17.4576 0,22.309 2.75043,22.309 2.82684,18.9474 6.26485,18.9474 6.26485,16.2352 4.08744,16.197 4.62223,10.7344 0,17.4576','33.6545,16.197 37.0162,16.197 42.2497,8.74788 42.2497,12.8353 45,12.8353 45,0 33.6545,16.197','2.75043,33.3106 2.75043,22.309 0,22.309 0,42.1732 12.0713,24.6393 12.0713,12.7971 9.32088,12.7971 9.32088,23.7988 2.75043,33.3106','35.6793,33.3107 35.6793,22.309 32.929,22.309 32.929,42.1733 44.962,24.6393 44.962,16.197 38.7353,16.197 38.7353,18.9474 42.2498,18.9474 42.2498,23.7988 35.6793,33.3107','26.7404,28.3445 26.7404,18.1833 24.1045,18.1833 24.1045,28.3445 26.7404,28.3445','24.1044,25.6707 20.0552,25.6707 20.0552,28.3446 24.1044,28.3446 24.1044,25.6707','23.3114,15 18.3187,15 17.4082,15 16,15 16,17.7122 20.6374,17.7122 23.3114,17.7122 23.3114,15','35.3114,15 30.3187,15 29.4082,15 28,15 28,17.7122 32.6374,17.7122 35.3114,17.7122 35.3114,15','25.4032,32.9495 20.4105,32.9495 19.5,32.9495 18.0918,32.9495 18.0918,35.6616 22.7292,35.6616 25.4032,35.6616 25.4032,32.9495'];
 const svg=color=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 47 45"><g fill="${color}">${POLY.map(p=>`<polygon points="${p}"/>`).join('')}</g></svg>`;
 const img=color=>{const i=new Image();i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg(color));return i};
 const MASCOT=img(LIME),MASCOT_PINK=img(PINK);
 const W=720,H=420;
 const rnd=(a,b)=>a+Math.random()*(b-a);
 const best=id=>{try{return Number(localStorage.getItem('arcade-best-'+id))||0}catch{return 0}};
 const saveBest=(id,v)=>{try{if(v>best(id))localStorage.setItem('arcade-best-'+id,String(v))}catch{}};
 const rr=(c,x,y,w,h,r,fill)=>{c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):c.rect(x,y,w,h);c.fillStyle=fill;c.fill()};
 const text=(c,t,x,y,size=16,color=INK,align='center')=>{c.fillStyle=color;c.font=`700 ${size}px Onest, Unbounded, sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillText(t,x,y)};
 const can=(c,x,y,s=1)=>{rr(c,x-9*s,y-14*s,18*s,28*s,5*s,LIME);rr(c,x-9*s,y-6*s,18*s,8*s,0,'#0A0A0A');text(c,'1',x,y-2*s,9*s,LIME)};
 const hit=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

 // ── 1 · Энергетики: catch the cans, dodge the bugs
 const catchGame=api=>{
  let x=W/2,items=[],t=0,spawn=0,lives=3,speed=150;
  return {
   update(dt,keys){t+=dt;spawn-=dt;speed=150+t*6;
    if(keys.ArrowLeft||keys.a)x-=420*dt;if(keys.ArrowRight||keys.d)x+=420*dt;x=Math.max(30,Math.min(W-30,x));
    if(spawn<=0){spawn=Math.max(.32,.9-t*.012);items.push({x:rnd(30,W-30),y:-20,bug:Math.random()<Math.min(.4,.15+t*.004)})}
    for(const it of items){it.y+=speed*dt;
     if(!it.done&&it.y>H-70&&it.y<H-20&&Math.abs(it.x-x)<34){it.done=true;if(it.bug){lives--;api.flash(PINK);if(!lives)api.over()}else api.add(1)}}
    items=items.filter(i=>!i.done&&i.y<H+30)},
   draw(c){c.drawImage(MASCOT,x-26,H-74,52,50);for(const it of items){if(it.bug){c.fillStyle=PINK;c.beginPath();c.arc(it.x,it.y,12,0,7);c.fill();text(c,'×',it.x,it.y+1,16,'#0A0A0A')}else can(c,it.x,it.y)}
    for(let i=0;i<3;i++)rr(c,W-30-i*22,16,14,14,4,i<lives?LIME:'#2A2A27')},
   move(px){x=px}
  };
 };
 // ── 2 · Пробежка: jump over the chairs
 const runGame=api=>{
  const G=H-60;let y=G,vy=0,obs=[],t=0,spawn=1.2,speed=280;
  const jump=()=>{if(y>=G-1)vy=-620};
  return {
   update(dt,keys){t+=dt;speed=280+t*9;if(keys[' ']||keys.ArrowUp||keys.w)jump();
    vy+=1600*dt;y=Math.min(G,y+vy*dt);spawn-=dt;
    if(spawn<=0){spawn=rnd(.75,1.5)*Math.max(.55,1-t*.01);obs.push({x:W+20,w:rnd(26,44),h:rnd(28,58)})}
    for(const o of obs)o.x-=speed*dt;obs=obs.filter(o=>o.x>-60);
    const me={x:80,y:y-44,w:40,h:40};for(const o of obs)if(hit(me,{x:o.x,y:G-o.h,w:o.w,h:o.h}))api.over();
    api.set(Math.floor(t*10))},
   draw(c){rr(c,0,G,W,2,0,'#2A2A27');c.drawImage(MASCOT,74,y-48,50,48);
    for(const o of obs){rr(c,o.x,G-o.h,o.w,o.h,6,ORANGE);rr(c,o.x+4,G-o.h+6,o.w-8,8,3,'#0A0A0A')}},
   click:jump
  };
 };
 // ── 3 · Где маскот? Tap the mascot on the monitors, not the pink errors
 const whackGame=api=>{
  const cells=[];for(let r=0;r<3;r++)for(let q=0;q<3;q++)cells.push({x:150+q*150,y:40+r*125,w:120,h:95,who:null,ttl:0});
  let left=30,spawn=.4;
  return {
   update(dt){left-=dt;api.timer(Math.ceil(left));if(left<=0)return api.over();spawn-=dt;
    for(const c of cells){if(c.who){c.ttl-=dt;if(c.ttl<=0)c.who=null}}
    if(spawn<=0){spawn=rnd(.35,.8);const free=cells.filter(c=>!c.who);if(free.length){const c=free[Math.floor(rnd(0,free.length))];c.who=Math.random()<.22?'err':'m';c.ttl=Math.max(.55,1.25-(30-left)*.02)}}},
   draw(c){for(const s of cells){rr(c,s.x,s.y,s.w,s.h,12,'#1B1B1A');rr(c,s.x+8,s.y+8,s.w-16,s.h-26,8,s.who==='err'?'#3A1426':'#0A0A0A');rr(c,s.x+s.w/2-12,s.y+s.h-12,24,6,3,'#2A2A27');
     if(s.who==='m')c.drawImage(MASCOT,s.x+s.w/2-24,s.y+16,48,46);if(s.who==='err')text(c,'ERROR',s.x+s.w/2,s.y+s.h/2-6,14,PINK)}},
   click(px,py){for(const s of cells)if(s.who&&px>s.x&&px<s.x+s.w&&py>s.y&&py<s.y+s.h){if(s.who==='m')api.add(1);else{api.add(-2);api.flash(PINK)}s.who=null}}
  };
 };
 // ── 4 · Змейка: the mascot collects cans, the tail grows
 const snakeGame=api=>{
  const S=30,CW=W/S,CH=H/S;let body=[{x:6,y:7},{x:5,y:7},{x:4,y:7}],dir={x:1,y:0},next=dir,step=0,food=null;
  const place=()=>{do food={x:Math.floor(rnd(0,CW)),y:Math.floor(rnd(0,CH))};while(body.some(b=>b.x===food.x&&b.y===food.y))};place();
  const turn=d=>{if(d.x!==-dir.x||d.y!==-dir.y)next=d};
  return {
   update(dt,keys){if(keys.ArrowUp||keys.w)turn({x:0,y:-1});if(keys.ArrowDown||keys.s)turn({x:0,y:1});if(keys.ArrowLeft||keys.a)turn({x:-1,y:0});if(keys.ArrowRight||keys.d)turn({x:1,y:0});
    step-=dt;if(step>0)return;step=Math.max(.06,.14-body.length*.002);dir=next;
    const h={x:body[0].x+dir.x,y:body[0].y+dir.y};
    if(h.x<0||h.y<0||h.x>=CW||h.y>=CH||body.some(b=>b.x===h.x&&b.y===h.y))return api.over();
    body.unshift(h);if(h.x===food.x&&h.y===food.y){api.add(1);place()}else body.pop()},
   draw(c){for(let i=body.length-1;i>0;i--)rr(c,body[i].x*S+3,body[i].y*S+3,S-6,S-6,7,i%2?'#7FCC0C':LIME);
    c.drawImage(MASCOT,body[0].x*S-3,body[0].y*S-3,S+6,S+4);can(c,food.x*S+S/2,food.y*S+S/2,.8)}
  };
 };
 // ── 5 · Полёт: flap between the server racks
 const flyGame=api=>{
  let y=H/2,vy=0,racks=[],spawn=0,t=0;const flap=()=>{vy=-330};
  return {
   update(dt,keys){t+=dt;if(keys[' ']||keys.ArrowUp||keys.w){if(!this.held)flap();this.held=true}else this.held=false;
    vy+=980*dt;y+=vy*dt;spawn-=dt;if(spawn<=0){spawn=1.55;const gap=Math.max(120,170-t*1.5);racks.push({x:W+40,gy:rnd(70,H-70-gap),gap,passed:false})}
    for(const r of racks){r.x-=190*dt;if(!r.passed&&r.x+60<120){r.passed=true;api.add(1)}}racks=racks.filter(r=>r.x>-80);
    const me={x:104,y:y-16,w:34,h:32};if(y<0||y>H)api.over();
    for(const r of racks)if(hit(me,{x:r.x,y:0,w:60,h:r.gy})||hit(me,{x:r.x,y:r.gy+r.gap,w:60,h:H}))api.over()},
   draw(c){for(const r of racks){for(const [ty,th] of [[0,r.gy],[r.gy+r.gap,H-r.gy-r.gap]]){rr(c,r.x,ty,60,th,8,'#1E1E1C');for(let k=ty+12;k<ty+th-10;k+=18)rr(c,r.x+10,k,40,6,3,k%36<18?BLUE:'#2E2E2B')}}
    c.save();c.translate(122,y);c.rotate(Math.max(-.5,Math.min(.6,vy/700)));c.drawImage(MASCOT,-22,-21,44,42);c.restore()},
   click:flap
  };
 };
 const GAMES=[
  {id:'catch',title:'Энергетики',make:catchGame,hint:'← → или мышь: лови банки 1SHOT, розовые баги — минус жизнь'},
  {id:'run',title:'Пробежка',make:runGame,hint:'Пробел, ↑ или клик: прыгай через стулья'},
  {id:'whack',title:'Где маскот?',make:whackGame,hint:'Кликай по маскоту на мониторах. ERROR — минус 2. 30 секунд'},
  {id:'snake',title:'Змейка',make:snakeGame,hint:'Стрелки или WASD: собирай банки, не врезайся'},
  {id:'fly',title:'Полёт',make:flyGame,hint:'Пробел, ↑ или клик: пролетай между серверными стойками'}
 ];

 // ── The arcade overlay
 const box=document.createElement('div');box.id='arcade';box.hidden=true;
 box.innerHTML=`<div class="arcade-box" role="dialog" aria-label="Аркада 1SHOT">
  <header><b>Аркада 1SHOT</b><span>секретный раздел · Esc — выйти</span><button type="button" class="arcade-x" aria-label="Закрыть">×</button></header>
  <div class="arcade-menu"></div>
  <div class="arcade-stage" hidden>
   <div class="arcade-hud"><b class="arcade-title"></b><span class="arcade-score"></span><span class="arcade-best"></span><span class="arcade-time"></span>
    <button type="button" class="arcade-again">Заново</button><button type="button" class="arcade-back">Все игры</button></div>
   <canvas width="${W}" height="${H}"></canvas><p class="arcade-hint"></p>
  </div></div>`;
 document.body.append(box);
 const $a=s=>box.querySelector(s),canvas=$a('canvas'),ctx=canvas.getContext('2d');
 const menu=$a('.arcade-menu');
 for(const g of GAMES){const b=document.createElement('button');b.type='button';b.className='arcade-tile';b.innerHTML=`<img alt=""><b></b><small></small>`;b.querySelector('img').src=MASCOT.src;b.querySelector('b').textContent=g.title;b.dataset.id=g.id;b.onclick=()=>start(g);menu.append(b)}
 const refreshBest=()=>menu.querySelectorAll('.arcade-tile').forEach(b=>{const v=best(b.dataset.id);b.querySelector('small').textContent=v?'рекорд '+v:'ещё не играли'});
 let game=null,cur=null,score=0,over=false,raf=0,last=0,keys={},flashT=0,flashC=PINK,timeLeft=null;
 const api={add:n=>{score=Math.max(0,score+n)},set:n=>{score=n},over:()=>{if(over)return;over=true;saveBest(cur.id,score)},flash:c=>{flashT=.25;flashC=c},timer:s=>{timeLeft=s}};
 function start(g){cur=g;score=0;over=false;timeLeft=null;keys={};game=g.make(api);$a('.arcade-menu').hidden=true;$a('.arcade-stage').hidden=false;
  $a('.arcade-title').textContent=g.title;$a('.arcade-hint').textContent=g.hint;last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(loop)}
 function toMenu(){cancelAnimationFrame(raf);game=null;$a('.arcade-stage').hidden=true;$a('.arcade-menu').hidden=false;refreshBest()}
 function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;
  if(!over)game.update.call(game,dt,keys);
  ctx.fillStyle=BG;ctx.fillRect(0,0,W,H);
  for(let i=0;i<W;i+=40)for(let j=0;j<H;j+=40){ctx.fillStyle='#151514';ctx.fillRect(i,j,1,1)}
  game.draw(ctx);
  if(flashT>0){flashT-=dt;ctx.fillStyle=flashC;ctx.globalAlpha=Math.max(0,flashT)*1.2;ctx.fillRect(0,0,W,H);ctx.globalAlpha=1}
  if(over){ctx.fillStyle='rgba(10,10,10,.78)';ctx.fillRect(0,0,W,H);ctx.drawImage(score>=best(cur.id)&&score>0?MASCOT:MASCOT_PINK,W/2-40,H/2-120,80,76);
   text(ctx,score>=best(cur.id)&&score>0?'Новый рекорд!':'Игра окончена',W/2,H/2-12,30,INK);text(ctx,'Счёт: '+score,W/2,H/2+28,20,LIME);text(ctx,'Пробел или «Заново» — ещё раз',W/2,H/2+64,14,'#A3A39B')}
  $a('.arcade-score').textContent='Счёт '+score;$a('.arcade-best').textContent='Рекорд '+Math.max(best(cur.id),over?score:0);$a('.arcade-time').textContent=timeLeft!=null?timeLeft+' с':'';
  raf=requestAnimationFrame(loop)}
 const pos=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*W/r.width,(e.clientY-r.top)*H/r.height]};
 canvas.addEventListener('mousemove',e=>{if(game?.move&&!over)game.move(...pos(e))});
 canvas.addEventListener('mousedown',e=>{if(over)return;if(game?.click)game.click(...pos(e))});
 function onKey(e){if(box.hidden)return;
  if(e.key==='Escape'){e.preventDefault();close();return}
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(k)){e.preventDefault();
   if(e.type==='keydown'&&over&&k===' '&&cur){start(cur);return}keys[k]=e.type==='keydown'}}
 function open(){box.hidden=false;refreshBest();toMenu();addEventListener('keydown',onKey);addEventListener('keyup',onKey)}
 function close(){toMenu();box.hidden=true;removeEventListener('keydown',onKey);removeEventListener('keyup',onKey)}
 $a('.arcade-x').onclick=close;$a('.arcade-back').onclick=toMenu;$a('.arcade-again').onclick=()=>cur&&start(cur);
 box.addEventListener('mousedown',e=>{if(e.target===box)close()});
 // ── The secret door: a faint mascot at the very bottom of Settings, five taps within four seconds
 const settings=document.getElementById('panel-sound');
 if(settings){const egg=document.createElement('button');egg.type='button';egg.className='arcade-egg';egg.setAttribute('aria-label','1SHOT');egg.innerHTML=`<img alt="">`;egg.querySelector('img').src=MASCOT.src;
  let taps=[];egg.onclick=()=>{const now=Date.now();taps=taps.filter(t=>now-t<4000);taps.push(now);egg.classList.remove('wink');void egg.offsetWidth;egg.classList.add('wink');if(taps.length>=5){taps=[];open()}};
  settings.append(egg)}
 window.openArcade=open;
})();
