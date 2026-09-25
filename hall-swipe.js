/* Pointer gestures only; never scroll/zoom the hall or synthesize a booking click. */
(() => {
 const viewport=document.getElementById('seat-viewport'),map=document.getElementById('floor-map');
 if(!viewport||!map)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let drag=null,animations=[],ghost=null,generation=0,suppressUntil=0;
 function clearMotion(){
  generation++;animations.forEach(a=>a.cancel());animations=[];ghost?.remove();ghost=null;
  map.style.transform='';viewport.classList.remove('is-moving','is-dragging');
 }
 function releasePointer(id){if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}
 function cancel(){const pointer=drag?.id;drag=null;if(pointer!==undefined)releasePointer(pointer);clearMotion()}
 function animateChange(update,direction,offset=0){
  cancel();
  if(reduced.matches||!map.getBoundingClientRect().width){update();return}
  const width=viewport.clientWidth;
  ghost=map.cloneNode(true);ghost.removeAttribute('id');ghost.classList.add('hall-page-ghost');
  ghost.setAttribute('aria-hidden','true');ghost.inert=true;
  ghost.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
  ghost.querySelectorAll('.map-pc').forEach(e=>{e.classList.replace('map-pc','seat-preview');e.removeAttribute('data-hid');e.tabIndex=-1});
  update();viewport.append(ghost);viewport.classList.add('is-moving');
  const epoch=generation,options={duration:260,easing:'cubic-bezier(.22,.8,.25,1)',fill:'both'};
  animations=[
   ghost.animate([{transform:`translateX(${offset}px)`},{transform:`translateX(${-direction*width}px)`}],options),
   map.animate([{transform:`translateX(${direction*width+offset}px)`},{transform:'translateX(0)'}],options)
  ];
  Promise.all(animations.map(a=>a.finished)).then(()=>{if(epoch===generation)clearMotion()},()=>{});
 }
 function settle(offset){
  clearMotion();if(reduced.matches||!offset)return;
  const epoch=generation;viewport.classList.add('is-moving');
  const animation=map.animate([{transform:`translateX(${offset}px)`},{transform:'translateX(0)'}],{duration:180,easing:'ease-out',fill:'both'});
  animations=[animation];animation.finished.then(()=>{if(epoch===generation)clearMotion()},()=>{});
 }
 window.hallMotion={change:animateChange,cancel};
 viewport.addEventListener('pointerdown',e=>{
  if(document.querySelector('dialog[open],.booking-sheet.open'))return;
  if(!e.isPrimary){cancel();return}
  if(e.button!==0||viewport.classList.contains('is-moving'))return;
  suppressUntil=0;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,offset:0,started:performance.now(),horizontal:false};
 });
 viewport.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.horizontal){
   if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){drag=null;return}
   if(Math.abs(dx)<10||Math.abs(dx)<Math.abs(dy)*1.25)return;
   drag.horizontal=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('is-dragging');
  }
  if(e.cancelable)e.preventDefault();
  suppressUntil=performance.now()+600;
  drag.dx=dx;
  const target=hallPageIndex()+(dx<0?1:-1),edge=target<0||target>=hallPages().length;
  drag.offset=Math.max(-viewport.clientWidth,Math.min(viewport.clientWidth,dx))*(edge ? 0.18 : 1);
  // Reduced-motion users can still swipe but the seats remain stationary.
  if(!reduced.matches)map.style.transform=`translateX(${drag.offset}px)`;
 },{passive:false});
 function end(e,cancelled=false){
  if(!drag||drag.id!==e.pointerId)return;
  const current=drag;drag=null;releasePointer(e.pointerId);viewport.classList.remove('is-dragging');
  if(!current.horizontal)return;
  suppressUntil=performance.now()+600;
  const distance=Math.abs(current.dx),speed=distance/Math.max(1,performance.now()-current.started);
  const enough=distance>=Math.min(90,viewport.clientWidth*.2)||(distance>=32&&speed>.5);
  if(!cancelled&&enough&&goToHallPage(hallPageIndex()+(current.dx<0?1:-1),current.offset))return;
  settle(current.offset);
 }
 viewport.addEventListener('pointerup',e=>end(e));
 viewport.addEventListener('pointercancel',e=>end(e,true));
 viewport.addEventListener('lostpointercapture',e=>{if(e.target===viewport&&drag?.id===e.pointerId)end(e,true)});
 viewport.addEventListener('click',e=>{
  if(performance.now()<suppressUntil||viewport.classList.contains('is-moving')){e.preventDefault();e.stopImmediatePropagation()}
 },true);
 addEventListener('resize',cancel);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
 reduced.addEventListener('change',cancel);
})();
