/* «Аккаунты»: one page with everything about a guest — who it is, money and time, visits, purchases, notes,
   rentals and how they registered. Opened from the search, from a reset request or from the rental history. */
(()=>{
 const MSK={timeZone:'Europe/Moscow'};
 const date=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{...MSK,day:'numeric',month:'short',year:'numeric'}):'—'};
 const stamp=v=>{const d=typeof v==='number'?new Date(v*1000):new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{...MSK,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'};
 const clock=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleTimeString('ru-RU',{...MSK,hour:'2-digit',minute:'2-digit'}):''};
 const short=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{...MSK,day:'numeric',month:'long'}):'—'};
 const minutes=m=>m==null?'—':m<60?m+'m':Math.floor(m/60)+'h'+(m%60?' '+(m%60)+'m':'');
 const rub=v=>v==null?'—':(Math.round(v*100)/100).toLocaleString('ru-RU')+' ₽';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 let seq=0;

 function tile(label,value,accent){const t=el('div','dossier-tile'+(accent?' accent':''));t.append(el('small',null,label),el('b',null,value));return t}
 function block(title,count){const box=el('section','surface dossier-block');const h=el('h3',null,title);if(count!=null)h.append(el('span','dim',' · '+count));box.append(h);return box}
 function table(rows,cols,empty){
  if(rows===null)return el('p','note','Gizmo не ответил. Откройте аккаунт ещё раз через минуту');
  if(!rows.length)return el('p','note',empty);
  const t=el('div','dossier-table');t.style.setProperty('--cols',cols.length);
  for(const r of rows)for(const [i,c] of cols.entries())t.append(el('span',i===0?'first':null,c(r)));
  return t;
 }
 function render(d){
  const box=$('account-dossier');box.replaceChildren();
  const b=d.balance||{};const tiles=el('div','dossier-tiles');
  tiles.append(tile('Депозит',rub(b.deposit??b.balance),true),tile('Время на счету',b.time==null?'—':minutes(Math.round(b.time/60))),
   tile('Наиграно',d.hours==null?'Считаем…':d.hours+'h'),tile('Посещений за год',d.visit_count??'—'),tile('Последний визит',d.last_visit?short(d.last_visit):'—'));
  box.append(tiles);
  if(d.playing?.length){const p=el('p','dossier-live');p.textContent='Сейчас играет · '+d.playing.map(x=>hostName(x.host)+(x.since?' с '+clock(x.since):'')).join(', ');box.append(p)}
  const info=block('Анкета');const u=d.user||{};
  const rows=[['Дата рождения',u.birthDate?date(u.birthDate):''],['Пол',u.sex===1||u.sex==='Male'?'Мужской':u.sex===2||u.sex==='Female'?'Женский':''],['Почта',u.email],
   ['В клубе с',u.createdTime?date(u.createdTime):d.registration?.at?date(d.registration.at):''],
   ['Как пришёл',d.registration?((d.registration.source==='desk'?'На ресепшене':'Через мини-апп')+(d.registration.code?' · промокод '+d.registration.code:'')):'']].filter(r=>r[1]);
  info.append(rows.length?table(rows,[r=>r[0],r=>r[1]],''):el('p','note','Больше данных в Gizmo нет'));box.append(info);
  const visits=block('Посещения',d.visits?.length?d.visit_count:null);
  visits.append(table(d.visits,[v=>date(v.start),v=>clock(v.start)+(v.end?' → '+clock(v.end):' → сейчас'),v=>v.host?hostName(v.host):'—',v=>minutes(v.minutes)],'За последний год посещений нет'));box.append(visits);
  const buys=block('Покупки и пополнения',d.purchases?.length||null);
  buys.append(table(d.purchases,[x=>stamp(x.at),x=>x.title||'—',x=>rub(x.value),x=>x.method||''],'Покупок за год нет'));box.append(buys);
  if(d.notes?.length){const n=block('Заметки в Gizmo',d.notes.length);const list=el('div','dossier-notes');d.notes.forEach(t=>list.append(el('p',null,t)));n.append(list);box.append(n)}
  if(d.rentals?.length){const r=block('Аренды',d.rentals.length);r.append(table(d.rentals,[x=>stamp(x.at),x=>(current?.rental_items||{})[x.item]||x.item,x=>x.returned_at?'вернул '+clock(x.returned_at*1000):'на руках'],''));box.append(r)}
  if(d.errors?.length)box.append(el('p','note','Не получили из Gizmo: '+d.errors.join(', ')+'. Откройте аккаунт ещё раз'));
 }
 async function load(user){
  const mine=++seq;$('account-empty').hidden=true;$('account-card').hidden=false;$('account-password').hidden=false;
  const box=$('account-dossier');box.replaceChildren(el('p','note dossier-loading','Собираем историю из Gizmo…'));
  const d=await invoke('account_profile',user.id);if(mine!==seq)return;
  if(!d||d.error){box.replaceChildren(el('p','note',d?.error||'Нет ответа'));return}
  render(d);
 }
 const before=chooseAccount;
 chooseAccount=(user,requestId=null,focusPassword=true)=>{before(user,requestId,focusPassword);load(user);if(!focusPassword)$('account-card').scrollIntoView({block:'start',behavior:'smooth'})};
 window.reloadAccountProfile=()=>foundAccount&&load(foundAccount);
})();
