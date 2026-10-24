/* 1SHOT loader: a small mascot on top keeps changing faces, the 1SHOT logo below fills from left to right.
   No bar and no percentage. Used by the start screen, the connecting overlay and Desk. */
(()=>{
 const LOGO='M478.042 17.5467V52.4814H440.879V61.4825H478.042V127.032H487.105V61.4825H521.737V52.478H487.105V17.5502L478.042 17.5467ZM97.1209 52.4814H50.0112V61.4825H125.311V77.1869L103.824 108.092V72.4431H94.7577V136.975L134.371 79.9952V52.4814H108.213L125.307 28.397V41.7347H134.371V0.00345001L97.1209 52.478V52.4814ZM263.77 52.4814H230.108V17.5502H221.045V52.4814H156.306V61.4825H221.045V127.032H230.108V61.4825H263.77V127.032H272.829V17.5536H263.773V52.4849L263.77 52.4814ZM346.594 0L346.58 52.4814H296.165V61.4859H346.58L346.573 79.3259L386.283 137.11V61.4859H410.954V52.4814H383.823L346.594 0ZM355.64 76.5486L355.65 28.397L372.735 52.4814H365.814V61.4859H377.22V107.957L355.64 76.5486ZM14.3692 17.5502V52.4814H0V61.4859H14.3692V118.031H0V127.036H37.7982V118.031H23.4324V17.5536H14.3692V17.5502Z';
 const MASCOT='<svg class="ol-mascot" viewBox="-1 -1 47 45" aria-hidden="true"><g class="olm-ears"><polygon points="4.62219,10.7343 4.0874,16.197 9.32084,8.74788 9.32084,12.7971 12.0713,12.7971 12.0713,0 4.62219,10.7343"/><polygon points="0,17.4576 0,22.309 2.75043,22.309 2.82684,18.9474 6.26485,18.9474 6.26485,16.2352 4.08744,16.197 4.62223,10.7344 0,17.4576"/><polygon points="33.6545,16.197 37.0162,16.197 42.2497,8.74788 42.2497,12.8353 45,12.8353 45,0 33.6545,16.197"/></g><g class="olm-face"><polygon points="2.75043,33.3106 2.75043,22.309 0,22.309 0,42.1732 12.0713,24.6393 12.0713,12.7971 9.32088,12.7971 9.32088,23.7988 2.75043,33.3106"/><polygon points="35.6793,33.3107 35.6793,22.309 32.929,22.309 32.929,42.1733 44.962,24.6393 44.962,16.197 38.7353,16.197 38.7353,18.9474 42.2498,18.9474 42.2498,23.7988 35.6793,33.3107"/><polygon points="26.7404,28.3445 26.7404,18.1833 24.1045,18.1833 24.1045,28.3445 26.7404,28.3445"/><polygon points="24.1044,25.6707 20.0552,25.6707 20.0552,28.3446 24.1044,28.3446 24.1044,25.6707"/></g><g class="olm-eyes"><g class="olm-eye-l"><polygon points="23.3114,15 18.3187,15 17.4082,15 16,15 16,17.7122 20.6374,17.7122 23.3114,17.7122 23.3114,15"/></g><g class="olm-eye-r"><polygon points="35.3114,15 30.3187,15 29.4082,15 28,15 28,17.7122 32.6374,17.7122 35.3114,17.7122 35.3114,15"/></g></g><g class="olm-mouth"><polygon points="25.4032,32.9495 20.4105,32.9495 19.5,32.9495 18.0918,32.9495 18.0918,35.6616 22.7292,35.6616 25.4032,35.6616 25.4032,32.9495"/></g></svg>';
 // Styles live here so the mini-app and Desk look the same.
 if(!document.getElementById('ol-style')){const s=document.createElement('style');s.id='ol-style';s.textContent=`
.oneshot-loader{display:flex;flex-direction:column;align-items:center;gap:18px;width:min(56vw,230px)}
.oneshot-loader .ol-mascot{width:20%;height:auto;overflow:visible;fill:#fff;stroke:#fff;stroke-width:.12;animation:olm-bob 1.6s ease-in-out infinite}
.oneshot-loader .ol-mascot g{transform-box:fill-box;transition:transform .18s ease}
.oneshot-loader .olm-eyes g,.oneshot-loader .olm-mouth{transform-origin:center}
.oneshot-loader[data-face=blink] .olm-eyes g{transform:scaleY(.12)}
.oneshot-loader[data-face=left] .olm-eyes g{transform:translateX(-35%)}
.oneshot-loader[data-face=right] .olm-eyes g{transform:translateX(35%)}
.oneshot-loader[data-face=wink] .olm-eye-r{transform:scaleY(.12)}
.oneshot-loader[data-face=wink] .olm-mouth{transform:scaleX(1.35)}
.oneshot-loader[data-face=wow] .olm-mouth{transform:scale(.7,2.2)}
.oneshot-loader[data-face=ears] .ol-mascot{rotate:-6deg}
.oneshot-loader .ol-mascot{transition:rotate .25s ease}
.oneshot-loader .ol-logo{width:100%;height:auto;overflow:visible}
.oneshot-loader .ol-base{fill:#1d1d1d}.oneshot-loader .ol-fill{fill:#fff}.oneshot-loader .ol-edge{display:none}
.oneshot-loader .ol-caption{margin:0;font:600 10px Unbounded,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9a9a9a;text-align:center}
.oneshot-loader .ol-sub{margin:0;text-align:center;font:500 11px/1.6 Unbounded,sans-serif;color:#cfcfcf}
.oneshot-loader .ol-caption:empty,.oneshot-loader .ol-sub:empty{display:none}
@keyframes olm-bob{50%{transform:translateY(-5%)}}
.oneshot-loader .ol-stage{position:relative;width:100%}
.oneshot-loader .ol-rider{position:absolute;top:50%;left:-12%;width:30%;transform:translate(-50%,-50%) rotate(7deg);transition:opacity .35s ease;pointer-events:none}
.oneshot-loader .ol-rider .ol-mascot{width:100%;animation:olm-drive .28s ease-in-out infinite alternate}
.oneshot-loader.ol-done .ol-rider{opacity:0}
@keyframes olm-drive{to{transform:translateY(-6%)}}
@media(prefers-reduced-motion:reduce){.oneshot-loader .ol-mascot{animation:none}}`;document.head.append(s)}
 const FACES=['','blink','left','right','','wink','ears','wow',''];
 let seq=0;
 function build(host,{caption='',sub='',ride=false}={}){
  const id='ol'+(++seq);
  host.insertAdjacentHTML('beforeend',`<div class="oneshot-loader" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${caption||'Загрузка 1SHOT'}">
   ${ride?'<div class="ol-stage">':MASCOT}<svg class="ol-logo" viewBox="0 0 522 138" aria-hidden="true"><defs><clipPath id="${id}"><rect class="ol-clip" x="0" y="-4" width="522" height="146"/></clipPath></defs>
    <path class="ol-base" fill-rule="evenodd" d="${LOGO}"/><path class="ol-fill" fill-rule="evenodd" d="${LOGO}" clip-path="url(#${id})"/><rect class="ol-edge" x="0" y="-4" width="3" height="146"/></svg>
   ${ride?'<div class="ol-rider">'+MASCOT+'</div></div>':''}<p class="ol-caption">${caption}</p><p class="ol-sub">${sub}</p></div>`);
  const el=host.lastElementChild,clip=el.querySelector('.ol-clip'),edge=el.querySelector('.ol-edge'),rider=el.querySelector('.ol-rider');
  let raf=0,value=0,face=0,faces=0;
  // The mascot keeps changing faces while the loader is on screen.
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const faceStep=()=>{face=(face+1)%FACES.length;if(FACES[face])el.dataset.face=FACES[face];else delete el.dataset.face};
  const startFaces=()=>{if(!faces&&!reduce)faces=setInterval(faceStep,520)};
  const stopFaces=()=>{clearInterval(faces);faces=0;delete el.dataset.face};
  const set=v=>{value=Math.max(0,Math.min(1,v));const w=522*value;clip.setAttribute('width',w.toFixed(1));edge.setAttribute('x',(w-1.5).toFixed(1));edge.style.opacity=value>0&&value<1?1:0;
   // Splash: the mascot drives across and the logo appears right behind it, then it leaves on the right.
   if(rider){rider.style.left=(value*124-12).toFixed(1)+'%';el.classList.toggle('ol-done',value>=1)}
   el.setAttribute('aria-valuenow',Math.round(value*100))};
  const ease=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const tween=(from,to,ms,done)=>{cancelAnimationFrame(raf);clearTimeout(raf);const t0=performance.now();const step=now=>{const k=Math.min(1,(now-t0)/ms);set(from+(to-from)*ease(k));if(k<1)raf=requestAnimationFrame(step);else done?.()};raf=requestAnimationFrame(step)};
  set(0);
  return {el,set,
   run(ms,done){startFaces();tween(0,1,ms,done)},
   /* Indeterminate: creeps toward 90 % and never reaches 100 until finish(). */
   loop(){startFaces();cancelAnimationFrame(raf);const t0=performance.now();const step=now=>{const s=(now-t0)/1000;set(.9*(1-Math.exp(-s/4.5)));raf=requestAnimationFrame(step)};raf=requestAnimationFrame(step)},
   /* Endless: fills, holds for a beat, starts again. */
   cycle(ms=1700){startFaces();const again=()=>tween(0,1,ms,()=>{raf=setTimeout(again,380)});clearTimeout(raf);again()},
   finish(done){tween(value,1,420,()=>{stopFaces();done?.()})},
   stop(){cancelAnimationFrame(raf);clearTimeout(raf);stopFaces()},
   text(caption,sub){if(caption!=null)el.querySelector('.ol-caption').textContent=caption;if(sub!=null)el.querySelector('.ol-sub').textContent=sub}};
 }
 /* Full-screen dimmed overlay for long actions (connecting a session). */
 let overlay=null,loader=null;
 function show(caption,sub){
  if(!overlay){overlay=document.createElement('div');overlay.id='oneshot-overlay';overlay.setAttribute('aria-live','polite');document.body.append(overlay);loader=build(overlay)}
  loader.text(caption,sub);loader.set(0);overlay.hidden=false;requestAnimationFrame(()=>overlay.classList.add('open'));loader.loop();
 }
 function hide(complete=true){
  if(!overlay||overlay.hidden)return;
  const close=()=>{overlay.classList.remove('open');setTimeout(()=>{if(!overlay.classList.contains('open'))overlay.hidden=true;loader.stop()},320)};
  complete?loader.finish(()=>setTimeout(close,160)):close();
 }
 const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 window.oneshotLoader={build,show,hide,isOpen:()=>!!overlay&&!overlay.hidden,reduce};
})();
