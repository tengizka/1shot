/* Stable local editor: polling cannot replace an unsaved draft. */
(() => {
 const section=document.createElement('section');section.className='surface reminder-settings';
 section.innerHTML='<h3>Напоминания</h3><p class="note">После запуска Desk интервал отсчитывается заново. Пропущенные сигналы не накапливаются.</p><form id="reminder-form"><div id="reminder-editors"></div><div class="actions"><button type="button" id="reminder-add">Добавить</button><button type="submit">Сохранить напоминания</button><button type="button" id="reminder-reload">Отменить изменения</button></div></form><p id="reminder-message" role="status"></p>';
 (document.querySelector('.settings-pane[data-settings="alerts"]')||$('panel-sound')).append(section);
 let revision=null,latest=null,dirty=false,busy=false;
 const fields=$('reminder-editors'),form=$('reminder-form'),message=$('reminder-message');
 function row(item){
  const box=document.createElement('fieldset');box.dataset.id=item.id;
  box.innerHTML='<legend>Напоминание</legend><label>Текст<input name="text" maxlength="140" required></label><label>Интервал, минут<input name="minutes" type="number" min="1" max="10080" required></label><label>Звук<select name="sound"></select></label><label class="check"><input name="enabled" type="checkbox"> Включено</label><div class="actions"><button type="button" class="reminder-preview">Прослушать</button><button type="button" class="reminder-remove">Удалить</button></div>';
  for(const name of ['text','minutes'])box.querySelector(`[name=${name}]`).value=item[name];
  const select=box.querySelector('select');select.innerHTML='<option value="none">Без звука</option>'+$('sound-preset').innerHTML;select.value=item.sound;
  box.querySelector('[name=enabled]').checked=item.enabled;
  box.querySelector('.reminder-remove').onclick=()=>{if(busy)return;box.remove();dirty=true};
  box.querySelector('.reminder-preview').onclick=async()=>{if(select.value==='none')return;const result=await invoke('preview_reminder',select.value);message.textContent=result?.ok?'':result?.error||'Не удалось воспроизвести звук'};
  fields.append(box);
 }
 function load(){if(!latest)return;revision=latest.revision;fields.replaceChildren();latest.items.forEach(row);dirty=false;message.textContent=''}
 form.addEventListener('input',()=>dirty=true);form.addEventListener('change',()=>dirty=true);
 $('reminder-add').onclick=()=>{if(busy||revision===null)return;if(fields.children.length>=20){message.textContent='Не больше 20 напоминаний';return}row({id:crypto.randomUUID(),text:'',minutes:150,enabled:true,sound:'soft'});dirty=true};
 $('reminder-reload').onclick=()=>{if(!busy&&(!dirty||confirm('Отменить несохранённые изменения?')))load()};
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||revision===null)return;
  const items=[...fields.children].map(box=>({id:box.dataset.id,text:box.querySelector('[name=text]').value.trim(),minutes:Number(box.querySelector('[name=minutes]').value),sound:box.querySelector('[name=sound]').value,enabled:box.querySelector('[name=enabled]').checked}));
  busy=true;form.querySelectorAll('input,select,button').forEach(e=>e.disabled=true);
  try{const r=await invoke('reminder_settings',items,revision);if(r?.ok){latest=r.reminders.config;load();message.textContent='Напоминания сохранены'}else message.textContent=r?.error||'Нет подтверждения. Черновик сохранён; обновите список перед повтором'}
  finally{busy=false;form.querySelectorAll('input,select,button').forEach(e=>e.disabled=false)}
 };
 window.renderReminders=s=>{
  if(s.reminders){latest=s.reminders.config;if(!busy&&!dirty&&revision!==latest.revision)load()}
  if(s.reminder_error)message.textContent=s.reminder_error;
  // Fired reminders appear once as on-screen notices (Python side); nothing piles up here.
 };
})();
