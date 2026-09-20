/**
 * GET /functions/v1/hosts
 *
 * Возвращает список компьютеров клуба с текущим статусом.
 *
 * Стратегия:
 *   1. Если кэш в Postgres свежий (< CACHE_TTL_SEC, по умолчанию 8 с) —
 *      отдаём его (не долбим Gizmo на каждый рендер мини-аппа).
 *   2. Иначе — запрашиваем Gizmo (GET /api/v2.0/hosts), обновляем кэш
 *      (upsert + удаление хостов, которых больше нет) и отдаём новое.
 *   3. Если Gizmo недоступен — отдаём старый кэш с полем warning
 *      (лучше чуть устаревший статус, чем «сервер лежит»).
 */

import { HttpError, ok, serve } from "../shared/http.ts";
import { requireTelegramUser } from "../shared/telegram.ts";
import { db } from "../shared/db.ts";
import { hostIsFree, listHosts, type GizmoHost } from "../shared/gizmo.ts";
import { envInt } from "../shared/env.ts";

function toApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.gizmo_host_id,
    name: r.name,
    number: r.number ?? null,
    groupId: r.group_id ?? null,
    status: r.status,
    isFree: r.is_free,
    isOutOfOrder: r.is_out_of_order,
    isLocked: r.is_locked,
  };
}

async function refreshCache(): Promise<Record<string, unknown>[]> {
  const hosts: GizmoHost[] = await listHosts();
  const now = new Date().toISOString();
  const rows = hosts.map((h) => ({
    gizmo_host_id: h.id,
    name: h.name,
    number: h.number,
    group_id: h.groupId,
    status: h.status ?? 0,
    is_free: hostIsFree(h),
    is_out_of_order: h.isOutOfOrder,
    is_locked: h.isLocked,
    meta: h.raw,
    updated_at: now,
  }));

  const d = db();
  if (rows.length) {
    await d.upsert("hosts_cache", rows, "gizmo_host_id");
  }

  // Убираем хосты, которых больше нет в Gizmo. Чтобы не убить строки
  // конкурентного обновления, смотрим только на ряды старше 5 минут.
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const old = await d.select("hosts_cache", { params: { updated_at: `lt.${cutoff}` } });
  const keep = new Set(rows.map((r) => r.gizmo_host_id as number));
  const gone = old
    .filter((r) => !keep.has(r.gizmo_host_id as number))
    .map((r) => r.gizmo_host_id as number);
  if (gone.length) {
    await d.delete("hosts_cache", { "gizmo_host_id": `in.(${gone.join(",")})` });
  }

  return rows;
}

serve(async (req: Request) => {
  await requireTelegramUser(req);
  const ttlMs = envInt("CACHE_TTL_SEC", 8) * 1000;
  const d = db();

  const newest = await d.select("hosts_cache", { order: "updated_at.desc", limit: 1 });
  const ageMs = newest.length
    ? Date.now() - new Date(newest[0].updated_at as string).getTime()
    : Infinity;

  if (ageMs <= ttlMs) {
    const rows = await d.select("hosts_cache", { order: "number.nulls_last,name.asc" });
    return ok({
      hosts: rows.map(toApi),
      source: "cache",
      updatedAt: newest[0].updated_at,
    });
  }

  try {
    const rows = await refreshCache();
    return ok({
      hosts: rows.map(toApi),
      source: "gizmo",
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    const stale = await d.select("hosts_cache", { order: "number.nulls_last,name.asc" });
    if (stale.length) {
      return ok({
        hosts: stale.map(toApi),
        source: "stale-cache",
        updatedAt: newest[0]?.updated_at ?? null,
        warning: "Не удалось опросить Gizmo, статусы могут быть устаревшими.",
      });
    }
    console.error("hosts: gizmo unavailable and no cache:", e);
    throw new HttpError(502, "Не удалось получить список компьютеров: Gizmo недоступен.");
  }
});
