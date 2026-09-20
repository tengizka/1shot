/**
 * Тесты валидации initData.
 *
 * Хеш считается двумя НЕЗАВИСИМЫми реализациями:
 *  - в тесте — node:crypto (createHmac), как эталон;
 *  - в verifyInitData — Web Crypto (crypto.subtle), как в продакшене.
 * Если они расходятся — падает любой из тестов.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../supabase/functions/shared/telegram.ts";

const TOKEN = "123456:TEST-BOT-TOKEN";
const now = Math.floor(Date.now() / 1000);

function makeInitData(
  token: string,
  params: Record<string, string>,
  authDate: number,
): string {
  const all: Record<string, string> = { ...params, auth_date: String(authDate) };
  const check = Object.keys(all)
    .sort()
    .map((k) => `${k}=${all[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const p = new URLSearchParams(all);
  p.set("hash", hash);
  return p.toString();
}

const user = { id: 123456789, first_name: "Владимир", last_name: "Иванов", username: "vlad" };

test("валидный initData проходит проверку", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user), query_id: "AAF-test-query" }, now);
  const res = await verifyInitData(td, TOKEN);
  assert.ok(res, "initData должен быть принят");
  assert.equal(res.user.id, 123456789);
  assert.equal(res.user.first_name, "Владимир");
  assert.equal(res.user.username, "vlad");
  assert.equal(res.query_id, "AAF-test-query");
  assert.equal(res.auth_date, now);
});

test("отклоняется подделанный payload (чужой user.id)", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user) }, now);
  const tampered = td.replace("123456789", "999999999");
  assert.notEqual(tampered, td);
  assert.equal(await verifyInitData(tampered, TOKEN), null);
});

test("отклоняется неверный токен бота", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user) }, now);
  assert.equal(await verifyInitData(td, "999999:OTHER-TOKEN"), null);
});

test("отклоняется устаревший auth_date (> 24 ч)", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user) }, now - 25 * 3600);
  assert.equal(await verifyInitData(td, TOKEN), null);
});

test("отклоняется слишком «будущий» auth_date (расхождение часов > 5 мин)", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user) }, now + 3600);
  assert.equal(await verifyInitData(td, TOKEN), null);
});

test("допускается небольшой «сдвиг вперёд» часов (≤ 5 мин)", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify(user) }, now + 120);
  assert.ok(await verifyInitData(td, TOKEN));
});

test("отклоняется initData без hash", async () => {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(now) });
  assert.equal(await verifyInitData(p.toString(), TOKEN), null);
});

test("отклоняется битый JSON в user", async () => {
  const td = makeInitData(TOKEN, { user: "{not a json" }, now);
  assert.equal(await verifyInitData(td, TOKEN), null);
});

test("отклоняется user без id", async () => {
  const td = makeInitData(TOKEN, { user: JSON.stringify({ first_name: "NoId" }) }, now);
  assert.equal(await verifyInitData(td, TOKEN), null);
});

test("пустой initData отклоняется", async () => {
  assert.equal(await verifyInitData("", TOKEN), null);
});
