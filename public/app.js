/* ============================================================
   1SHOT — Telegram Mini App: логика
   - fetch() к бэкенду с x-telegram-init-data (проверяется HMAC'ом)
   - поллинг статусов каждые POLL_INTERVAL_MS (пока вкладка видна)
   ============================================================ */

"use strict";

const CFG = window.APP_CONFIG || {};
const API = (CFG.API_BASE || "").replace(/\/+$/, "");
const DURATIONS = (CFG.DURATIONS_MINUTES && CFG.DURATIONS_MINUTES.length)
  ? CFG.DURATIONS_MINUTES
  : [30, 60, 120, 240];
const POLL_MS = CFG.POLL_INTERVAL_MS || 10000;

const tg = window.Telegram && window.Telegram.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#0b0d12");
    tg.setBackgroundColor("#0b0d12");
  } catch (e) { /* старые версии клиента */ }
}

const initData = (tg && tg.initData) || "";
const $ = (id) => document.getElementById(id);

document.getElementById("club-name").textContent = CFG.CLUB_NAME || "1SHOT";

/* ------------------------------ Состояние ------------------------------ */

const state = {
  hosts: [],
  reservations: [],
  sheetHost: null,
  duration: DURATIONS.includes(60) ? 60 : DURATIONS[0],
  busy: false,
};

/* ------------------------------ Утилиты ------------------------------ */

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function haptic(type) {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (type === "error") tg.HapticFeedback.notificationOccurred("error");
    else if (type === "success") tg.HapticFeedback.notificationOccurred("success");
    else tg.HapticFeedback.impactOccurred("light");
  } catch (e) { /* не критично */ }
}

