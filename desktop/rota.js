/* Club Management: Monthly admin rota calendar (Day 09-21 / Night 21-09 MSK). */
(() => {
 let currentRota = {};
 let currentYear = 2026, currentMonth = 10;
 const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

 function getMskTime() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000);
 }

 function getCurrentDuty(rota) {
  if (!rota || typeof rota !== 'object') return null;
  const msk = getMskTime();
  const hour = msk.getHours();
  let dateKey, shift;
  if (hour >= 9 && hour < 21) {
   dateKey = `${msk.getFullYear()}-${String(msk.getMonth()+1).padStart(2,'0')}-${String(msk.getDate()).padStart(2,'0')}`;
   shift = 'day';
  } else if (hour >= 21) {
   dateKey = `${msk.getFullYear()}-${String(msk.getMonth()+1).padStart(2,'0')}-${String(msk.getDate()).padStart(2,'0')}`;
   shift = 'night';
  } else {
   const yest = new Date(msk.getTime() - 86400000);
   dateKey = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
   shift = 'night';
  }
  const day = rota[dateKey];
  return day ? (day[shift] || null) : null;
 }

 function renderCalendar() {
  const container = document.getElementById('rota-days-container');
  const label = document.getElementById('rota-month-label');
  if (!container || !label) return;
  label.textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
  container.replaceChildren();

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const daysOfWeek = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  for (let d = 1; d <= daysInMonth; d++) {
   const dateStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
   const dayOfWeek = daysOfWeek[new Date(currentYear, currentMonth - 1, d).getDay()];
   const existing = currentRota[dateStr] || { day: '', night: '' };

   const row = document.createElement('div');
   row.className = 'rota-day-row';
   row.innerHTML = `
     <span class="rota-day-num">${d} <small>${dayOfWeek}</small></span>
     <div class="rota-shifts">
       <label title="09:00 – 21:00 МСК">
         <small>☀️ День (09–21)</small>
         <input type="text" class="rota-input" data-date="${dateStr}" data-shift="day" value="${existing.day || ''}" placeholder="Имя админа" maxlength="40">
       </label>
       <label title="21:00 – 09:00 МСК">
         <small>🌙 Ночь (21–09)</small>
         <input type="text" class="rota-input" data-date="${dateStr}" data-shift="night" value="${existing.night || ''}" placeholder="Имя админа" maxlength="40">
       </label>
     </div>
   `;
   container.append(row);
  }
 }

 function collectFromInputs() {
  const inputs = document.querySelectorAll('#rota-days-container .rota-input');
  inputs.forEach(inp => {
   const date = inp.dataset.date;
   const shift = inp.dataset.shift;
   const val = inp.value.trim();
   if (!currentRota[date]) currentRota[date] = { day: '', night: '' };
   currentRota[date][shift] = val;
   if (!currentRota[date].day && !currentRota[date].night) delete currentRota[date];
  });
  return currentRota;
 }

 window.initClubManagement = () => {
  const btnRoyal = document.getElementById('btn-royal-management');
  const rotaPanel = document.getElementById('club-rota-panel');
  const btnPrev = document.getElementById('rota-prev-month');
  const btnNext = document.getElementById('rota-next-month');
  const btnSave = document.getElementById('btn-save-rota');
  const btnPreview = document.getElementById('btn-preview-rota');
  const btnPublish = document.getElementById('btn-publish-rota');
  const btnImport = document.getElementById('btn-apply-rota-import');
  const status = document.getElementById('rota-status');
  if (!btnRoyal || !rotaPanel) return;

  btnRoyal.onclick = () => {
   const code = prompt('👑 Управление клубом: введите код доступа (с приколом 67):');
   if (code !== '67') {
    alert('Неверный код доступа. Действие отклонено.');
    return;
   }
   rotaPanel.hidden = false;
   btnRoyal.style.display = 'none';
   renderCalendar();
  };

  btnPrev?.addEventListener('click', () => {
   collectFromInputs();
   currentMonth--;
   if (currentMonth < 1) { currentMonth = 12; currentYear--; }
   renderCalendar();
  });

  btnNext?.addEventListener('click', () => {
   collectFromInputs();
   currentMonth++;
   if (currentMonth > 12) { currentMonth = 1; currentYear++; }
   renderCalendar();
  });

  btnPreview?.addEventListener('click', () => {
   collectFromInputs();
   const duty = getCurrentDuty(currentRota);
   if (status) {
    status.textContent = duty ? `Сейчас на смене (МСК): ${duty}` : 'Сейчас дежурный админ не назначен';
   }
  });

  btnSave?.addEventListener('click', async () => {
   collectFromInputs();
   if (status) status.textContent = 'Сохраняем график…';
   const res = await invoke('save_rota', currentRota, false);
   if (status) {
    status.textContent = res?.ok ? 'График дежурств сохранён локально' : (res?.error || 'Ошибка сохранения');
   }
  });

  btnPublish?.addEventListener('click', async () => {
   collectFromInputs();
   if (status) status.textContent = 'Публикуем в мини-приложение…';
   const res = await invoke('save_rota', currentRota, true);
   if (status) {
    status.textContent = res?.ok ? 'График дежурств опубликован в мини-приложение' : (res?.error || 'Ошибка публикации');
   }
  });

  btnImport?.addEventListener('click', () => {
   const text = document.getElementById('rota-import-text')?.value || '';
   const lines = text.split(/\r?\n/);
   let count = 0;
   for (const line of lines) {
    const parts = line.split(/[;,]/).map(s => s.trim());
    if (parts.length >= 2) {
     const dateRaw = parts[0];
     const m = dateRaw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
     if (m) {
      const dateKey = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      if (!currentRota[dateKey]) currentRota[dateKey] = { day: '', night: '' };
      currentRota[dateKey].day = parts[1] || '';
      if (parts[2]) currentRota[dateKey].night = parts[2];
      count++;
     }
    }
   }
   renderCalendar();
   if (status) status.textContent = `Импортировано записей: ${count}`;
  });
 };

 window.renderRotaSnapshot = (snapshot) => {
  if (snapshot?.rota && typeof snapshot.rota === 'object') {
   currentRota = snapshot.rota;
  }
 };
})();
