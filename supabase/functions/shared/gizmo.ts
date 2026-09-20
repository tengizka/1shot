/**
 * Клиент Gizmo Web API (HTTP Basic Auth).
 *
 * Пути по умолчанию — /api/v2.0 (как в неофициальной обёртке ggizmo-api).
 * Если ваш Swagger показывает другой базовый путь (например /api/v1),
 * поменяйте секрет GIZMO_API_BASE — всё остальное в этом файле не трогается.
 *
 *   GIZMO_BASE_URL  — публичный URL туннеля, например https://gizmo.example.com
 *   GIZMO_LOGIN     — логин оператора Gizmo
 *   GIZMO_PASSWORD  — пароль оператора
 *   GIZMO_API_BASE  — (необяз.) базовый путь API, по умолчанию /api/v2.0
 *   GIZMO_TUNNEL_SECRET — (необяз.) общий секрет; слетает заголовком
 *                        x-1shot-secret для WAF-правила на Cloudflare
 */

import { envStr } from "./env.ts";

const enc = new TextEncoder();

export class GizmoError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Gizmo API error: HTTP ${status}`);
    this.name = "GizmoError";
    this.status = status;
    this.body = body;
  }
}

function b64encode(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function apiBase(): string {
  return envStr("GIZMO_API_BASE", "/api/v2.0").replace(/\/+$/, "");
}

async function gizmoFetch<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const base = envStr("GIZMO_BASE_URL").replace(/\/+$/, "");
  const login = envStr("GIZMO_LOGIN");
  const password = envStr("GIZMO_PASSWORD");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Basic ${b64encode(`${login}:${password}`)}`,
  };
  const secret = Deno.env.get("GIZMO_TUNNEL_SECRET");
  if (secret) headers["x-1shot-secret"] = secret;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new GizmoError(0, `network error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = await res.text();
  if (!res.ok) throw new GizmoError(res.status, text.slice(0, 500));
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/* ---------------------------- утилиты нормализации ---------------------------- */

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/* ----------------------------------- Hosts ----------------------------------- */

export interface GizmoHost {
  id: number;
  name: string;
  number: number | null;
  groupId: number | null;
  /** Сырой статус Gizmo. В API v2: 0=offline, 1=free, 2=busy. */
  status: number | null;
  isOnline: boolean | null;
  isOutOfOrder: boolean;
  isLocked: boolean;
  raw: Record<string, unknown>;
}

/**
 * Нормализует запись хоста из Gizmo.
 *
 * ВАЖНО: имена полей в ответе API могут незначительно отличаться от
 * версии Gizmo. Если Swagger показывает другие — правится ТОЛЬКО это место.
 */
export function normalizeHost(h: Record<string, unknown>): GizmoHost | null {
  const id = num(h.Id ?? h.id);
  if (id === null) return null;
  return {
    id,
    name: str(h.Name ?? h.name) ?? `Host ${id}`,
    number: num(h.Number ?? h.number),
    groupId: num(h.HostGroupId ?? h.hostGroupId ?? h.GroupId ?? h.groupId),
    status: num(h.Status ?? h.status),
    isOnline: bool(h.IsOnline ?? h.isOnline),
    isOutOfOrder: bool(h.IsOutOfOrder ?? h.isOutOfOrder) ?? false,
    isLocked: bool(h.IsLocked ?? h.isLocked) ?? false,
    raw: h,
  };
}

/**
 * Хост «свободен», если не сломан/не заблокирован, в сети и Status = 1.
 * (В Gizmo: 0 — оффлайн, 1 — свободен, 2 — занят.)
 */
export function hostIsFree(h: GizmoHost): boolean {
  if (h.isOutOfOrder || h.isLocked) return false;
  if (h.isOnline === false) return false;
  if (h.status !== null) return h.status === 1;
  return false;
}

export async function listHosts(): Promise<GizmoHost[]> {
  const data = await gizmoFetch<unknown>("GET", `${apiBase()}/hosts`);
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((x) => normalizeHost(x as Record<string, unknown>))
    .filter((h): h is GizmoHost => h !== null);
}

export async function getHost(id: number): Promise<GizmoHost | null> {
  const data = await gizmoFetch<Record<string, unknown> | null>("GET", `${apiBase()}/hosts/${id}`);
  return data ? normalizeHost(data) : null;
}

/* -------------------------------- Reservations ------------------------------- */

export interface CreateReservationBody {
  UserId: number;
  /** Время начала в часовом поясе клуба: "YYYY-MM-DDTHH:mm:ss±HH:MM" */
  Date: string;
  /** Длительность, минуты */
  Duration: number;
  /** PIN для логина на забронированный хост */
  Pin: string;
  Hosts: { HostId: number }[];
  Note?: string;
}

export async function createReservation(body: CreateReservationBody): Promise<number | null> {
  const data = await gizmoFetch<Record<string, unknown> | null>("POST", `${apiBase()}/reservations`, body);
  if (data && typeof data === "object") {
    return num((data as Record<string, unknown>).Id ?? (data as Record<string, unknown>).id);
  }
  return null;
}

export async function deleteReservation(id: number): Promise<void> {
  await gizmoFetch("DELETE", `${apiBase()}/reservations/${id}`);
}

/* ----------------------------------- Users ----------------------------------- */

export async function findUserByUsername(username: string): Promise<{ id: number; username: string } | null> {
  const data = await gizmoFetch<unknown>(
    "GET",
    `${apiBase()}/users?Username=${encodeURIComponent(username)}`,
  );
  const arr = Array.isArray(data) ? data : [];
  const found = arr.find((u) => {
    const r = u as Record<string, unknown>;
    return (r.Username ?? r.username) === username;
  });
  if (!found) return null;
  const r = found as Record<string, unknown>;
  const id = num(r.Id ?? r.id);
  return id === null ? null : { id, username };
}

export async function createUser(payload: {
  username: string;
  firstName?: string;
  password: string;
}): Promise<number> {
  const body: Record<string, unknown> = {
    Username: payload.username,
    FirstName: payload.firstName ?? "Guest",
    EnableDate: new Date().toISOString(),
    Password: payload.password,
    IsNegativeBalanceAllowed: false,
  };
  const data = await gizmoFetch<Record<string, unknown> | null>("POST", `${apiBase()}/users`, body);
  const id =
    data && typeof data === "object" ? num((data as Record<string, unknown>).Id ?? (data as Record<string, unknown>).id) : null;
  if (id === null) {
    throw new GizmoError(502, "Gizmo не вернул id созданного пользователя");
  }
  return id;
}
