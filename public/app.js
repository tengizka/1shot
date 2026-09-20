/* ============================================================
   1SHOT · КИБЕРХАУС — логика мини-аппа
   - два вида: карта зала (CLUB_MAP) и список по зонам (CFG.ZONES)
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
const ZONES = (CFG.ZONES && CFG.ZONES.length)
  ? CFG.ZONES
  : [{ key: "all", title: "Компьютеры", accent: "purple", fallback: true }];
const MAP = window.CLUB_MAP || { areas: [], lines: [], machines: [] };

const tg = window.Telegram && window.Telegram.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#000004");
    tg.setBackgroundColor("#000004");
  } catch (e) { /* старые версии клиента */ }
}

const initData = (tg && tg.initData) || "";
const DEMO = !initData && API.includes("YOUR_PROJECT_REF");
const $ = (id) => document.getElementById(id);

/* ------------------------------ Состояние ------------------------------ */

const state = {
  hosts: [],
  reservations: [],
  sheetHost: null,
  duration: DURATIONS.includes(60) ? 60 : DURATIONS[0],
  busy: false,
  view: "map",
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
  t.className = `toast ${kind === "info" ? "" : `toast--${kind}`}`;
  void t.offsetWidth; // reflow, чтобы анимация повторилась
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function setBanner(html, show) {
  const b = $("banner");
  b.innerHTML = html;
  b.classList.toggle("hidden", !show);
}

/* ------------------------------ Зоны ------------------------------ */

/** Определяет зону машины: сначала по группе Gizmo, затем по номеру. */
function zoneFor(host) {
  for (const z of ZONES) {
    if (z.groupIds && host.groupId != null && z.groupIds.includes(host.groupId)) return z;
  }
  for (const z of ZONES) {
    if (z.numbers && host.number != null && z.numbers.includes(host.number)) return z;
    if (z.ranges && host.number != null && z.ranges.some(([a, b]) => host.number >= a && host.number <= b)) return z;
  }
  return ZONES.find((z) => z.fallback) || ZONES[ZONES.length - 1];
}

function myHostIds() {
  return new Set(state.reservations.map((r) => r.hostId));
}

/** Служебное имя машины: номер из Gizmo либо из name ("PC-01" → 1). */
function hostDisplayNum(host) {
  if (host.number != null) return host.number;
  const m = String(host.name || "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------ API ------------------------------ */

async function api(path, opts = {}) {
  // Демо никогда не обращается к сети и не создаёт настоящие брони.
  if (DEMO) {
    if (path === "/hosts") return { hosts: state.hosts };
    if (path === "/my-reservations") return { reservations: state.reservations };
    if (path === "/cancel-reservation") {
      state.reservations = state.reservations.filter(r => r.id !== opts.body.id);
      return { ok: true };
    }
    if (path === "/reserve") {
      const host = state.hosts.find(h => h.id === opts.body.hostId);
      if (!host?.isFree || myHostIds().has(host.id)) throw new Error("Место недоступно");
      const reservation = {
        id: Date.now(), hostId: host.id, hostName: host.name, pin: "1234",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + opts.body.durationMinutes * 60000).toISOString(),
      };
      state.reservations.push(reservation);
      return reservation;
    }
    throw new Error("Недоступно в демо");
  }
  if (!initData || API.includes("YOUR_PROJECT_REF")) throw new Error("Откройте настроенное приложение в Telegram");
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
  renderAll();
}

async function loadMy() {
  const data = await api("/my-reservations");
  state.reservations = data.reservations || [];
  renderMy();
  renderAll();
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const results = await Promise.allSettled([loadHosts(), loadMy()]);
    const error = results.find(r => r.status === "rejected");
    if (error) setBanner(esc(error.reason.message || "Ошибка подключения"), true);
  } finally {
    state.busy = false;
  }
}

/* ------------------------------ Рендер: общее ------------------------------ */

function renderAll() {
  renderSummary();
  renderMap();
  renderList();
}

function renderSummary() {
  const mine = myHostIds();
  const free = state.hosts.filter((h) => h.isFree && !mine.has(h.id)).length;
  const busy = state.hosts.filter(h => !h.isFree && !h.isOutOfOrder && h.status !== 0).length;
  $("summary").innerHTML =
    `<span><i class="dot dot--free"></i><b>${free}</b> свободно</span>` +
    `<span><i class="dot dot--busy"></i><b>${busy}</b> занято</span>` +
    `<span><b>${state.hosts.length}</b> всего</span>`;
}

/* ------------------------------ Рендер: карта ------------------------------ */

function buildMapStatic() {
  // Зоны
  $("map-areas").innerHTML = (MAP.areas || []).map((a) => (
    `<div class="area area--${a.accent}" style="left:${a.x}%;top:${a.y}%;width:${a.w}%;height:${a.h}%">` +
    (a.label ? `<span class="area__label">${esc(a.label)}</span>` : "") +
    `</div>`
  )).join("");

  // Линии
  $("map-lines").innerHTML = (MAP.lines || []).map((l) => {
    if (l.type === "v") {
      return `<div class="mline mline--v mline--${l.color}" style="left:${l.at}%;top:${l.from}%;height:${l.to - l.from}%"></div>`;
    }
    return `<div class="mline mline--h mline--${l.color}" style="top:${l.at}%;left:${l.from}%;width:${l.to - l.from}%"></div>`;
  }).join("");
}

function renderMap() {
  const mine = myHostIds();
  const byNum = new Map();
  for (const h of state.hosts) {
    const n = hostDisplayNum(h);
    if (n != null && !byNum.has(n)) byNum.set(n, h);
  }

  let nodes = "";
  const mappedIds = new Set();
  for (const m of MAP.machines) {
    const host = byNum.get(m.n);
    if (host) mappedIds.add(host.id);
    let statusCls;
    if (!host) statusCls = "node--offline";
    else if (mine.has(host.id)) statusCls = "node--mine";
    else if (host.isOutOfOrder) statusCls = "node--ooo";
    else if (host.isLocked) statusCls = "node--busy";
    else if (host.isFree) statusCls = "node--free";
    else if (host.status === 0 || host.isOnline === false) statusCls = "node--offline";
    else statusCls = "node--busy";
    const cls = (m.n === 1 ? "node--ps5 " : "") + statusCls;
    nodes += (
      `<button type="button" aria-label="Место ${m.n}" class="node ${cls}" style="left:${m.x}%;top:${m.y}%" ` +
      (host ? `data-id="${host.id}"` : "data-unknown") +
      `><span>${esc(m.n)}</span></button>`
    );
  }
  $("map-nodes").innerHTML = nodes;

  // Машин в Gizmo, которых нет на карте → подсказка
  const extra = state.hosts.filter((h) => !mappedIds.has(h.id));
  const box = $("map-extra");
  if (state.hosts.length && extra.length) {
    box.classList.remove("hidden");
    box.innerHTML = `Ещё ${extra.length} машина(ы) вне карты — см. «Список»: ` +
      extra.map((h) => esc(hostDisplayNum(h) ?? h.name)).join(", ");
  } else {
    box.classList.add("hidden");
  }
}

/* ------------------------------ Рендер: список ------------------------------ */

function cardHtml(host) {
  const mine = myHostIds().has(host.id);
  let cls, label;
  if (mine) { cls = "hostcard--mine"; label = "Ваша бронь"; }
  else if (host.isOutOfOrder) { cls = "hostcard--ooo"; label = "В ремонте"; }
  else if (host.isLocked) { cls = "hostcard--busy"; label = "Недоступен"; }
  else if (host.isFree) { cls = "hostcard--free"; label = "Свободен"; }
  else if (host.isOnline === false || host.status === 0) { cls = "hostcard--offline"; label = "Не в сети"; }
  else { cls = "hostcard--busy"; label = "Занят"; }

  const num = hostDisplayNum(host);
  const title = num != null ? `#${num}` : host.name;
  return (
    `<button type="button" class="hostcard ${cls}" data-id="${host.id}">` +
    `<div class="hostcard__top"><span class="hostcard__dot"></span>` +
    `<span class="hostcard__name">${esc(title)}</span></div>` +
    `<div class="hostcard__meta">${esc(host.name)}</div>` +
    `<div class="hostcard__status">${label}</div>` +
    `</button>`
  );
}

function renderList() {
  const groups = new Map();
  for (const z of ZONES) groups.set(z.key, []);
  const other = [];
  for (const h of state.hosts) {
    const z = zoneFor(h);
    if (groups.has(z.key)) groups.get(z.key).push(h);
    else other.push(h);
  }

  let html = "";
  for (const [key, list] of groups) {
    if (!list.length) continue;
    const z = ZONES.find((x) => x.key === key);
    html += (
      `<section class="zone zone--${z.accent}">` +
      `<div class="zone__head">` +
      `<span class="spark spark--${z.accent}"></span>` +
      `<span class="zone__title">${esc(z.title)}</span>` +
      (z.subtitle ? `<span class="zone__sub">${esc(z.subtitle)}</span>` : "") +
      `</div>` +
      `<div class="grid">${list.map(cardHtml).join("")}</div>` +
      `</section>`
    );
  }
  if (other.length) {
    html += (
      `<section class="zone zone--red">` +
      `<div class="zone__head"><span class="spark spark--red"></span><span class="zone__title">Другие</span></div>` +
      `<div class="grid">${other.map(cardHtml).join("")}</div>` +
      `</section>`
    );
  }
  if (!html) {
    html = '<div class="loading">Загрузка компьютеров…</div>';
  }
  $("view-list").innerHTML = html;
}

/* ------------------------------ Рендер: мои брони ------------------------------ */

function renderMy() {
  const box = $("my-list");
  if (!state.reservations.length) {
    box.innerHTML =
      '<div class="mylist__empty">Активных броней нет.<br>Выберите свободный компьютер на карте.</div>';
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
    const user = JSON.parse(params.get("user") || "{}");
    if (user.first_name) g.textContent = `Привет, ${user.first_name}`;
  } catch (e) { /* ок */ }
}

/* ------------------------------ Шторка брони ------------------------------ */

function chipLabel(min) {
  return min < 60 ? `${min} мин` : fmtDuration(min);
}

function openSheet(host) {
  state.sheetHost = host;
  const z = zoneFor(host);
  const num = hostDisplayNum(host);
  $("sheet-title").textContent = "Бронь";
  $("sheet-host").innerHTML =
    `<b>${num != null ? "#" + esc(num) : esc(host.name)}</b> · ${esc(z.title)}`;
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
    `с <b>${fmtTime(start.toISOString())}</b> до <b>${fmtTime(end.toISOString())}</b> · ${fmtDuration(state.duration)}`;
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
    toast(`Готово! ${res.hostName} до ${fmtTime(res.endsAt)}. PIN: ${res.pin}`, "ok", 5200);
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

document.addEventListener("click", (e) => {
  // Ноды карты
  const node = e.target.closest(".node[data-id]");
  // Карточки списка
  const card = e.target.closest(".hostcard");
  const target = node || card;
  if (!target) return;
  const id = Number(target.dataset.id);
  const host = state.hosts.find((h) => h.id === id);
  if (!host) return;
  const mine = myHostIds().has(id);
  if (mine) {
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

document.addEventListener("click", (e) => {
  const cancelBtn = e.target.closest(".btn-cancel");
  if (cancelBtn) {
    const card = cancelBtn.closest(".mycard");
    cancelReservation(Number(card.dataset.id));
  }
});

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.duration = Number(chip.dataset.min);
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  updateSheetEnds();
  haptic("tap");
});

$("btn-confirm").addEventListener("click", confirmBooking);
$("backdrop").addEventListener("click", closeSheet);

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  state.view = tab.dataset.view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  $("view-map").classList.toggle("hidden", state.view !== "map");
  $("view-list").classList.toggle("hidden", state.view !== "list");
  haptic("tap");
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
  buildMapStatic();
  if (DEMO) {
    state.hosts = MAP.machines.map(m => ({
      id: m.n, number: m.n, name: m.n === 1 ? "PlayStation 5" : `ПК ${m.n}`,
      isFree: ![14,15,21,23,24,25,101,104,302].includes(m.n),
      isOutOfOrder: [25,101].includes(m.n),
      status: [25,101].includes(m.n) ? 0 : [14,15,21,23,24,104,302].includes(m.n) ? 2 : 1,
    }));
    setBanner("ДЕМО ДИЗАЙНА · Статусы примерные, брони ненастоящие", true);
    renderAll();
    renderMy();
    $("greeting").textContent = "Твой следующий GG";
    $("addr").textContent = "Киберхаус / 1SHOT";
    $("footer").textContent = "Выберите место · Оплата на кассе при посещении";
    return;
  }
  renderAll();
  $("addr").textContent = CFG.CLUB_ADDRESS || "";

  if (API.includes("YOUR_PROJECT_REF")) {
    setBanner("⚙️ Не настроено: впишите API_BASE в <b>public/config.js</b> (URL Supabase).", true);
  }
  if (!initData) {
    setBanner("⚠️ Это приложение открывается только из Telegram.", true);
  }
  renderGreeting();
  $("footer").textContent =
    `1shot · киберхаус · круглосуточно — статусы обновляются каждые ${Math.round(POLL_MS / 1000)} с`;

  if (!initData || API.includes("YOUR_PROJECT_REF")) {
    renderMy();
    return;
  }

  try {
    await tick();
  } catch (e) {
    setBanner(`⚠️ ${esc(e.message || "Не удалось загрузить данные")}`, true);
  }
  setInterval(() => {
    if (!document.hidden) tick();
  }, POLL_MS);
})();
