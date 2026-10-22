/* Desk 3 shell: settings sections, the self-update box and icons for tabs added by modules. */
(()=>{
 // Settings: one section at a time instead of a long page.
 const tabs=[...document.querySelectorAll('.settings-tabs [data-settings]')];
 tabs.forEach(tab=>tab.onclick=()=>{
  tabs.forEach(t=>t.setAttribute('aria-selected',String(t===tab)));
  document.querySelectorAll('.settings-pane').forEach(p=>{const on=p.dataset.settings===tab.dataset.settings;p.hidden=!on;if(on){p.classList.remove('pane-in');void p.offsetWidth;p.classList.add('pane-in')}});
 });

 // Tabs injected later (e.g. «Анкеты») get the same icon + label layout as the rest of the sidebar.
 const icons={registrations:'<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'};
 for(const [name,path] of Object.entries(icons)){
  const tab=document.querySelector(`nav .tab[data-panel="${name}"]`);if(!tab||tab.querySelector('svg'))continue;
  const label=document.createElement('span');label.textContent=tab.textContent;tab.replaceChildren();
  tab.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`);tab.append(label);
 }

 // Self-update: check → download (verified) → install; Desk restarts by itself.
 const msg=$('update-message'),run=$('update-run'),check=$('update-check'),bar=$('update-progress');
 const texts={idle:'',checking:'Проверяем GitHub…',latest:'У вас последняя версия.',available:'Есть новая версия.',downloading:'Скачиваем обновление…',ready:'Обновление скачано.',installing:'Устанавливаем…'};
 window.renderUpdate=s=>{
  const u=s.update;if(!u)return;
  setDeskText($('update-current'),'v'+(u.current||s.version||DESK_BUILD.version));setDeskText($('update-latest'),u.latest?'v'+u.latest:'—');
  setDeskText(msg,u.phase==='error'?u.error:texts[u.phase]||'');msg.classList.toggle('error',u.phase==='error');
  bar.hidden=u.phase!=='downloading';bar.firstElementChild.style.width=(u.progress||0)+'%';
  run.hidden=!['available','ready'].includes(u.phase);setDeskText(run,u.phase==='ready'?'Установить и перезапустить':'Скачать обновление');
  check.disabled=['checking','downloading','installing'].includes(u.phase);run.disabled=['downloading','installing'].includes(u.phase);
  const dot=document.querySelector('nav .tab[data-panel="sound"]');dot?.classList.toggle('has-update',['available','ready'].includes(u.phase));
 };
 check.onclick=async()=>{check.disabled=true;setDeskText(msg,texts.checking);await invoke('check_update');await refresh()};
 run.onclick=async()=>{
  const phase=current?.update?.phase;
  if(phase==='available'){await invoke('download_update');return}
  if(phase==='ready'){const r=await invoke('install_update');if(r?.error)setDeskText(msg,r.error)}
 };
})();
