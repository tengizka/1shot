/**
 * Сквозные тесты edge-функций (handler → мок PostgREST + мок Gizmo):
 * hosts (кэш/свежесть), reserve (гонка, PIN, таймзона),
 * my-reservations, cancel-reservation, защита по initData.
 *
 * Тесты в файле идут последовательно как один сценарий.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setEnv, getHandler } from "./deno-shim.mts";
import { createMock, gizmoRequestCount } from "./fetch-mock.mts";

const mock = createMock();

const TOKEN = "123456:TEST";
setEnv({
  BOT_TOKEN: TOKEN,
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  GIZMO_BASE_URL: "http://gizmo.test",
  GIZMO_LOGIN: "op",
  GIZMO_PASSWORD: "secret123",
  TIMEZONE_OFFSET_HOURS: "3",
  CACHE_TTL_SEC: "8",
});
globalThis.fetch = mock.fetch;

mock.state.gizmoHosts = [
  { Id: 1, Name: "PC-01", Number: 1, HostGroupId: 10, Status: 1, IsOnline: true, IsOutOfOrder: false, IsLocked: false },
  { Id: 2, Name: "PC-02", Number: 2, HostGroupId: 10, Status: 2, IsOnline: true, IsOutOfOrder: false, IsLocked: false },
  { Id: 3, Name: "PC-03", Number: 3, HostGroupId: 11, Status: 0, IsOnline: false, IsOutOfOrder: false, IsLocked: false },
  { Id: 4, Name: "PC-04", Number: 4, HostGroupId: 10, Status: 1, IsOnline: true, IsOutOfOrder: true, IsLocked: false },
];

function initDataFor(userId: number, firstName = "Влад"): string {
  const params: Record<string, string> = {
    user: JSON.stringify({ id: userId, first_name: firstName }),
  };
  const authDate = Math.floor(Date.now() / 1000);
  const all: Record<string, string> = { ...params, auth_date: String(authDate) };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const p = new URLSearchParams(all);
  p.set("hash", hash);
  return p.toString();
}

function req(
  path: string,
  opts: { method?: string; initData?: string; body?: unknown } = {},
): Request {
  return new Request(`http://miniapp.test${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-telegram-init-data": opts.initData ?? initDataFor(100),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let hostsHandler: (r: Request) => Promise<Response>;
let reserveHandler: (r: Request) => Promise<Response>;
let myHandler: (r: Request) => Promise<Response>;
let cancelHandler: (r: Request) => Promise<Response>;

before(async () => {
  await import("../supabase/functions/hosts/index.ts");
  hostsHandler = getHandler();
  await import("../supabase/functions/reserve/index.ts");
  reserveHandler = getHandler();
  await import("../supabase/functions/my-reservations/index.ts");
  myHandler = getHandler();
  await import("../supabase/functions/cancel-reservation/index.ts");
  cancelHandler = getHandler();
});

test("hosts: холодный кэш → опрос Gizmo", async () => {
  const res = await hostsHandler(req("/hosts"));
  assert.equal(res.status, 200);
  const data = (await res.json()) as Record<string, any>;
  assert.equal(data.source, "gizmo");
  assert.equal(data.hosts.length, 4);
  const byId = Object.fromEntries(data.hosts.map((h: any) => [h.id, h]));
  assert.equal(byId[1].isFree, true); // свободен
  assert.equal(byId[2].isFree, false); // занят
  assert.equal(byId[3].isFree, false); // оффлайн
  assert.equal(byId[4].isFree, false); // в ремонте
  assert.equal(byId[4].isOutOfOrder, true);
});

test("hosts: свежий кэш → без повторного опроса Gizmo", async () => {
  const gizmoCallsBefore = gizmoRequestCount(mock.state, "GET", "/api/v2.0/hosts");
  const res = await hostsHandler(req("/hosts"));
  const data = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200);
  assert.equal(data.source, "cache");
  assert.equal(gizmoRequestCount(mock.state, "GET", "/api/v2.0/hosts"), gizmoCallsBefore);
});

test("hosts: чужая/чёрная initData → 401", async () => {
  const bad = req("/hosts", { initData: "user=%7B%22id%22%3A100%7D&auth_date=123&hash=deadbeef" });
  const res = await hostsHandler(bad);
  assert.equal(res.status, 401);
});

test("reserve: успешная бронь с PIN и таймзоной +03:00", async () => {
  const before = Date.now();
  const res = await reserveHandler(req("/reserve", {
    method: "POST",
    body: { hostId: 1, durationMinutes: 60 },
  }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().text().catch(() => "")));
  const data = (await res.json()) as any;
  assert.ok(data.id > 0);
  assert.equal(data.hostId, 1);
  assert.equal(data.hostName, "PC-01");
  assert.match(data.pin, /^\d{4}$/);
  const start = new Date(data.startsAt).getTime();
  const end = new Date(data.endsAt).getTime();
  assert.ok(Math.abs(start - before) < 10_000, "startsAt ≈ now");
  assert.equal(end - start, 60 * 60_000);

  // Бронь в Gizmo: формат v2, время в часовом поясе клуба
  const gbody = mock.state.lastGizmoReservationBody;
  assert.ok(gbody, "в Gizmo должна улететь бронь");
  assert.equal(gbody.UserId, 501); // пользователь создан в Gizmo
  assert.equal(gbody.Duration, 60);
  assert.equal(gbody.Pin, data.pin);
  assert.deepEqual(gbody.Hosts, [{ HostId: 1 }]);
  assert.match(String(gbody.Date), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/);

  // Маппинг telegram → gizmo
  const map = mock.state.usersMap.find((m) => m.telegram_id === 100);
  assert.ok(map);
  assert.equal(map.gizmo_user_id, 501);
  assert.equal(map.gizmo_username, "tg_100");

  // Локальная бронь сохранена с id Gizmo
  const row = mock.state.reservations.find((r) => r.id === data.id);
  assert.ok(row);
  assert.equal(row.status, "active");
  assert.equal(row.gizmo_reservation_id, 900);
});

test("reserve: второй гость на тот же слот → 409 (гонка)", async () => {
  mock.state.conflictOnNextReservation = true;
  const res = await reserveHandler(req("/reserve", {
    method: "POST",
    initData: initDataFor(200, "Гость"),
    body: { hostId: 1, durationMinutes: 60 },
  }));
  assert.equal(res.status, 409);
  const data = (await res.json()) as any;
  assert.match(data.error, /заняли/);
});

test("reserve: занятый хост → 409", async () => {
  const res = await reserveHandler(req("/reserve", {
    method: "POST",
    body: { hostId: 2, durationMinutes: 60 },
  }));
  assert.equal(res.status, 409);
  const data = (await res.json()) as any;
  assert.match(data.error, /занят|забронирован/);
});

test("reserve: валидация параметров → 400", async () => {
  const r1 = await reserveHandler(req("/reserve", { method: "POST", body: { durationMinutes: 60 } }));
  assert.equal(r1.status, 400);
  const r2 = await reserveHandler(req("/reserve", { method: "POST", body: { hostId: 1, durationMinutes: 6000 } }));
  assert.equal(r2.status, 400);
});

test("reserve: повторная бронь того же хоста → 409", async () => {
  const res = await reserveHandler(req("/reserve", {
    method: "POST",
    body: { hostId: 1, durationMinutes: 30 },
  }));
  assert.equal(res.status, 409);
  const data = (await res.json()) as any;
  assert.match(data.error, /уже есть/);
});

test("my-reservations: возвращает активные брони гостя", async () => {
  const res = await myHandler(req("/my-reservations"));
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].hostName, "PC-01");
  assert.match(data.reservations[0].pin, /^\d{4}$/);
});

test("cancel-reservation: свой гость отменяет бронь, Gizmo-бронь снимается", async () => {
  const myRes = mock.state.reservations.find((r) => r.telegram_id === 100);
  assert.ok(myRes);
  const res = await cancelHandler(req("/cancel-reservation", {
    method: "POST",
    body: { id: myRes.id },
  }));
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.ok, true);
  assert.ok(mock.state.gizmoDeletes.includes(900), "бронь удалена в Gizmo");
  assert.equal(myRes.status, "cancelled");

  // После отмены слот свободен — новая бронь проходит
  const again = await reserveHandler(req("/reserve", {
    method: "POST",
    body: { hostId: 1, durationMinutes: 30 },
  }));
  assert.equal(again.status, 200, JSON.stringify(await again.clone().text().catch(() => "")));
});

test("cancel-reservation: чужая бронь → 404", async () => {
  const row = mock.state.reservations.find((r) => r.telegram_id === 100 && r.status === "active");
  assert.ok(row);
  const res = await cancelHandler(req("/cancel-reservation", {
    method: "POST",
    initData: initDataFor(999, "Чужак"),
    body: { id: row.id },
  }));
  assert.equal(res.status, 404);
});
