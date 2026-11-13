/* «Заметки»: the shift's own notes on this Desk — what to remember, buy or hand over. Tick off when done. */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='notes';tab.textContent='Заметки';tab.onclick=()=>{panel('notes');load()};
 document.querySelector('nav').insertBefore(tab,document.querySelector('nav [data-panel="sound"]'));
 const section=document.createElement('section');section.id='panel-notes';section.hidden=true;
 section.innerHTML=`<div class="page-head"><h2>Заметки</h2></div>
  <form class="surface note-form" id="note-form"><textarea id="note-text" rows="3" maxlength="2000" placeholder="Что нужно запомнить или передать смене" enterkeyhint="done"></textarea><button type="submit" id="note-add" disabled>Добавить</button></form>
  <div id="note-list" class="note-list"></div>
  <button type="button" id="note-done-toggle" class="history-toggle" aria-expanded="false" hidden></button>
  <div id="note-done" class="note-list" hidden></div>`;
 document.querySelector('main').append(section);
 const text=section.querySelector('#note-text'),add=section.querySelector('#note-add'),list=section.querySelector('#note-list'),doneList=section.querySelector('#note-done'),toggle=section.querySelector('#note-done-toggle');
 const when=v=>new Date(v*1000).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 // Enter only closes the keyboard (Done); the note is added with the button.
 text.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();text.blur()}});
 text.oninput=()=>add.disabled=!text.value.trim();
 function row(n){
  const item=document.createElement('article');item.className='note-item'+(n.done?' done':'');
  const check=document.createElement('button');check.type='button';check.className='note-check';check.setAttribute('aria-pressed',String(!!n.done));check.setAttribute('aria-label',n.done?'Вернуть в работу':'Готово');
  const body=document.createElement('div');body.className='note-body';const p=document.createElement('p');p.textContent=n.text;const small=document.createElement('small');small.textContent=when(n.at)+(n.edited?' · изменена '+when(n.edited):'');body.append(p,small);
  const del=document.createElement('button');del.type='button';del.className='danger note-del';del.textContent='Удалить';
  check.onclick=async()=>show((await invoke('save_note',n.id,'',!n.done))?.notes);
  del.onclick=()=>armTap(del,'Точно?',async()=>show((await invoke('delete_note',n.id))?.notes));
  p.ondblclick=()=>{ // double click edits in place
   const area=document.createElement('textarea');area.value=n.text;area.maxLength=2000;area.rows=3;area.setAttribute('enterkeyhint','done');p.replaceWith(area);area.focus();
   area.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();area.blur()}});
   area.onblur=async()=>{const v=area.value.trim();if(v&&v!==n.text)show((await invoke('save_note',n.id,v))?.notes);else area.replaceWith(p)};
  };
  item.append(check,body,del);return item;
 }
 function show(notes){
  if(!Array.isArray(notes))return;
  const open=notes.filter(n=>!n.done),done=notes.filter(n=>n.done);
  list.replaceChildren(...(open.length?open.map(row):[Object.assign(document.createElement('p'),{className:'empty',textContent:'Заметок нет'})]));
  doneList.replaceChildren(...done.map(row));toggle.hidden=!done.length;toggle.textContent='Сделано · '+done.length;
 }
 toggle.onclick=()=>{doneList.hidden=!doneList.hidden;toggle.setAttribute('aria-expanded',String(!doneList.hidden))};
 async function load(){show((await invoke('notes'))?.notes)}
 section.querySelector('#note-form').onsubmit=async e=>{e.preventDefault();const v=text.value.trim();if(!v)return;add.disabled=true;const r=await invoke('save_note',null,v);if(r?.ok){text.value='';show(r.notes)}else add.disabled=false};
 window.addEventListener('pywebviewready',load);
})();
