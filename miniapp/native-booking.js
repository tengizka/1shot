/* The native calendar uses absolute UTC instants and displays all times in Moscow. */
window.createNativeBooking = ({sheet, call, open, refresh, showMine, isBusy, setBusy}) => {
 const $ = id => document.getElementById(id);
 const minute = 60000, day = 24 * 60 * minute;
 const msk = new Intl.DateTimeFormat('ru-RU', {timeZone:'Europe/Moscow', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
 const display = t => msk.format(t);
 const ms = Date.parse;
 const container = document.createElement('section');
 container.id = 'gizmo-booking';
 container.hidden = true;
 container.innerHTML = `
  <h2 id="gizmo-seat"></h2>
  <p id="gizmo-clock" class="club-note">Время московское</p>
  <p id="gizmo-info" class="club-note" role="status"></p>
  <div class="gizmo-times">
   <label>Начало<select id="gizmo-start"></select></label>
   <label>Окончание<select id="gizmo-end"></select></label>
  </div>
  <p id="gizmo-conflict" role="status"></p>
  <button type="button" id="gizmo-shorten" class="club-cancel" hidden></button>
  <button type="button" id="gizmo-other" class="club-cancel" hidden>Другой ПК на это время</button>
  <button type="button" id="gizmo-reset" class="club-cancel" hidden>Показать зал сейчас</button>
  <button type="button" id="gizmo-submit" class="btn-main"></button>`;
 $('club-mine').before(container);

 const filter = document.createElement('button');
 filter.type = 'button';
 filter.id = 'gizmo-filter';
 filter.hidden = true;
 filter.textContent = 'Выбрать время';
 document.querySelector('.hall-heading').after(filter);
 filter.onclick = () => startPicking(null);

 let backend = 'desk', seat = null, start = 0, end = 0, selected = null;
 let sample = null, pending = null, request = null;
 const today = () => sample ? sample.server + performance.now() - sample.received : Date.now();
 const fresh = () => sample && sample.expires > performance.now();
 const valid = (from, to) => from > today() + minute && from <= today() + day && to >= from + 30 * minute && to <= from + 360 * minute;
 const matches = (r, from, to) => ms(r.starts_at) < to && ms(r.ends_at) > from;
 const intervals = id => (sample?.intervals.get(id) || []);
 const bookings = id => intervals(id).filter(r => ms(r.ends_at) > today());
 const fmtRange = (from, to) => display(from) + ' → ' + display(to);

 function availability(id, from, to) {
  if (!fresh()) return 'unknown';
  const h = sample.hosts.get(id);
  if (!h || h.status === 'unavailable') return 'broken';
  if (bookings(id).some(r => matches(r, from, to))) return 'reserved';
  if (h.status === 'busy' && !(ms(h.free_at) > today() && ms(h.free_at) <= from)) return 'busy';
  return 'free';
 }

 function paint() {
  filter.hidden = backend === 'desk';
  filter.textContent = selected && valid(...selected) ? fmtRange(...selected) + ' · МСК' : 'Выбрать время';
  if (container.hidden) return;
  const h = fresh() && sample.hosts.get(seat);
  const next = fresh() && bookings(seat)[0];
  const messages = [];
  if (backend === 'drain') messages.push('Новые брони временно недоступны.');
  else if (!fresh()) messages.push(pending ? 'Проверяем расписание клуба…' : 'Расписание недоступно. Повторите проверку.');
  else if (seat) {
   if (h?.status === 'busy') messages.push(ms(h.free_at) > today() ? 'Сейчас занят · ориентир освобождения ' + display(ms(h.free_at)) : 'Сейчас занят · время освобождения неизвестно.');
   if (next) {
    const since = ms(next.starts_at);
    if (h?.status === 'free' && since > today()) messages.push('Свободен до ' + display(since) + '.');
    messages.push((since > today() ? 'Ближайшая бронь ' : 'Забронирован ') + fmtRange(since, ms(next.ends_at)) + '.');
   }
  }
  $('gizmo-info').textContent = messages.join(' ');
  const status = seat && availability(seat, start, end);
  const clash = fresh() && valid(start,end) && bookings(seat).find(r => matches(r,start,end));
  const canShorten = clash && valid(start,Math.floor(ms(clash.starts_at)/minute)*minute) &&
   availability(seat,start,Math.floor(ms(clash.starts_at)/minute)*minute) === 'free';
  $('gizmo-conflict').textContent = !seat || !fresh() || backend!=='gizmo' ? '' :
   !valid(start,end) ? 'Выберите актуальный интервал.' :
   status === 'reserved' ? 'Часть выбранного времени забронирована.' :
   status === 'busy' ? 'ПК пока занят или освободится позже.' :
   status !== 'free' ? 'ПК недоступен для брони.' : '';
  $('gizmo-shorten').hidden = !canShorten || backend!=='gizmo';
  if (canShorten) $('gizmo-shorten').textContent = 'До ' + display(Math.floor(ms(clash.starts_at)/minute)*minute) + ' на этом ПК';
  $('gizmo-other').hidden = !seat || !valid(start,end) || !fresh() || status==='free' || backend!=='gizmo';
  $('gizmo-reset').hidden = !!seat || !selected;
  const submit = $('gizmo-submit');
  submit.disabled = isBusy() || backend!=='gizmo' || (!fresh() ? !!pending : !valid(start,end) || !!seat && status!=='free');
  submit.textContent = !fresh() ? 'Обновить расписание' : !seat ? 'Показать свободные ПК' : 'Забронировать · ' + fmtRange(start,end);
  for (const id of ['gizmo-start','gizmo-end','gizmo-reset','gizmo-shorten','gizmo-other']) $(id).disabled = isBusy();
 }

 function setOptions(reset=false) {
  const from = $('gizmo-start'), to = $('gizmo-end'), now = today();
  const first = Math.ceil((now + 2 * minute)/(5 * minute))*5*minute;
  if (reset) {
   start = first;
   end = first + 60 * minute;
  }
  const starts = new Set([start]);
  for (let time=first; time<=now+day; time+=5*minute) starts.add(time);
  const ends = new Set([end]);
  for (let t=start+30*minute; t<=start+360*minute; t+=30*minute) ends.add(t);
  const options = (el, values, choice) => {
   el.replaceChildren(...[...values].sort((a,b)=>a-b).map(t=>new Option(display(t),t)));
   el.value=choice;
  };
  options(from,starts,start);
  options(to,ends,end);
 }

 async function updateSchedule() {
  if (backend !== 'gizmo' || !profile || pending) return pending;
  const sent = performance.now();
  pending = call('native_schedule').then(data=>{
   const received = performance.now(), server = ms(data.server_time);
   if (backend !== 'gizmo' || !data.ready || !Number.isFinite(server) || !Number.isFinite(data.valid_for_ms)) {
    sample = null;return;
   }
   const intervals = new Map();
   const seen = new Set();
   for (const r of data.reservations) {
    const key = JSON.stringify([r.host_id,ms(r.starts_at),ms(r.ends_at)]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!intervals.has(r.host_id)) intervals.set(r.host_id,[]);
    intervals.get(r.host_id).push(r);
   }
   for (const rows of intervals.values()) rows.sort((a,b)=>ms(a.starts_at)-ms(b.starts_at));
   sample = {server:server + received - sent, received, expires:sent + Math.min(30000,data.valid_for_ms),
    intervals, hosts:new Map(data.hosts.map(h=>[h.host_id,h]))};
  }).catch(()=>{sample=null}).finally(()=>{
   pending=null;
   if (backend==='gizmo' && !container.hidden && !valid(start,end)) setOptions();
   paint();
   renderHall();
  });
  paint();
  return pending;
 }

 function startPicking(id) {
  if (!profile || !tg?.initData) {toast('Сначала войди в аккаунт','err');return}
  if (isBusy()) return;
  seat = id;
  [start,end] = selected && valid(...selected) ? selected : [0,0];
  $('club-create').hidden = $('club-mine').hidden = true;
  $('club-pc').textContent = 'БРОНЬ';
  $('club-error').textContent = '';
  $('gizmo-seat').textContent = id ? hostName(id) : 'Когда играем?';
  container.hidden = false;
  setOptions(!start);
  open(id && document.querySelector(`#floor-map [data-hid="${CSS.escape(id)}"]`));
  paint();
  updateSchedule();
 }
 $('gizmo-start').onchange = e => {
  const duration = end-start;
  start = Number(e.target.value);
  end = start+duration;
  setOptions();paint();
 };
 $('gizmo-end').onchange = e => {end=Number(e.target.value);paint()};
 $('gizmo-shorten').onclick = () => {
  const clash = bookings(seat).find(r=>matches(r,start,end));
  if (!clash) return;
  end = Math.floor(ms(clash.starts_at)/minute)*minute;
  setOptions();paint();
 };
 const showMap = () => {
  selected = [start,end];
  sheet.close();
  paint();
  renderHall();
  switchZone('all');
 };
 $('gizmo-other').onclick = showMap;
 $('gizmo-reset').onclick = () => {selected=null;sheet.close();paint();renderHall()};
 $('gizmo-submit').onclick = async () => {
  if (isBusy() || backend!=='gizmo') return;
  if (!fresh()) {await updateSchedule();return}
  if (!valid(start,end)) {setOptions();paint();return}
  if (!seat) {showMap();return}
  if (availability(seat,start,end)!=='free') {paint();return}
  const id = seat, key = JSON.stringify([profile.gizmo_user_id,id,start,end]);
  if (request?.key!==key) request={key,id:crypto.randomUUID()};
  setBusy(true);paint();$('club-error').textContent='';
  try {
   const booking={id:request.id,host_id:id,starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString()};
   const result=await call('native_create',booking);
   request=null;
   await refresh();
   if (sheet.open) showMine({...booking,status:result.status});
   updateSchedule();
  } catch (error) {
   if (sheet.open) $('club-error').textContent=clubText(error.message)||'Не удалось отправить заявку. Проверьте «Мои брони».';
   await refresh();
   await updateSchedule();
  } finally {setBusy(false);paint()}
 };
 sheet.addEventListener('close',()=>{container.hidden=true});
 document.addEventListener('visibilitychange',()=>{
  if (!document.hidden && backend==='gizmo') {sample=null;paint();updateSchedule()}
 });

 return {
  setBackend(value) {
   if (value===backend) return;
   backend=value;
   if (value!=='gizmo') {sample=null;selected=null}
   paint();renderHall();
  },
  get enabled() {return backend!=='desk'},
  get filtered() {return !!selected && valid(...selected)},
  canFindAnother(from,to) {return backend==='gizmo' && valid(ms(from),ms(to))},
  findAnother(from,to) {
   [start,end]=[ms(from),ms(to)];
   showMap();
   updateSchedule();
  },
  open: startPicking, hide:()=>{container.hidden=true},
  poll() {paint();if (backend==='gizmo') return updateSchedule()},
  status(id, live) {
   if (selected && valid(...selected)) return availability(id,...selected);
   if (backend==='gizmo' && fresh() && live==='free' && bookings(id).some(r=>matches(r,today(),today()+1))) return 'reserved';
   return live;
  },
  upcoming(id) {
   const row = fresh() && bookings(id).find(r=>ms(r.starts_at)>today());
   return row ? 'Бронь с ' + display(ms(row.starts_at)) : '';
  },
 };
};
