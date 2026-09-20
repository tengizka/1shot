/**
 * Тесты Gizmo-клиента: URL, HTTP Basic Auth, форма тел запросов,
 * нормализация хостов (защита от различий полей в версиях API).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { setEnv } from "./deno-shim.mts";
import { createMock } from "./fetch-mock.mts";

const mock = createMock();

before(() => {
  setEnv({
    GIZMO_BASE_URL: "http://gizmo.test",
    GIZMO_LOGIN: "op",
    GIZMO_PASSWORD: "secret123",
  });
  globalThis.fetch = mock.fetch;
});

const g = await import("../supabase/functions/shared/gizmo.ts");

test("apiBase() по умолчанию /api/v2.0", () => {
  assert.equal(g.apiBase(), "/api/v2.0");
});

test("GIZMO_API_BASE переопределяет базовый путь (совместимость с v1)", () => {
  setEnv({ GIZMO_API_BASE: "/api/v1" });
  assert.equal(g.apiBase(), "/api/v1");
  setEnv({ GIZMO_API_BASE: undefined });
});

test("normalizeHost понимает PascalCase и camelCase", () => {
  const a = g.normalizeHost({
    Id: 7, Name: "PC-07", Number: 7, HostGroupId: 11,
    Status: 1, IsOnline: true, IsOutOfOrder: false, IsLocked: false,
  });
  assert.ok(a);
  assert.equal(a.id, 7);
  assert.equal(a.name, "PC-07");
  assert.equal(a.groupId, 11);
  assert.equal(a.status, 1);

  const b = g.normalizeHost({
    id: 8, name: "PC-08", number: "8", hostGroupId: 12,
    status: 2, isOnline: true, isOutOfOrder: true, isLocked: false,
  });
  assert.ok(b);
  assert.equal(b.id, 8);
  assert.equal(b.number, 8);
  assert.equal(b.status, 2);
  assert.equal(b.isOutOfOrder, true);

  assert.equal(g.normalizeHost({ Name: "no id" }), null);
});

test("hostIsFree: логика статусов", () => {
  const base = { id: 1, name: "x", number: null, groupId: null, isOnline: true as boolean | null, isOutOfOrder: false, isLocked: false, raw: {} as Record<string, unknown> };
  assert.equal(g.hostIsFree({ ...base, status: 1 }), true);
  assert.equal(g.hostIsFree({ ...base, status: 2 }), false);
  assert.equal(g.hostIsFree({ ...base, status: 0 }), false);
  assert.equal(g.hostIsFree({ ...base, status: 1, isOnline: false }), false);
  assert.equal(g.hostIsFree({ ...base, status: 1, isOutOfOrder: true }), false);
  assert.equal(g.hostIsFree({ ...base, status: 1, isLocked: true }), false);
  assert.equal(g.hostIsFree({ ...base, status: null }), false); // консервативно
});

test("listHosts: URL, Basic Auth и нормализация", async () => {
  mock.state.gizmoHosts = [
    { Id: 1, Name: "PC-01", Number: 1, HostGroupId: 10, Status: 1, IsOnline: true, IsOutOfOrder: false, IsLocked: false },
    { Id: 2, Name: "PC-02", Number: 2, HostGroupId: 10, Status: 2, IsOnline: true, IsOutOfOrder: false, IsLocked: false },
  ];
  const hosts = await g.listHosts();
  assert.equal(hosts.length, 2);
  assert.deepEqual(hosts.map((h) => h.id), [1, 2]);
  assert.equal(g.hostIsFree(hosts[0]), true); // PC-01 Status=1
  assert.equal(g.hostIsFree(hosts[1]), false); // PC-02 Status=2

  const req = mock.state.requests.find((r) => r.url === "http://gizmo.test/api/v2.0/hosts");
  assert.ok(req, "должен быть GET /api/v2.0/hosts");
  assert.equal(req.headers?.["authorization"], `Basic ${Buffer.from("op:secret123").toString("base64")}`);
});

test("createReservation шлёт тело в формате Gizmo v2", async () => {
  const id = await g.createReservation({
    UserId: 501,
    Date: "2026-09-18T15:00:00+03:00",
    Duration: 60,
    Pin: "4242",
    Hosts: [{ HostId: 7 }],
    Note: "Telegram mini-app",
  });
  assert.equal(id, 900);
  const body = mock.state.lastGizmoReservationBody;
  assert.ok(body);
  assert.equal(body.UserId, 501);
  assert.equal(body.Duration, 60);
  assert.equal(body.Pin, "4242");
  assert.deepEqual(body.Hosts, [{ HostId: 7 }]);
  assert.equal(body.Date, "2026-09-18T15:00:00+03:00");
});

test("deleteReservation: DELETE /reservations/{id}", async () => {
  await g.deleteReservation(900);
  assert.ok(mock.state.gizmoDeletes.includes(900));
});

test("findUserByUsername находит по точному Username", async () => {
  mock.state.gizmoUsers = [
    { Id: 501, Username: "tg_111" },
    { Id: 502, Username: "tg_222" },
  ];
  const found = await g.findUserByUsername("tg_222");
  assert.deepEqual(found, { id: 502, username: "tg_222" });
  const none = await g.findUserByUsername("tg_333");
  assert.equal(none, null);
});

test("createUser возвращает id созданного пользователя", async () => {
  const id = await g.createUser({ username: "tg_333", firstName: "Влад", password: "p" });
  assert.equal(id, 501);
  const req = mock.state.requests.find((r) => r.url === "http://gizmo.test/api/v2.0/users" && r.method === "POST");
  assert.ok(req);
  assert.equal((req.body as Record<string, unknown>).Username, "tg_333");
});

interface GizmoErrorLike {
  status: number;
}

test("ошибка Gizmo (401) превращается в GizmoError", async () => {
  mock.state.gizmoError = true;
  await assert.rejects(
    () => g.listHosts(),
    (e: unknown) =>
      e instanceof g.GizmoError && (e as GizmoErrorLike).status === 401,
  );
  mock.state.gizmoError = false;
});

test("GIZMO_TUNNEL_SECRET летит заголовком x-1shot-secret", async () => {
  setEnv({ GIZMO_TUNNEL_SECRET: "s3cret" });
  mock.state.gizmoHosts = [];
  await g.listHosts();
  const req = mock.state.requests.at(-1);
  assert.equal(req?.headers?.["x-1shot-secret"], "s3cret");
  setEnv({ GIZMO_TUNNEL_SECRET: undefined });
});
