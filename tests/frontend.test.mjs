// Смоук-тест фронтенда: запускаем config.js + map-data.js + app.js в stub-DOM
// и проверяем зоны, карту и список. (разовая проверка, не входит в npm test)
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const elements = {};
function makeEl(id) {
  return {
    id,
    innerHTML: "",
    get textContent() { return this.innerHTML; },
    set textContent(v) { this.innerHTML = String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); },
    className: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
  };
}
const sandbox = {
  console,
  URLSearchParams,
  fetch: async () => new Response(JSON.stringify({ hosts: [], reservations: [] }), { status: 200 }),
  window: { confirm: () => true, addEventListener() {} },
  document: {
    getElementById: (id) => (elements[id] ||= makeEl(id)),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    querySelectorAll: () => [],
  },
};
sandbox.window.document = sandbox.document;
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync("public/config.js", "utf8"), ctx, { filename: "config.js" });
vm.runInContext(fs.readFileSync("public/map-data.js", "utf8"), ctx, { filename: "map-data.js" });
vm.runInContext(fs.readFileSync("public/app.js", "utf8"), ctx, { filename: "app.js" });

// 1) Зоны
const zones = JSON.parse(vm.runInContext(`
  JSON.stringify([
    zoneFor({id: 1, number: 1, name: "PS5"}).key,
    zoneFor({id: 2, number: 11, name: "PC-11"}).key,
    zoneFor({id: 3, number: 15, name: "PC-15"}).key,
    zoneFor({id: 4, number: 25, name: "PC-25"}).key,
    zoneFor({id: 5, number: 101, name: "PC-101"}).key,
    zoneFor({id: 6, number: 208, name: "PC-208"}).key,
    zoneFor({id: 7, number: 302, name: "PC-302"}).key,
    zoneFor({id: 8, number: 404, name: "PC-404"}).key,
    zoneFor({id: 9, number: 999, name: "PC-X"}).key,
  ])
`, ctx));
assert.deepEqual(zones, ["ps5", "vip", "vip", "vip", "main", "main", "main", "main", "main"]);
console.log("zones: OK", zones.join(","));

// 2) Машина, заданная groupIds зоны, переопределяет нумерацию
const groupOverride = vm.runInContext(`
  window.APP_CONFIG.ZONES.find(z => z.key === "vip").groupIds = [77];
  zoneFor({id: 10, number: 101, name: "PC-101", groupId: 77}).key
`, ctx);
assert.equal(groupOverride, "vip");
console.log("groupIds override: OK");

// 3) Рендер карты и списка
vm.runInContext(`
  state.hosts = [
    {id: 101, number: 1,   name: "PS5",     isFree: true,  isOutOfOrder: false, isLocked: false, isOnline: true,  status: 1},
    {id: 111, number: 11,  name: "PC-11",   isFree: true,  isOutOfOrder: false, isLocked: false, isOnline: true,  status: 1},
    {id: 121, number: 12,  name: "PC-12",   isFree: false, isOutOfOrder: false, isLocked: false, isOnline: true,  status: 2},
    {id: 131, number: 204, name: "PC-204",  isFree: false, isOutOfOrder: true,  isLocked: false, isOnline: true,  status: 0},
    {id: 999, number: 999, name: "UNKNOWN", isFree: true,  isOutOfOrder: false, isLocked: false, isOnline: true,  status: 1},
  ];
  state.reservations = [{id: 1, hostId: 101, hostName: "PS5", pin: "1234",
    startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString()}];
  buildMapStatic();
  renderAll();
  renderMy();
  "ok"
`, ctx);

const mapNodes = elements["map-nodes"].innerHTML;
const nodeOf = (id) => mapNodes.match(new RegExp(`<button type="button" aria-label="[^"]*" class="node[^"]*" style="[^"]*" data-id="${id}"`));
assert.ok(nodeOf(101), "PS5 на карте");
assert.ok(mapNodes.includes('data-id="101"') && /node--ps5 node--mine/.test(mapNodes), "PS5 = моя бронь (розовый пульс)");
assert.ok(/node--free/.test(mapNodes), "есть свободные");
assert.ok(/node--busy/.test(mapNodes), "есть занятые");
assert.ok(/node--ooo/.test(mapNodes), "есть «в ремонте»");
assert.ok(elements["map-areas"].innerHTML.includes("VIP-ЗАЛ"), "область VIP на карте");
assert.ok(elements["map-lines"].innerHTML.includes("mline--v"), "линии-разделители");
assert.ok(elements["map-extra"].innerHTML.includes("999"), "машина вне карты подсвечена");

const list = elements["view-list"].innerHTML;
assert.ok(list.includes("VIP-зал"), "зона VIP в списке");
assert.ok(list.includes("ОСНОВНОЙ ЗАЛ") || list.includes("Основной зал"), "зона основной зал в списке");
assert.ok(list.includes("PS5"), "PS5 в списке");
assert.ok(list.includes("999"), "машина 999 в fallback-зоне");
assert.ok(elements["my-list"].innerHTML.includes("1234"), "PIN в «Мои брони»");

console.log("map+list render: OK");
console.log("ALL FRONTEND SMOKE TESTS PASSED");
