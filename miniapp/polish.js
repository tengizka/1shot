/* Lightweight native scroll-snap wheels and an opt-in logo easter egg. */
(() => {
 const hands=[
  ['M30 133 17 108 12 70 22 60 34 70V21L43 9h9l8 12v45l9-8 12 7 10-3 10 12-6 39-17 20Z','M34 70 37 98 60 108m0-42v24m19-25-2 26M26 119h60M41 24h12'],
  ['M27 130 14 100V69l10-10 11 11V15L46 4l12 11v48l13-6 11 12 11-2 10 13-11 40-16 12Z','M35 70v25l23 11m0-43v27m24-21-4 24M25 115l57-2M41 22h11M44 28v22'],
  ['M28 134 13 109V72h12v-9h12V14h8V5h12v9h8v49h13v9h13v10h12v30H91v22Z','M37 72v28h27V72m14 10v20M24 120h67M44 25h12m-12 8h12'],
  ['M28 132Q12 116 13 95V72q0-16 13-11l10 10V20q0-20 13-17 12 2 12 17v45q10-13 19 0 15-10 21 7l-7 43q-6 18-22 19Z','M36 71v23q0 12 23 14m2-43v28m19-28-3 28M27 120h56M43 20q6-5 11 0'],
  ['M29 132 15 111 12 75 23 61 34 72 38 16 47 4 56 15 60 69 71 60 81 68 92 65 102 78 93 115 76 133Z','M38 27h17M37 37h20M36 48h22M35 58h24M34 72l5 25 19 10m2-38v22m21-23-4 24M25 117l57 2'],
  ['M27 132 12 102 14 72 24 60 34 72V22L41 9 50 4 60 19v47l12-8 10 9 11-3 10 12-9 39-18 18Z','M34 72 38 94 57 107m3-41v26m22-25-6 27M23 117h62M41 25l13-5M19 87l7 12M65 110l8-9']
 ];
 const occupiedLines=['Прости, но он занят..','Этот ПК уже в катке.','Здесь уже кто-то тащит.','Этот трон временно занят.','ПК занят. Не мешаем легенде.','Тут уже идёт игра.','Занято. Твой MVP — рядом.','У этого ПК уже есть дуо.'];
 const occupiedActions=['Выберу другой','Посмотрю рядом','Не отвлекаем','Пойду дальше','Ладно, другой ПК','Мой ещё найдётся','Ищу свой трон','Окей, принято'];
 let lastLine=-1,lastAction=-1;const next=(n,old)=>old<0?Math.floor(Math.random()*n):(old+1+Math.floor(Math.random()*(n-1)))%n;
 let handIndex=Math.floor(Math.random()*hands.length);
 window.showOccupied=()=>{
  let box=document.getElementById('occupied-dialog');
  if(!box){box=document.createElement('dialog');box.id='occupied-dialog';box.className='occupied-dialog';box.innerHTML='<div class="occupied-art"></div><p>Прости, но он занят..</p><button class="btn-main" autofocus>Другой ПК</button>';box.querySelector('button').onclick=()=>box.close();document.body.append(box)}
  handIndex=(handIndex+1)%hands.length;const hand=hands[handIndex];box.dataset.variant=String(handIndex);
  box.querySelector('.occupied-art').innerHTML='<svg viewBox="0 0 110 145" aria-hidden="true"><path d="'+hand[0]+'"/><path d="'+hand[1]+'"/></svg>';
  lastLine=next(occupiedLines.length,lastLine);lastAction=next(occupiedActions.length,lastAction);box.querySelector('p').textContent=occupiedLines[lastLine];box.querySelector('button').textContent=occupiedActions[lastAction];
  window.hallMotion?.cancel();if(!box.open)box.showModal();
 };
 const logoShape='M478.042 17.5467V52.4814H440.879V61.4825H478.042V127.032H487.105V61.4825H521.737V52.478H487.105V17.5502L478.042 17.5467ZM97.1209 52.4814H50.0112V61.4825H125.311V77.1869L103.824 108.092V72.4431H94.7577V136.975L134.371 79.9952V52.4814H108.213L125.307 28.397V41.7347H134.371V0.00345001L97.1209 52.478V52.4814ZM263.77 52.4814H230.108V17.5502H221.045V52.4814H156.306V61.4825H221.045V127.032H230.108V61.4825H263.77V127.032H272.829V17.5536H263.773V52.4849L263.77 52.4814ZM346.594 0L346.58 52.4814H296.165V61.4859H346.58L346.573 79.3259L386.283 137.11V61.4859H410.954V52.4814H383.823L346.594 0ZM355.64 76.5486L355.65 28.397L372.735 52.4814H365.814V61.4859H377.22V107.957L355.64 76.5486ZM14.3692 17.5502V52.4814H0V61.4859H14.3692V118.031H0V127.036H37.7982V118.031H23.4324V17.5536H14.3692V17.5502Z';
 const ns='http://www.w3.org/2000/svg';let logoId=0;
 document.querySelectorAll('.header-logo,.auth-logo,.brand-logo').forEach(original=>{
  let logo=original;if(original.tagName.toLowerCase()==='img'){logo=document.createElementNS(ns,'svg');logo.setAttribute('class',original.className);original.replaceWith(logo)}
  logo.setAttribute('viewBox','0 0 522 138');logo.replaceChildren();
  logo.setAttribute('tabindex','0');logo.setAttribute('role','button');logo.setAttribute('aria-label','1SHOT — анимация букв');
  const defs=document.createElementNS(ns,'defs');logo.append(defs);const parts=[],edges=[0,45,145,283,425,522],id=++logoId;
  for(let i=0;i<5;i++){const clip=document.createElementNS(ns,'clipPath');clip.setAttribute('clipPathUnits','userSpaceOnUse');clip.id='letter-'+id+'-'+i;const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',edges[i]);rect.setAttribute('width',edges[i+1]-edges[i]);rect.setAttribute('height','138');clip.append(rect);defs.append(clip);const group=document.createElementNS(ns,'g');group.classList.add('logo-letter');group.setAttribute('clip-path','url(#'+clip.id+')');const path=document.createElementNS(ns,'path');path.setAttribute('d',logoShape);path.setAttribute('fill','white');path.setAttribute('fill-rule','evenodd');group.append(path);logo.append(group);parts.push(group)}
  let playing=false;
  const play=()=>{if(playing)return;playing=true;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   const animations=parts.map((part,i)=>part.animate([{opacity:1},{opacity:.2,offset:.3},{opacity:1,offset:.65},{opacity:.65,offset:.8},{opacity:1}],{duration:reduced?180:1100,delay:reduced?0:i*120,easing:'ease-in-out'}));
   Promise.all(animations.map(a=>a.finished.catch(()=>{}))).then(()=>playing=false);
  };
  logo.addEventListener('click',play);logo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();play()}});
 });
 const trigger=document.getElementById('birthday-open');if(!trigger)return;
 const now=new Date(),parts=[1,1,now.getFullYear()-18];
 const dialog=document.createElement('dialog');dialog.className='birthday-dialog';dialog.innerHTML='<h3>Дата рождения</h3><div class="birth-wheels"></div><p id="birth-error" role="status"></p><button type="button" class="btn-main">Выбрать дату</button>';document.body.append(dialog);
 const wheels=[];
 function build(i){const el=wheels[i];el.replaceChildren();const min=i===2?now.getFullYear()-110:1,max=i===2?now.getFullYear():i===1?12:new Date(parts[2],parts[1],0).getDate();parts[i]=Math.min(max,Math.max(min,parts[i]));for(let n=min;n<=max;n++){const b=document.createElement('button');b.type='button';b.textContent=String(n).padStart(2,'0');b.setAttribute('role','option');b.onclick=()=>el.scrollTo({top:(n-min)*44,behavior:'smooth'});el.append(b)}el.dataset.min=min;requestAnimationFrame(()=>{el.scrollTop=(parts[i]-min)*44;mark(i)})}
 function mark(i){[...wheels[i].children].forEach((e,n)=>e.setAttribute('aria-selected',String(n+Number(wheels[i].dataset.min)===parts[i])))}
 function select(i){const el=wheels[i],n=Number(el.dataset.min)+Math.round(el.scrollTop/44);if(n===parts[i])return;parts[i]=Math.min(Number(el.dataset.min)+el.children.length-1,Math.max(Number(el.dataset.min),n));mark(i);if(i!==0)build(0)}
 for(let i=0;i<3;i++){const el=document.createElement('div');el.className='birth-wheel';el.setAttribute('role','listbox');el.setAttribute('aria-label',['День','Месяц','Год'][i]);el.tabIndex=0;wheels.push(el);dialog.querySelector('.birth-wheels').append(el);let timer;el.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>select(i),90)});el.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();el.scrollTop+=(e.key==='ArrowDown'?44:-44);select(i)}})}
 trigger.onclick=()=>{dialog.showModal();wheels.forEach((_,i)=>build(i))};
 dialog.querySelector('.btn-main').onclick=()=>{wheels.forEach((_,i)=>select(i));const date=parts[2]+'-'+String(parts[1]).padStart(2,'0')+'-'+String(parts[0]).padStart(2,'0');if(new Date(date)>now){dialog.querySelector('#birth-error').textContent='Выберите прошедшую дату';return}document.getElementById('r-birth').value=date;trigger.textContent=parts[0]+'.'+String(parts[1]).padStart(2,'0')+'.'+parts[2];dialog.close()};
})();
