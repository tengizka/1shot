/* Queue for a busy PC. The server keeps it (one guest per PC, one PC per guest): when the PC frees up and stays free
   for a few minutes, the guest gets an ordinary booking and a note from the bot, even with the app closed.
   Here: joining from the «busy PC» dialog, and the bar above the bottom menu with the time left and a cancel cross.
   The green notice that confirms joining glides down and becomes that bar. */
(()=>{
 const tg=window.Telegram?.WebApp;
 try{localStorage.removeItem('1shot_queue')}catch{}  // the old queue lived only on the phone
 const pc=id=>String(id)==='1'?'PS5':'ПК '+id;
 const left=iso=>{const end=Date.parse(iso||'');if(!Number.isFinite(end))return '';const m=Math.ceil((end-Date.now())/60000);
  if(m<=0)return 'вот-вот освободится';return 'освободится через '+(m>=60?Math.floor(m/60)+'h'+(m%60?' '+m%60+'m':''):m+'m')};
 const call=(action,data={})=>apiFetch(`${SUPA}/club-bookings`,{method:'POST',body:JSON.stringify({action,initData:tg?.initData||'',...data})});
 let current=null,bar=null,busy=false;

 function build(){
  bar=document.createElement('div');bar.id='queue-bar';bar.className='queue-bar';bar.setAttribute('role','status');
  bar.innerHTML='<span class="queue-text"><b></b><small></small></span><button type="button" class="queue-x" aria-label="Выйти из очереди"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  bar.querySelector('.queue-x').onclick=leave;
  document.body.append(bar);
 }
 function dock(){const nav=document.querySelector('#app.active .bottom-nav');bar.style.bottom=((nav?.offsetHeight||0)+10)+'px'}
 function paint(){
  if(!current){bar?.remove();bar=null;return}
  if(!bar){build();dock();bar.classList.add('docked')}
  bar.querySelector('b').textContent='Ты в очереди за '+pc(current.host_id);
  bar.querySelector('small').textContent=left(current.free_at)||'ждём, когда освободится';
 }
 // The confirmation: a green notice at the top that slides down into the bar.
 function arrive(){
  if(!bar)build();dock();paint();
  const end=bar.getBoundingClientRect();
  bar.classList.remove('docked');bar.classList.add('arriving');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){bar.classList.remove('arriving');bar.classList.add('docked');return}
  const startTop=Math.max(12,(window.Telegram?.WebApp?.contentSafeAreaInset?.top||0)+12);
  bar.animate([{transform:`translateY(${startTop-end.top}px)`,offset:0},{transform:`translateY(${startTop-end.top}px)`,offset:.35},{transform:'translateY(0)'}],{duration:1500,easing:'cubic-bezier(.65,0,.25,1)'})
   .finished.catch(()=>{}).then(()=>{bar?.classList.remove('arriving');bar?.classList.add('docked')});
 }
 async function join(hostId){
  if(busy)return;busy=true;
  try{
   const res=await call('queue_join',{host_id:String(hostId)});
   current={host_id:String(res.host_id||hostId),free_at:res.free_at||null};
   tg?.HapticFeedback?.notificationOccurred?.('success');arrive();
  }catch(e){toast(clubText(String(e?.message||'').replace(/^HTTP \d+:\s*/,''))||'Не получилось встать в очередь','err')}
  finally{busy=false}
 }
 async function leave(){
  if(busy||!current)return;busy=true;const was=current;current=null;paint();
  try{await call('queue_leave');toast('Ты вышел из очереди на '+pc(was.host_id),'inf')}
  catch{current=was;paint();toast('Не получилось выйти из очереди. Попробуй ещё раз','err')}
  finally{busy=false}
 }
 window.joinQueue=join;window.leaveQueue=leave;
 window.queueTaken=id=>{const h=(typeof hostsData!=='undefined'?hostsData:{})[String(id)];return !!h?.queued&&current?.host_id!==String(id)};
 // Every poll of the club state brings the guest's place in the queue; a booked PC ends it.
 const original=window.getClubState;
 if(typeof original==='function')window.getClubState=async(...args)=>{
  const data=await original(...args);
  if(!busy&&data&&'queue' in data){
   const next=data.queue?{host_id:String(data.queue.host_id),free_at:data.queue.free_at||null}:null;
   if(current&&!next&&(data.bookings||[]).some(b=>b.host_id===current.host_id))toast(pc(current.host_id)+' освободился и теперь твой 🎮','ok');
   current=next;paint();
  }
  return data;
 };
 setInterval(()=>{if(current)paint()},30000);
 addEventListener('resize',()=>{if(bar)dock()});
})();
