/* Аренды: what is out right now (mice, mouse pad, power bank). «Вернули» removes the card at once. */
(()=>{
 const ICONS={
  mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v6"/>',
  powerbank:'<rect x="6" y="3" width="12" height="18"/><path d="M10 1v2M14 1v2M13 7l-3 5h4l-3 5"/>',
  pad:'<rect x="2" y="6" width="20" height="12"/><path d="M5 15h5"/>'
 };
 const kind=item=>item==='powerbank'?'powerbank':item==='pad'?'pad':'mouse';
 window.rentalIcon=item=>`<svg class="rental-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind(item)]}</svg>`;
 const since=at=>{const m=Math.max(0,Math.floor((Date.now()/1000-at)/60));return m<60?m+' мин':Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин'};
 const time=at=>new Date(at*1000).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
 let picked=null,formReady=false;
 function card(){
  const node=document.createElement('article');node.className='rental-card';
  node.innerHTML='<div class="rental-art"></div><div class="rental-body"><h3></h3><p class="rental-who"></p><p class="rental-time"></p></div><button type="button" class="rental-back">Вернули</button>';
  node.querySelector('.rental-back').onclick=async e=>{const btn=e.currentTarget;btn.disabled=true;node.classList.add('leaving');const r=await invoke('return_rental',node.dataset.id);if(r?.ok)window.deskFlash?.('Вернули: '+node.querySelector('h3').textContent);else{node.classList.remove('leaving');btn.disabled=false;window.deskFlash?.(r?.error||'Нет ответа')}};
  node.update=(r,items)=>{
   node.dataset.id=r.id;node.dataset.kind=kind(r.item);
   if(node.dataset.item!==r.item){node.dataset.item=r.item;node.querySelector('.rental-art').innerHTML=rentalIcon(r.item)}
   setDeskText(node.querySelector('h3'),items[r.item]||r.item);
   setDeskText(node.querySelector('.rental-who'),[r.host?hostName(r.host):'',r.who].filter(Boolean).join(' · '));
   setDeskText(node.querySelector('.rental-time'),'с '+time(r.at)+' · '+since(r.at));
  };
  return node;
 }
 function setupForm(items){
  if(formReady)return;formReady=true;
  const box=$('rental-items');
  for(const [id,name] of Object.entries(items)){const b=document.createElement('button');b.type='button';b.className='rental-pick';b.dataset.item=id;b.setAttribute('role','radio');b.setAttribute('aria-checked','false');b.innerHTML=rentalIcon(id)+'<span></span>';b.querySelector('span').textContent=name;b.onclick=()=>{picked=id;box.querySelectorAll('.rental-pick').forEach(x=>x.setAttribute('aria-checked',String(x===b)));sync()};box.append(b)}
 }
 function sync(){$('rental-submit').disabled=!picked||!($('rental-host').value.trim()||$('rental-who').value.trim())}
 $('rental-host').oninput=$('rental-who').oninput=sync;
 $('rental-add').onclick=()=>{const form=$('rental-form');form.hidden=!form.hidden;if(!form.hidden){$('rental-message').textContent='';$('rental-host').focus()}};
 $('rental-form').onsubmit=async e=>{e.preventDefault();if($('rental-submit').disabled)return;$('rental-submit').disabled=true;const r=await invoke('add_rental',picked,$('rental-host').value.trim()||null,$('rental-who').value.trim());if(r?.ok){picked=null;$('rental-host').value=$('rental-who').value='';$('rental-items').querySelectorAll('.rental-pick').forEach(x=>x.setAttribute('aria-checked','false'));$('rental-form').hidden=true}else setDeskText($('rental-message'),r?.error||'Нет ответа');sync()};
 // History: returned items grouped by day (MSK), newest first.
 const day=at=>new Date(at*1000).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',weekday:'short'});
 const span=(a,b)=>{const m=Math.max(0,Math.round((b-a)/60));return m<60?m+' мин':Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин'};
 let historyKey='';
 function renderHistory(rows,items){
  const key=JSON.stringify(rows.map(r=>r.id));if(key===historyKey)return;historyKey=key;
  const box=$('rental-history');box.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='Пока ничего не возвращали';box.append(p);return}
  let current='';let list=null;
  for(const r of [...rows].sort((a,b)=>b.returned_at-a.returned_at)){
   const d=day(r.returned_at);if(d!==current){current=d;const h=document.createElement('h3');h.textContent=d;list=document.createElement('div');list.className='history-day';box.append(h,list)}
   const row=document.createElement('div');row.className='history-row';row.dataset.kind=kind(r.item);
   row.innerHTML=rentalIcon(r.item)+'<strong></strong><span class="who"></span><span class="when"></span>';
   row.querySelector('strong').textContent=items[r.item]||r.item;
   const who=row.querySelector('.who');who.textContent=[r.host?hostName(r.host):'',r.who].filter(Boolean).join(' · ');
   if(r.user_id||r.who){const open=document.createElement('button');open.type='button';open.className='who who-link';open.title='Открыть профиль гостя';open.textContent=who.textContent+' →';open.onclick=()=>window.openGuestProfile?.(r.user_id?{userId:r.user_id}:{query:r.who});who.replaceWith(open)}
   row.querySelector('.when').textContent=time(r.at)+' → '+time(r.returned_at)+' · '+span(r.at,r.returned_at);
   list.append(row);
  }
 }
 $('rental-history-toggle').onclick=e=>{const box=$('rental-history'),open=box.hidden;box.hidden=!open;e.currentTarget.setAttribute('aria-expanded',String(open));if(open)box.scrollIntoView({block:'start',behavior:'smooth'})};
 window.renderRentals=s=>{
  renderHistory(s.rental_history||[],s.rental_items||{});
  const items=s.rental_items||{},rows=s.rentals||[];setupForm(items);
  setDeskText($('rentals-count'),rows.length);$('rentals-count').toggleAttribute('data-zero',!rows.length);
  const list=$('rental-list'),existing=new Map([...list.children].map(n=>[n.dataset.id,n]));
  const nodes=[...rows].sort((a,b)=>b.at-a.at).map(r=>{const n=existing.get(r.id)||card();n.update(r,items);return n});
  if(!nodes.length){const empty=list.querySelector('.empty')||document.createElement('div');empty.className='empty';setDeskText(empty,'Сейчас ничего не выдано');nodes.push(empty)}
  reconcileDeskChildren(list,nodes);
 };
})();