let toastTimer = null;
function toast(msg, kind = "info", ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast toast--${kind === "info" ? "info" : kind}`;
  // принудительный reflow, чтобы анимация повторилась при следующем показе
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function setBanner(html, show) {
  const b = $("banner");
  b.innerHTML = html;
  b.classList.toggle("hidden", !show);
}

/* ------------------------------ API ------------------------------ */

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": initData,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* нет JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Ошибка ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------ Загрузка ------------------------------ */

async function loadHosts() {
  const data = await api("/hosts");
  state.hosts = (data.hosts || []).slice().sort((a, b) => {
    const an = a.number == null ? Infinity : a.number;
    const bn = b.number == null ? Infinity : b.number;
    if (an !== bn) return an - bn;
    return String(a.name).localeCompare(String(b.name), "ru");
  });
  if (data.warning) setBanner(`⚠️ ${esc(data.warning)}`, true);
  renderGrid();
  renderSummary();
}

async function loadMy() {
  const data = await api("/my-reservations");
  state.reservations = data.reservations || [];
  renderMy();
  renderGrid();
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    await Promise.allSettled([loadHosts(), loadMy()]);
  } finally {
    state.busy = false;
  }
}

/* ------------------------------ Рендер ------------------------------ */

function myHostIds() {
  return new Set(state.reservations.map((r) => r.hostId));
}

function renderSummary() {
  const free = state.hosts.filter((h) => h.isFree && !myHostIds().has(h.id)).length;
  const busy = state.hosts.length - free;
  $("summary").innerHTML =
    `<span><i class="dot dot--green"></i><b>${free}</b> свободно</span>` +
    `<span><i class="dot dot--red"></i><b>${busy}</b> занято</span>` +
    `<span><i class="dot dot--gray"></i><b>${state.hosts.length}</b> всего</span>`;
}

function renderGrid() {
  const grid = $("grid");
  if (!state.hosts.length) {
    grid.innerHTML = '<div class="loading">Загрузка компьютеров…</div>';
    return;
  }
  const mine = myHostIds();
  grid.innerHTML = state.hosts.map((h) => {
    let cls = "hostcard--offline";
    let label = "Не в сети";
    if (mine.has(h.id)) {
      cls = "hostcard--mine";
      label = "Ваша бронь";
    } else if (h.isOutOfOrder) {
      cls = "hostcard--ooo";
      label = "В ремонте";
    } else if (h.isLocked) {
      cls = "hostcard--busy";
      label = "Недоступен";
    } else if (h.isFree) {
      cls = "hostcard--free";
      label = "Свободен";
    } else {
      cls = "hostcard--busy";
      label = "Занят";
    }
    return (
      `<div class="hostcard ${cls}" data-id="${h.id}">` +
      `<div class="hostcard__top"><span class="hostcard__dot"></span>` +
      `<span class="hostcard__name">${esc(h.name)}</span></div>` +
      `<div class="hostcard__meta">${h.groupId != null ? `группа ${esc(h.groupId)}` : ""}</div>` +
      `<div class="hostcard__status">${label}</div>` +
      `</div>`
    );
  }).join("");
}

function renderMy() {
  const box = $("my-list");
  if (!state.reservations.length) {
    box.innerHTML =
      '<div class="mylist__empty">Активных броней нет.<br>Выберите свободный компьютер ниже.</div>';
    return;
  }
  box.innerHTML = state.reservations.map((r) => (
    `<div class="mycard" data-id="${r.id}">` +
    `<div class="mycard__info">` +
    `<div class="mycard__host">${esc(r.hostName)}</div>` +
    `<div class="mycard__time">${fmtTime(r.startsAt)} — ${fmtTime(r.endsAt)}</div>` +
    `</div>` +
    (r.pin ? `<div class="mycard__pin" title="PIN для входа на комп">${esc(r.pin)}</div>` : "") +
    `<button class="btn-cancel" type="button">Отменить</button>` +
    `</div>`
  )).join("");
}

function renderGreeting() {
  const g = $("greeting");
  g.textContent = "";
  if (!tg || !initData) return;
  try {
    const params = new URLSearchParams(initData);
    const user = JSON.parse(decodeURIComponent(params.get("user") || "{}"));
    if (user.first_name) g.textContent = `Привет, ${user.first_name}!`;
  } catch (e) { /* ок */ }
}

/* ------------------------------ Шторка брони ------------------------------ */

function chipLabel(min) {
  return min < 60 ? `${min} мин` : fmtDuration(min);
}

function openSheet(host) {
  state.sheetHost = host;
  $("sheet-title").textContent = "Забронировать";
  $("sheet-host").innerHTML = `Компьютер <b>${esc(host.name)}</b> — свободно`;
  $("chips").innerHTML = DURATIONS.map(
    (m) => `<button class="chip ${m === state.duration ? "active" : ""}" type="button" data-min="${m}">${chipLabel(m)}</button>`
  ).join("");
  $("sheet-error").classList.add("hidden");
  updateSheetEnds();
  $("sheet").classList.add("open");
  $("backdrop").classList.remove("hidden");
  haptic("tap");
}

function closeSheet() {
  state.sheetHost = null;
  $("sheet").classList.remove("open");
  $("backdrop").classList.add("hidden");
}

function updateSheetEnds() {
  const start = new Date();
  const end = new Date(start.getTime() + state.duration * 60000);
  $("sheet-ends").innerHTML =
    `Бронь с <b>${fmtTime(start.toISOString())}</b> до <b>${fmtTime(end.toISOString())}</b> · ${fmtDuration(state.duration)}`;
}

async function confirmBooking() {
  if (!state.sheetHost || state.busy) return;
  const btn = $("btn-confirm");
  btn.disabled = true;
  btn.textContent = "Бронируем…";
  $("sheet-error").classList.add("hidden");
  try {
    const res = await api("/reserve", {
      method: "POST",
      body: { hostId: state.sheetHost.id, durationMinutes: state.duration },
    });
    closeSheet();
    haptic("success");
    toast(`Готово! ${res.hostName} до ${fmtTime(res.endsAt)}. PIN для входа: ${res.pin}`, "ok", 5000);
    await Promise.allSettled([loadMy(), loadHosts()]);
  } catch (e) {
    haptic("error");
    const box = $("sheet-error");
    box.textContent = e.message || "Не удалось забронировать";
    box.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Забронировать";
  }
}

async function cancelReservation(id) {
  if (!window.confirm("Отменить бронь?")) return;
  try {
    await api("/cancel-reservation", { method: "POST", body: { id } });
    haptic("success");
    toast("Бронь отменена", "ok");
    await loadMy();
  } catch (e) {
    haptic("error");
    toast(e.message || "Не удалось отменить", "err");
  }
}

/* ------------------------------ События ------------------------------ */

$("grid").addEventListener("click", (e) => {
  const card = e.target.closest(".hostcard");
  if (!card) return;
  const id = Number(card.dataset.id);
  const host = state.hosts.find((h) => h.id === id);
  if (!host) return;
  if (myHostIds().has(id)) {
    toast("У вас уже есть бронь на этот компьютер", "info");
    return;
  }
  if (!host.isFree) {
    haptic("error");
    toast(host.isOutOfOrder ? "Компьютер в ремонте" : "Компьютер сейчас недоступен", "err", 2200);
    return;
  }
  openSheet(host);
});

$("chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.duration = Number(chip.dataset.min);
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  updateSheetEnds();
  haptic("tap");
});

$("btn-confirm").addEventListener("click", confirmBooking);
$("backdrop").addEventListener("click", closeSheet);

$("my-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-cancel");
  if (!btn) return;
  const card = btn.closest(".mycard");
  cancelReservation(Number(card.dataset.id));
});

$("btn-refresh").addEventListener("click", async () => {
  const b = $("btn-refresh");
  b.classList.add("spinning");
  await tick();
  b.classList.remove("spinning");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
window.addEventListener("focus", () => tick());

/* ------------------------------ Старт ------------------------------ */

(async function init() {
  if (API.includes("YOUR_PROJECT_REF")) {
    setBanner("⚙️ Не настроено: отредактируйте API_BASE в <b>public/config.js</b> (URL Supabase) и пересоберите страницу.", true);
  }
  if (!initData) {
    setBanner("⚠️ Это приложение открывается только из Telegram.", true);
  }
  renderGreeting();
  $("footer").textContent = `Статусы обновляются каждые ${Math.round(POLL_MS / 1000)} с · оплата на месте при входе`;

  if (!initData || API.includes("YOUR_PROJECT_REF")) return;

  try {
    await tick();
  } catch (e) {
    setBanner(`⚠️ ${esc(e.message || "Не удалось загрузить данные")}`, true);
  }
  setInterval(() => {
    if (!document.hidden) tick();
  }, POLL_MS);
})();
