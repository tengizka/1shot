/* 1SHOT loader: the logo fills from left to right with a lime edge and a percentage.
   Used by the start screen (fixed length) and while a PC session connects (loops until done). */
(()=>{
 const LOGO='M478.042 17.5467V52.4814H440.879V61.4825H478.042V127.032H487.105V61.4825H521.737V52.478H487.105V17.5502L478.042 17.5467ZM97.1209 52.4814H50.0112V61.4825H125.311V77.1869L103.824 108.092V72.4431H94.7577V136.975L134.371 79.9952V52.4814H108.213L125.307 28.397V41.7347H134.371V0.00345001L97.1209 52.478V52.4814ZM263.77 52.4814H230.108V17.5502H221.045V52.4814H156.306V61.4825H221.045V127.032H230.108V61.4825H263.77V127.032H272.829V17.5536H263.773V52.4849L263.77 52.4814ZM346.594 0L346.58 52.4814H296.165V61.4859H346.58L346.573 79.3259L386.283 137.11V61.4859H410.954V52.4814H383.823L346.594 0ZM355.64 76.5486L355.65 28.397L372.735 52.4814H365.814V61.4859H377.22V107.957L355.64 76.5486ZM14.3692 17.5502V52.4814H0V61.4859H14.3692V118.031H0V127.036H37.7982V118.031H23.4324V17.5536H14.3692V17.5502Z';
 let seq=0;
 function build(host,{caption='',sub=''}={}){
  const id='ol'+(++seq);
  host.insertAdjacentHTML('beforeend',`<div class="oneshot-loader" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${caption||'Загрузка 1SHOT'}">
   <svg class="ol-logo" viewBox="0 0 522 138" aria-hidden="true"><defs><clipPath id="${id}"><rect class="ol-clip" x="0" y="-4" width="522" height="146"/></clipPath></defs>
    <path class="ol-base" fill-rule="evenodd" d="${LOGO}"/><path class="ol-fill" fill-rule="evenodd" d="${LOGO}" clip-path="url(#${id})"/><rect class="ol-edge" x="0" y="-4" width="3" height="146"/></svg>
   <div class="ol-meta"><span class="ol-caption">${caption}</span><span class="ol-pct">000</span></div>
   <div class="ol-bar"><i></i></div><p class="ol-sub">${sub}</p></div>`);
  const el=host.lastElementChild,clip=el.querySelector('.ol-clip'),edge=el.querySelector('.ol-edge'),pct=el.querySelector('.ol-pct'),bar=el.querySelector('.ol-bar i');
  let raf=0,value=0;
  const set=v=>{value=Math.max(0,Math.min(1,v));const w=522*value;clip.setAttribute('width',w.toFixed(1));edge.setAttribute('x',(w-1.5).toFixed(1));edge.style.opacity=value>0&&value<1?1:0;
   bar.style.transform=`scaleX(${value})`;const n=Math.round(value*100);pct.textContent=String(n).padStart(3,'0');el.setAttribute('aria-valuenow',n)};
  const ease=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const tween=(from,to,ms,done)=>{cancelAnimationFrame(raf);clearTimeout(raf);const t0=performance.now();const step=now=>{const k=Math.min(1,(now-t0)/ms);set(from+(to-from)*ease(k));if(k<1)raf=requestAnimationFrame(step);else done?.()};raf=requestAnimationFrame(step)};
  set(0);
  return {el,set,
   run(ms,done){tween(0,1,ms,done)},
   /* Indeterminate: creeps toward 90 % and never reaches 100 until finish(). */
   loop(){cancelAnimationFrame(raf);const t0=performance.now();const step=now=>{const s=(now-t0)/1000;set(.9*(1-Math.exp(-s/4.5)));raf=requestAnimationFrame(step)};raf=requestAnimationFrame(step)},
   /* Endless: fills, holds for a beat, starts again. */
   cycle(ms=1700){const again=()=>tween(0,1,ms,()=>{raf=setTimeout(again,380)});clearTimeout(raf);again()},
   finish(done){tween(value,1,420,done)},
   stop(){cancelAnimationFrame(raf);clearTimeout(raf)},
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
