/**
 * Время клуба.
 *
 * Gizmo принимает «Date» брони как локальное время сервера клуба. Часы
 * edge-функций идут по UTC, поэтому сдвиг задаётся секретом
 * TIMEZONE_OFFSET_HOURS (целые часы, можно дробные). Примеры:
 *   Москва  = 3,   Алма-Ата/Алматы = 5,   Астана = 5,   Душанбе = 5,
 *   Ташкент = 5,   Баку = 4,            Ереван = 4,   UTC = 0.
 */

import { envInt } from "./env.ts";

export function tzOffsetHours(): number {
  return envInt("TIMEZONE_OFFSET_HOURS", 0);
}

/**
 * Дата в часовом поясе клуба в формате "YYYY-MM-DDTHH:mm:ss±HH:MM"
 * (ISO 8601 со сдвигом — .NET/API корректно понимают такой формат).
 */
export function clubTimeIso(d: Date): string {
  const off = tzOffsetHours();
  const shifted = new Date(d.getTime() + off * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const whole = Math.trunc(abs);
  const minutes = Math.round((abs - whole) * 60);
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}` +
    `${sign}${p(whole)}:${p(minutes)}`
  );
}
