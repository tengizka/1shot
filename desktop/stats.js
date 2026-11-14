/* «Статистика»: the club from Gizmo's reports — months, new guests and who came back, busy hours, zones, facts.
   Desk counts it once a day by itself; «Обновить» counts again now (about a minute, Gizmo is slow on big reports). */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='stats';tab.textContent='Статистика';
 tab.onclick=()=>{panel('stats');load()};
 document.querySelector('nav').insertBefore(tab,document.querySelector('nav [data-panel="notes"]')||document.querySelector('nav [data-panel="sound"]'));
 const section=document.createElement('section');section.id='panel-stats';section.hidden=true;
 section.innerHTML=`<div class="page-head"><div><h2>Статистика</h2><p class="note" id="stats-at"></p></div><button type="button" id="stats-refresh">Обновить</button></div>
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
  const table=el('div','stat-table');table.style.setProperty('--cols',8);
  ['Месяц','Новые','Вернулись','Активные','Постоянные','Визиты','Часы','Выручка'].forEach(h=>table.append(el('span','head',h)));
  for(const r of [...rows].reverse())[r.label,r.new,r.new?`${r.came_back} · ${Math.round(100*r.came_back/r.new)}%`:'—',r.active,r.regular,r.visits,num(r.hours)+'h',rub(r.revenue)].forEach((v,i)=>table.append(el('span',i?null:'first',String(v))));
  b.append(chart,table,el('p','note','Постоянные — 4 и больше дней за месяц. Выручка — сумма продаж из журнала Gizmo.'));return b;
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
 function render(st){
  body.replaceChildren();if(!st)return;
  const s=st.summary||{};
  const tiles=el('div','stat-tiles');
  tiles.append(tile('Гостей с игрой за год',num(s.played),`из ${num(s.accounts)} аккаунтов`,true),tile('Играли за 30 дней',num(s.active_30)),
   tile('Спят 1–6 месяцев',num(s.sleeping),'можно позвать акцией'),tile('Новые вернулись',s.return_rate==null?'—':s.return_rate+'%','пришли ещё раз'),
   tile('Средняя сессия',s.avg_session_min?`${Math.floor(s.avg_session_min/60)}h ${s.avg_session_min%60}m`:'—'),tile('Средний гость тратит',rub(s.avg_spend),s.median_spend!=null?'медиана '+rub(s.median_spend):''));
  body.append(tiles);
  if(st.facts?.length){const f=block('Интересные факты');const ul=el('ul','stat-facts');st.facts.forEach(t=>ul.append(el('li',null,t)));f.append(ul);body.append(f)}
  body.append(months(st.months||[]),heat(st.heat||[]));
  const two=el('div','stat-two');
  two.append(bars('Часы по залам',st.zones||[],r=>r.zone,r=>r.hours,r=>ZONE_COLOR[r.zone]||'var(--lime)','h'),
   bars('Часы по ПК',(st.pcs||[]).slice(0,30),r=>hostName(r.pc),r=>r.hours,null,'h'));
  body.append(two);
  if(st.products?.length)body.append(bars('Что покупают чаще всего',st.products,r=>r.title,r=>r.count,null,' шт'));
  const l=st.local||{};
  if(l.top_hours?.length){
   const b=block('Самые постоянные гости','Только на этом компьютере, на сервер ники не уходят.');const g=el('div','stat-three');
   const list=(title,rows,fmt)=>{const c=el('div');c.append(el('h4',null,title));const ol=el('ol','stat-top');rows.forEach(r=>{const li=el('li');li.append(el('span',null,r.nick),el('b',null,fmt(r)));ol.append(li)});c.append(ol);return c};
   g.append(list('По часам',l.top_hours,r=>num(r.hours)+'h'),list('По визитам',l.top_visits||[],r=>num(r.visits)),list('По тратам',l.top_spend||[],r=>rub(r.spent)));
   b.append(g);if(l.longest)b.append(el('p','note',`Самая длинная сессия: ${l.longest.nick}, ${l.longest.hours}h (${l.longest.date})`));body.append(b);
  }
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
})();
