/* «Статистика»: the club from Gizmo's reports — months, new guests and who came back, busy hours, zones, facts.
   Desk counts it once a day by itself; «Обновить» counts again now (about a minute, Gizmo is slow on big reports). */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='stats';tab.textContent='Статистика';
 tab.onclick=()=>{panel('stats');load()};
 document.querySelector('nav').insertBefore(tab,document.querySelector('nav [data-panel="notes"]')||document.querySelector('nav [data-panel="sound"]'));
 const section=document.createElement('section');section.id='panel-stats';section.hidden=true;
 section.innerHTML=`<div class="page-head"><h2>Статистика</h2></div>
  <section class="surface tbank" id="tbank">
   <div class="tbank-head"><div><h3>ТБанк за смену</h3><p class="note" id="tbank-since"></p></div>
    <div class="tbank-actions"><button type="button" id="tbank-start-open">Считать с…</button><button type="button" id="tbank-close">Закрыть смену</button></div></div>
   <form id="tbank-start" class="tbank-start" hidden>
    <label>Считать ТБанк с<input type="datetime-local" id="tbank-start-at" enterkeyhint="done" required></label>
    <button type="submit">Пересчитать</button>
    <p class="note">Забыли нажать «Закрыть смену»? Найдите в Gizmo первую платёжку ТБанка этой смены и поставьте её дату и время — Desk пересчитает всё с этого момента.</p>
   </form>
   <div class="tbank-numbers"><div><small>Пришло через ТБанк</small><b id="tbank-sum">—</b></div><div><small>Операций</small><b id="tbank-count">—</b></div></div>
   <p class="note tbank-safe">Кнопка только обнуляет этот счётчик в Desk. Смена в Gizmo не закрывается и вообще не трогается.</p>
   <p class="note" id="tbank-message" role="status"></p>
   <details class="tbank-ops"><summary>Операции этой смены</summary><div id="tbank-ops"></div></details>
   <details class="tbank-ops"><summary>Прошлые смены</summary><div id="tbank-history"></div></details>
  </section>
  <div class="page-head stats-club-head"><div><h2>Статистика клуба</h2><p class="note" id="stats-at"></p></div><button type="button" id="stats-refresh">Обновить</button></div>
  <p class="note" id="stats-message" role="status"></p><div id="stats-body" class="stats-body"></div>`;
 document.querySelector('main').append(section);
 const body=section.querySelector('#stats-body'),msg=section.querySelector('#stats-message'),at=section.querySelector('#stats-at'),btn=section.querySelector('#stats-refresh');
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const num=v=>v==null?'—':Number(v).toLocaleString('ru-RU');
 const rub=v=>v==null?'—':num(v)+' ₽';
 const ZONE_COLOR={'STANDART':'#ffffff','VIP 1':'var(--orange)','VIP 2':'var(--pink)','TV':'#5B7BFF'};
 const DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
 function tile(label,value,hint,accent){const t=el('div','stat-tile'+(accent?' accent':''));t.append(el('small',null,label),el('b',null,value));if(hint)t.append(el('span',null,hint));return t}
 function block(title,note){const b=el('section','surface stat-block');b.append(el('h3',null,title));if(note)b.append(el('p','note',note));return b}
 function months(rows){
  // One series (active guests) as columns; every number is also in the table below, so the chart is a quick look.
  const b=block('Гости по месяцам','Столбик — сколько разных гостей играло в месяце. Новые — аккаунт создан в этом месяце и гость пришёл; вернулись — пришли ещё хотя бы в один день.');
  const max=Math.max(1,...rows.map(r=>r.active));const chart=el('div','stat-columns');
  for(const r of rows){const c=el('div','stat-col');c.title=`${r.label}: ${r.active} гостей, ${r.visits} визитов, ${num(r.hours)}h`;
   const bar=el('i');bar.style.height=Math.max(2,Math.round(100*r.active/max))+'%';c.append(el('b',null,r.active||''),bar,el('small',null,r.label));chart.append(c)}
  const table=el('div','stat-table');table.style.setProperty('--cols',9);
  ['Месяц','Новые','Вернулись','Активные','Постоянные','Визиты','Часы','Выручка','С депозита'].forEach(h=>table.append(el('span','head',h)));
  for(const r of [...rows].reverse())[r.label,r.new,r.new?`${r.came_back} · ${Math.round(100*r.came_back/r.new)}%`:'—',r.active,r.regular,r.visits,num(r.hours)+'h',rub(r.revenue),rub(r.from_deposit)].forEach((v,i)=>table.append(el('span',i?null:'first',String(v))));
  b.append(chart,table,el('p','note','Постоянные — 4 и больше дней за месяц. Выручка — живые деньги: наличные, карта, СБП, вместе с пополнениями депозита. «С депозита» — покупки за счёт уже внесённых денег, в выручку они не входят, иначе деньги посчитались бы дважды. Баллы и бонусы — не деньги.'));return b;
 }
 function heat(grid){
  const b=block('Когда приходят','Сколько визитов началось в этот час, за год. Чем ярче, тем больше.');
  const max=Math.max(1,...grid.flat());const box=el('div','stat-heat');
  box.append(el('span'));for(let h=0;h<24;h++)box.append(el('small',null,h%3===0?String(h).padStart(2,'0'):''));
  grid.forEach((row,d)=>{box.append(el('small',null,DAYS[d]));row.forEach((n,h)=>{const c=el('i',n?null:'zero');c.style.setProperty('--a',n?(0.12+0.88*n/max).toFixed(2):'1');c.title=`${DAYS[d]} ${String(h).padStart(2,'0')}:00 — ${n} визитов`;box.append(c)})});
  b.append(box);return b;
 }
 function bars(title,rows,label,value,color,unit){
  const b=block(title);const max=Math.max(1,...rows.map(value));const list=el('div','stat-bars');
  for(const r of rows){const row=el('div','stat-bar');const fill=el('i');fill.style.width=Math.max(1,Math.round(100*value(r)/max))+'%';if(color)fill.style.background=color(r);
   row.append(el('span',null,label(r)),el('div','track'),el('b',null,num(value(r))+unit));row.children[1].append(fill);list.append(row)}
  b.append(list);return b;
 }
 // Tabs inside «Статистика клуба»: Обзор · Гости · Когда и где · Продажи. The chosen tab survives a refresh.
 let statTab='overview',guestSort='hours',guestQuery='';
 const TABS=[['overview','Обзор'],['guests','Гости'],['time','Когда и где'],['sales','Продажи'],['new','Новые гости'],['promo','Акции']];
 const ago=d=>{const n=Math.round((Date.now()-new Date(d))/86400000);return n<=0?'сегодня':n===1?'вчера':n+' дн. назад'};
 const nickLink=(nick,id)=>{const b=el('button','nick-link',nick||('ID '+id));b.type='button';b.title='Открыть досье гостя';b.onclick=()=>window.openGuestProfile?.({userId:id});return b};
 function overview(st){
  const s=st.summary||{},box=el('div','stat-pane');
  const tiles=el('div','stat-tiles');
  tiles.append(tile('Гостей с игрой за год',num(s.played),`из ${num(s.accounts)} аккаунтов`,true),tile('Играли за 30 дней',num(s.active_30)),
   tile('Спят 1–6 месяцев',num(s.sleeping),'можно позвать акцией'),tile('Новые вернулись',s.return_rate==null?'—':s.return_rate+'%','пришли ещё раз'),
   tile('Средняя сессия',s.avg_session_min?`${Math.floor(s.avg_session_min/60)}h ${s.avg_session_min%60}m`:'—'),tile('Средний гость тратит',rub(s.avg_spend),s.median_spend!=null?'медиана '+rub(s.median_spend):''));
  box.append(tiles);
  if(st.facts?.length){const f=block('Интересные факты');const ul=el('ul','stat-facts');st.facts.forEach(t=>ul.append(el('li',null,t)));f.append(ul);box.append(f)}
  box.append(months(st.months||[]));return box;
 }
 function guestsPane(st){
  const l=st.local||{},all=l.guests||[],box=el('div','stat-pane');
  const tools=el('div','guest-tools');
  const search=el('input');search.type='search';search.placeholder='Ник или номер аккаунта';search.value=guestQuery;search.setAttribute('enterkeyhint','done');search.autocomplete='off';
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search.blur()}});
  const sorts=el('div','chips');[['hours','По часам'],['visits','По визитам'],['spent','По тратам'],['last','Недавние'],['sleeping','Давно не были']].forEach(([k,t])=>{const b=el('button',null,t);b.type='button';b.setAttribute('aria-pressed',String(k===guestSort));b.onclick=()=>{guestSort=k;draw()};sorts.append(b)});
  tools.append(search,sorts);
  const count=el('p','note'),table=el('div','guest-table');
  box.append(block('Все гости за год','Нажмите на ник — откроется досье гостя: посещения, покупки, заметки. Ники видны только на этом компьютере.'),tools,count,table);
  const SORT={hours:(a,b)=>b.hours-a.hours,visits:(a,b)=>b.visits-a.visits,spent:(a,b)=>b.spent-a.spent,last:(a,b)=>String(b.last).localeCompare(a.last),sleeping:(a,b)=>String(a.last).localeCompare(b.last)};
  function draw(){
   sorts.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(['hours','visits','spent','last','sleeping'][i]===guestSort)));
   const q=guestQuery.trim().toLowerCase();
   const rows=all.filter(g=>!q||String(g.nick).toLowerCase().includes(q)||String(g.id).includes(q)).sort(SORT[guestSort]).slice(0,300);
   setDeskText(count,q?`Найдено ${rows.length}`:`Всего ${num(all.length)}`+(all.length>300?', показаны первые 300':''));
   table.replaceChildren(...['Гость','Визитов','Часов','Потратил','Первый раз','Последний раз'].map(h=>el('span','head',h)));
   for(const g of rows)table.append(Object.assign(el('span','first'),{}),el('span',null,num(g.visits)),el('span',null,num(g.hours)+'h'),el('span',null,rub(g.spent)),el('span',null,new Date(g.first).toLocaleDateString('ru-RU')),el('span',null,ago(g.last)));
   [...table.querySelectorAll('span.first')].forEach((cell,i)=>cell.append(nickLink(rows[i].nick,rows[i].id)));
  }
  search.oninput=()=>{guestQuery=search.value;draw()};draw();
  if(l.longest)box.append(el('p','note',`Самая длинная сессия за год: ${l.longest.nick}, ${l.longest.hours}h (${l.longest.date})`));
  return box;
 }
 function timePane(st){
  const box=el('div','stat-pane');box.append(heat(st.heat||[]));
  const two=el('div','stat-two');
  two.append(bars('Часы по залам',st.zones||[],r=>r.zone,r=>r.hours,r=>ZONE_COLOR[r.zone]||'var(--lime)','h'),
   bars('Часы по ПК',(st.pcs||[]).slice(0,40),r=>hostName(r.pc),r=>r.hours,null,'h'));
  box.append(two);return box;
 }
 let salesKind='all';
 function salesPane(st){
  const box=el('div','stat-pane'),rows=st.months||[];
  const fromGizmo=rows.some(r=>r.revenue_source==='gizmo');
  box.append(bars('Выручка по месяцам',[...rows].reverse().filter(r=>r.revenue||r.visits),r=>r.label,r=>r.revenue,null,' ₽'));
  box.append(el('p','note',fromGizmo?'Выручка — итог самого Gizmo (его отчёт «Обзор») за каждый месяц.':'Gizmo не отдал свой итог, поэтому выручка посчитана по журналу операций: живые деньги вместе с пополнениями.'));
  const all=st.products||[];
  if(all.length){
   const b=block('Все товары и пакеты за год','Из отчёта Gizmo по продажам: сколько продано (за вычетом возвратов) и на какую сумму.');
   const chips=el('div','chips stat-chips');const table=el('div','guest-table sales-table');
   [['all','Все'],['hours','Пакеты часов'],['goods','Бар и товары']].forEach(([k,t])=>{const c=el('button',null,t);c.type='button';c.onclick=()=>{salesKind=k;draw()};c.dataset.k=k;chips.append(c)});
   function draw(){
    chips.querySelectorAll('button').forEach(c=>c.setAttribute('aria-pressed',String(c.dataset.k===salesKind)));
    const list=all.filter(g=>salesKind==='all'||g.kind===salesKind),total=list.reduce((a,g)=>a+g.money,0)||1;
    table.replaceChildren(...['Товар','Продано','Сумма','Доля'].map(h=>el('span','head',h)));
    for(const g of list)table.append(el('span','first',g.title),el('span',null,num(g.count)+' шт.'),el('span',null,rub(g.money)),el('span',null,(Math.round(1000*g.money/total)/10)+'%'));
   }
   draw();b.append(chips,table);box.append(b);
  }
  return box;
 }
 // «Новые гости»: first-ever visits before and after the ads (13 November), alone or with company.
 function newPane(st){
  const n=st.newcomers,box=el('div','stat-pane');
  if(!n){box.append(el('p','note','Нажмите «Обновить» — Desk посчитает новых гостей по истории Gizmo.'));return box}
  const a=n.after,b=n.before_30,all=n.before_all,day=v=>new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  const diff=(x,y)=>!y?'':(x>=y?'+':'')+Math.round(100*(x-y)/y)+'%';
  const tiles=el('div','stat-tiles');
  tiles.append(tile('После рекламы',num(a.per_day)+' в день',`${num(a.new)} новых с ${day(n.ad_start)} · ${num(a.days)} дн.`,true),
   tile('30 дней до рекламы',num(b.per_day)+' в день',`${num(b.new)} новых · ${diff(a.per_day,b.per_day)} сейчас`),
   tile('Обычно до рекламы',num(all.per_day)+' в день',`с ${day(all.from)} · ${diff(a.per_day,all.per_day)} сейчас`),
   tile('Вернулись ещё раз',a.back_pct+'%',`после рекламы · до было ${b.back_pct}%`));
  box.append(tiles);
  const comp=block('Одни или компанией','Компания — гости, которые пришли с разницей до 15 минут, ушли с разницей до 20 минут и сидели в одной зоне зала.');
  const t=el('div','guest-table new-table');
  t.append(...['','Одиночки','Пары','Группы 3+','Друг тоже новый'].map(h=>el('span','head',h)));
  for(const [label,w] of [['После рекламы',a],['30 дней до',b],['Обычно до',all]])
   t.append(el('span','first',label),el('span',null,`${w.solo_pct}% · ${num(w.solo)}`),el('span',null,`${w.pair_pct}% · ${num(w.pair)}`),el('span',null,`${w.group_pct}% · ${num(w.group)}`),el('span',null,w.with_new_pct+'%'));
  comp.append(t);box.append(comp);
  box.append(bars('Новые гости по неделям',[...(n.weeks||[])].reverse().slice(0,20),r=>'с '+new Date(r.week).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}),r=>r.new,r=>r.week>=n.ad_start.slice(0,10)||new Date(r.week).getTime()+7*864e5>new Date(n.ad_start)?'var(--lime)':null,''));
  box.append(el('p','note',`Новый гость — тот, у кого это первая сессия в Gizmo (Gizmo в клубе с ${day(n.since)}; первые недели после запуска не считаются, тогда все были «новыми»). Салатовые недели — с рекламой.`));
  return box;
 }
 // «Акции»: guests whose Gizmo note mentions the promo (admins write e.g. «взял гориллу»), what they topped up then and later.
 let promoWord='горилл';
 function promoPane(){
  const box=el('div','stat-pane');
  box.append(block('Акция по заметкам','Desk ищет слово во всех заметках гостей в Gizmo и считает, сколько пополнили в тот визит, кто вернулся и пополнялся ещё. Пишите начало слова, как в заметках: «горилл» найдёт и «горилла», и «гориллу».'));
  const form=el('form','guest-tools');const input=el('input');input.value=promoWord;input.placeholder='Слово из заметки';input.setAttribute('enterkeyhint','done');input.autocomplete='off';input.maxLength=40;
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur()}});
  const go=el('button',null,'Посчитать');go.type='submit';const dayBtn=el('button','ghost','Все заметки за сутки');dayBtn.type='button';form.append(input,go,dayBtn);
  const status=el('p','note'),out=el('div');box.append(form,status,out);
  let t=null;
  function draw(r){
   go.disabled=!!r.busy;setDeskText(go,r.busy?'Считаем…':'Посчитать');
   setDeskText(status,r.busy?`Читаем заметки гостей: ${num(r.done)} из ${num(r.total)||'…'}. Можно работать дальше.`:(r.error||''));
   dayBtn.disabled=!!r.busy;
   const res=r.result;if(r.busy||!res){if(!r.busy)out.replaceChildren();return}
   if(res.mode==='day'){out.replaceChildren(...dayView(res));return}
   const s=res.summary,day=v=>v?new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'—';
   const tiles=el('div','stat-tiles');
   tiles.append(tile('Взяли по акции',num(s.people),s.people?`«${res.word}» · ${day(s.from)} — ${day(s.to)}`:'заметок со словом нет',true),
    tile('Пополнили в тот визит',num(s.topped_that_visit),`${s.topped_that_visit_pct}% · ${rub(s.that_visit_sum)}`),
    tile('Средний чек пополнения',rub(s.avg_that_visit),'у тех, кто пополнил'),
    tile('Вернулись потом',num(s.came_back),`${s.came_back_pct}% пришли в другой день`),
    tile('Пополнились ещё',num(s.topped_again),`${s.topped_again_pct}% · ${rub(s.again_sum)}`));
   const table=el('div','guest-table promo-table');
   table.append(...['Гость','Когда взял','В тот визит','Потом пополнил','Визитов после'].map(h=>el('span','head',h)));
   for(const g of res.guests){const c=el('span','first');c.append(nickLink(g.nick,g.id));c.title=g.note;
    table.append(c,el('span',null,new Date(g.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})),
     el('span',null,g.topup?rub(g.topup):'—'),el('span',null,g.later_count?`${rub(g.later_sum)} · ${g.later_count} раз`:'—'),el('span',null,g.visits_after?num(g.visits_after):'—'))}
   out.replaceChildren(tiles,table,el('p','note','«В тот визит» — пополнения за 3 часа до заметки и час после. «Потом» — все пополнения позже. Наведите на ник — покажет текст заметки.'));
  }
  function dayView(res){
   const s=res.summary,hm=v=>new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
   const tiles=el('div','stat-tiles');
   tiles.append(tile('Заметок за '+s.hours+' ч',num(s.notes),num(s.guests)+' гостей',false),tile('Про гориллу',num(s.gorilla_notes),num(s.gorilla_guests)+' гостей',true),
    tile('С «600»',num(s.six_notes),'горилла и 600 вместе: '+num(s.both_notes)),tile('Пополнений на 600 ₽',num(s.topups_600),'из них с заметкой про гориллу: '+num(s.topups_600_with_gorilla_note)));
   const t=el('div','guest-table day-notes');t.append(...['Когда','Гость','Заметка','Горилла','600'].map(h=>el('span','head',h)));
   const list=[...res.notes].sort((a,b)=>(b.gorilla||b.six)-(a.gorilla||a.six)||String(b.at).localeCompare(a.at));
   for(const n of list){const g=el('span','first');g.append(nickLink(n.nick,n.id));
    const text=el('span','note-text',n.text);if(n.gorilla||n.six)text.classList.add('hit');
    t.append(el('span',null,hm(n.at)),g,text,el('span',null,n.gorilla?'да':''),el('span',null,n.six?'да':''))}
   const parts=[tiles,t];
   if(res.topups_600.length){const b=block('Пополнения ровно на 600 ₽ за это время');const tt=el('div','guest-table promo-table');tt.append(...['Гость','Когда','Есть заметка про гориллу','',''].map(h=>el('span','head',h)));
    const gor=new Set(res.notes.filter(n=>n.gorilla).map(n=>n.id));
    for(const p of res.topups_600){const c=el('span','first');c.append(nickLink(p.nick,p.id));tt.append(c,el('span',null,hm(p.at)),el('span',null,gor.has(p.id)?'да':'нет'),el('span'),el('span'))}
    b.append(tt);parts.push(b)}
   parts.push(el('p','note','Сначала заметки про гориллу и 600, потом все остальные. Горилла ищется в любом написании: «горилла», «горила», «Gorilla».'));
   return parts;
  }
  dayBtn.onclick=async()=>{const r=await invoke('promo_notes_day',24);if(r?.error){setDeskText(status,r.error);return}poll()};
  async function poll(){const r=await invoke('promo_notes_state');if(!r||!box.isConnected)return;draw(r);clearTimeout(t);if(r.busy)t=setTimeout(poll,1500)}
  form.onsubmit=async e=>{e.preventDefault();promoWord=input.value.trim();const r=await invoke('promo_notes_start',promoWord);if(r?.error){setDeskText(status,r.error);return}poll()};
  poll();return box;
 }
 function render(st){
  body.replaceChildren();if(!st)return;
  const nav=el('div','stat-tabs');nav.setAttribute('role','tablist');
  const pane=el('div');
  const show=k=>{statTab=k;nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===k)));
   pane.replaceChildren(k==='guests'?guestsPane(st):k==='time'?timePane(st):k==='sales'?salesPane(st):k==='promo'?promoPane():k==='new'?newPane(st):overview(st))};
  for(const [k,t] of TABS){const b=el('button',null,t);b.type='button';b.dataset.tab=k;b.setAttribute('role','tab');b.onclick=()=>show(k);nav.append(b)}
  body.append(nav,pane);show(statTab);
  if(st.errors?.length)body.append(el('p','note','Gizmo не отдал: '+st.errors.join(', ')+'. Нажмите «Обновить» позже.'));
 }
 let timer=null;
 async function load(){
  const r=await invoke('club_stats_state');if(!r)return;
  const st=r.stats;setDeskText(at,st?.at?'Обновлено '+new Date(st.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'');
  btn.disabled=!!r.busy;setDeskText(btn,r.busy?'Собираем…':'Обновить');
  setDeskText(msg,r.error||(r.busy?'Собираем статистику из Gizmo. Это около минуты, можно работать дальше.':st?'':'Статистики ещё нет. Нажмите «Обновить».'));
  if(st&&body.dataset.at!==st.at){body.dataset.at=st.at;render(st)}
  clearTimeout(timer);if(r.busy&&!section.hidden)timer=setTimeout(load,4000);
 }
 btn.onclick=async()=>{btn.disabled=true;await invoke('refresh_club_stats');load()};

 // ТБанк: recounted from Gizmo's log every 30 s while the tab is open; «Закрыть смену» takes two taps.
 const T=id=>section.querySelector('#'+id);
 const when=v=>new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 const clock=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
 let shiftId=null,tTimer=null;
 function rowsInto(box,items,cells,empty){
  box.replaceChildren();if(!items.length){box.append(el('p','note',empty));return}
  const t=el('div','stat-table');t.style.setProperty('--cols',cells.length);
  for(const it of items)cells.forEach((c,i)=>t.append(el('span',i?null:'first',c(it))));box.append(t);
 }
 async function tbank(fresh=false){
  const r=await invoke('tbank_status',fresh);if(!r)return;
  shiftId=r.id||null;
  setDeskText(T('tbank-since'),r.start?'С '+when(r.start):'');
  setDeskText(T('tbank-sum'),r.sum==null?'—':rub(r.sum));setDeskText(T('tbank-count'),r.count==null?'—':num(r.count));
  setDeskText(T('tbank-message'),r.error||'');
  rowsInto(T('tbank-ops'),r.operations||[],[o=>clock(o.at),o=>o.title||'—',o=>rub(o.amount),o=>o.operator||''],'Пока ни одной операции через ТБанк');
  rowsInto(T('tbank-history'),r.history||[],[h=>when(h.start)+' → '+clock(h.end),h=>num(h.count)+' опер.',h=>rub(h.sum)],'Закрытых смен ещё нет');
  clearTimeout(tTimer);if(!section.hidden)tTimer=setTimeout(()=>tbank(),30000);
 }
 // «Считать с»: pick the start by hand (e.g. the first T-Bank payment of the shift in Gizmo).
 const local=d=>{const m=new Date(new Date(d).getTime()+3*3600e3);return m.toISOString().slice(0,16)};
 T('tbank-start-open').onclick=()=>{const f=T('tbank-start');f.hidden=!f.hidden;if(!f.hidden){T('tbank-start-at').value=local(Date.now());T('tbank-start-at').focus()}};
 T('tbank-start-at').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur()}});
 T('tbank-start').onsubmit=async e=>{e.preventDefault();const v=T('tbank-start-at').value;if(!v)return;
  const r=await invoke('set_tbank_start',shiftId,v+':00+03:00');
  if(r?.ok){T('tbank-start').hidden=true;setDeskText(T('tbank-message'),'Пересчитали с '+v.replace('T',' '));tbank(true)}else setDeskText(T('tbank-message'),r?.error||'Нет ответа')};
 T('tbank-close').onclick=e=>armTap(e.currentTarget,'Точно закрыть?',async()=>{
  const b=T('tbank-close');b.disabled=true;setDeskText(T('tbank-message'),'Считаем итог…');
  const r=await invoke('close_tbank_shift',shiftId,true);b.disabled=false;
  if(r?.ok){const c=r.closed;window.deskFlash?.('Смена закрыта: '+rub(c.sum));setDeskText(T('tbank-message'),`Итог смены: ${rub(c.sum)}, ${num(c.count)} операций. Новый счёт пошёл с ${clock(c.end)}.`);tbank(true)}
  else setDeskText(T('tbank-message'),r?.error||'Нет ответа от Desk');
 });
 tab.addEventListener('click',()=>tbank(true));
})();
