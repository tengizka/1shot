(() => {
 const run = $('regulars-run');
 const visits = $('regulars-visits');
 const spend = $('regulars-spend');
 const status = $('regulars-status');
 const results = $('regulars-results');
 const groups = results.querySelectorAll('[data-regulars]');
 const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'});
 let selected = 'active';
 let report = null;

 function date(value) {
  return value.split('-').reverse().join('.');
 }

 function renderGroup() {
  for (const button of groups) {
   const key = button.dataset.regulars;
   const title = key === 'active' ? 'Постоянники' : 'Спящие постоянники';
   button.textContent = title + ' · ' + report[key].length;
   button.setAttribute('aria-pressed', String(key === selected));
  }
  const rows = document.createDocumentFragment();
  for (const guest of report[selected]) {
   const row = document.createElement('tr');
   for (const value of [guest.first_name, guest.last_name, guest.username, guest.phone,
    guest.visits, money.format(guest.spent), date(guest.last_visit),
    date(guest.period_start) + ' – ' + date(guest.period_end)]) {
    const cell = document.createElement('td');
    cell.textContent = value || '—';
    row.append(cell);
   }
   rows.append(row);
  }
  $('regulars-rows').replaceChildren(rows);
  $('regulars-empty').hidden = report[selected].length > 0;
  $('regulars-table').hidden = report[selected].length === 0;
 }

 for (const button of groups) {
  button.onclick = () => {
   selected = button.dataset.regulars;
   renderGroup();
  };
 }

 async function waitForReport() {
  try {
   const state = await window.pywebview.api.regulars_state();
   if (state.busy) {
    setTimeout(waitForReport, 750);
    return;
   }
   if (state.error) throw new Error(state.error);
   report = state.result;
   renderGroup();
   results.hidden = false;
   status.textContent = state.synced
    ? 'Список готов. Сводка отправлена в базу.'
    : 'Список готов. База не подтвердила сохранение сводки.';
  } catch (error) {
   status.textContent = error.message || 'Не удалось открыть отчёт.';
  }
  run.disabled = false;
 }

 run.onclick = async () => {
  if (!visits.reportValidity() || !spend.reportValidity()) return;
  run.disabled = true;
  results.hidden = true;
  $('regulars-rows').replaceChildren();
  report = null;
  status.textContent = 'Собираем визиты и траты из Gizmo…';
  try {
   const state = await window.pywebview.api.start_regulars(visits.valueAsNumber, spend.valueAsNumber);
   if (state.error) {
    status.textContent = state.error;
    run.disabled = false;
    return;
   }
  } catch {
   status.textContent = 'Не удалось запустить сбор отчёта.';
   run.disabled = false;
   return;
  }
  await waitForReport();
 };
})();
