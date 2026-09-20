/**
 * Валидация Telegram Mini App initData.
 *
 * Telegram присылает initData (URL-строка с параметрами и hash) из
 * window.Telegram.WebApp.initData. Хеш проверяется по схеме из официальной
 * документации:
 *
 *   secret_key       = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
 *   data_check_string = "k1=v1\nk2=v2\n..." (все параметры, кроме hash,
 *                       отсортированы по ключу)
 *   hash             = HMAC_SHA256(key=secret_key, msg=data_check_string)
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Код намеренно не использует ничего, кроме Web Crypto (crypto.subtle),
 * чтобы одинаково работать и в Deno (продакшен), и в Node (тесты).
 */

import { envStr } from "./env.ts";
import { HttpError } from "./http.ts";

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TgInitData {
  user: TgUser;
  auth_date: number;
  query_id?: string;
  [key: string]: unknown;
}

const enc = new TextEncoder();

async function hmacSha256Raw(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const keyObj = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", keyObj, enc.encode(message));
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Проверяет initData и возвращает распарсенные данные (с user) либо null.
 *
 * @param initData   строка из Telegram.WebApp.initData
 * @param botToken   токен бота (secret BOT_TOKEN)
 * @param maxAgeSec  свежесть auth_date, сек. (по умолчанию 24 ч;
 *                   для мутаций reserve/cancel передаём 3600)
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number = 86400,
): Promise<TgInitData | null> {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const providedHash = params.get("hash");
  if (!providedHash) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const ageSec = Date.now() / 1000 - authDate;
  // допускаем до 5 минут расхождения часов на «вперёд»
  if (ageSec > maxAgeSec || ageSec < -300) return null;

  // secret_key = HMAC_SHA256(key="WebAppData", msg=botToken)
  const webappKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKey = await crypto.subtle.sign("HMAC", webappKey, enc.encode(botToken));

  const dataCheckString = Array.from(params.keys())
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join("\n");

  const expectedHash = bufferToHex(await hmacSha256Raw(secretKey, dataCheckString));
  if (!safeEqual(expectedHash, providedHash)) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: TgUser;
  try {
    user = JSON.parse(userRaw) as TgUser;
  } catch {
    return null;
  }
  if (typeof user.id !== "number" || user.id <= 0) return null;

  const out: TgInitData = { user, auth_date: Math.floor(authDate) };
  for (const [k, v] of params.entries()) {
    if (k !== "hash" && k !== "user" && k !== "auth_date") out[k] = v;
  }
  return out;
}

/** Забирает initData из заголовка запроса (x-telegram-init-data). */
export function extractInitData(req: Request): string {
  return req.headers.get("x-telegram-init-data") ?? "";
}

/**
 * Для handlers: проверяет initData (секрет BOT_TOKEN) и бросает HttpError(401),
 * если подпись не проходит или auth_date устарел.
 */
export async function requireTelegramUser(
  req: Request,
  maxAgeSec = 86400,
): Promise<TgInitData> {
  const initData = extractInitData(req);
  const td = await verifyInitData(initData, envStr("BOT_TOKEN"), maxAgeSec);
  if (!td) {
    throw new HttpError(
      401,
      "Не удалось проверить initData Telegram. Откройте приложение заново из Telegram.",
    );
  }
  return td;
}
