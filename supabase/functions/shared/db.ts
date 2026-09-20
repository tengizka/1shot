/**
 * Лёгкий клиент PostgREST поверх fetch (без npm-зависимостей).
 *
 * Использует SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (обе переменные
 * Supabase автоматически подставляет в edge-функции). Service role
 * обходит RLS — поэтому доступ к таблицам только из функций.
 */

import { envStr } from "./env.ts";

export class DbError extends Error {
  code: string | null;
  status: number;
  details?: unknown;

  constructor(code: string | null, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "DbError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface SelectOpts {
  /** Фильтры PostgREST: { "status": "eq.active", "host_id": "in.(1,2)" } */
  params?: Record<string, string>;
  /** "updated_at.desc" / "number.nulls_last,name.asc" */
  order?: string;
  limit?: number;
}

class DbClient {
  private baseUrl: string;
  private key: string;

  constructor(baseUrl: string, key: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.key = key;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    prefer?: string,
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/rest/v1${path}`, {
      method,
      headers: this.headers(prefer ? { prefer } : undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let code: string | null = null;
      let msg = `PostgREST ${res.status}: ${text.slice(0, 300)}`;
      let details: unknown;
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        code = typeof j.code === "string" ? j.code : null;
        if (typeof j.message === "string") msg = j.message;
        details = j.details;
      } catch {
        /* не JSON */
      }
      throw new DbError(code, res.status, msg, details);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async select(table: string, opts: SelectOpts = {}): Promise<Record<string, unknown>[]> {
    const p = new URLSearchParams();
    p.set("select", "*");
    for (const [k, v] of Object.entries(opts.params ?? {})) p.set(k, v);
    if (opts.order) p.set("order", opts.order);
    if (opts.limit !== undefined) p.set("limit", String(opts.limit));
    const data = await this.request("GET", `/${table}?${p.toString()}`);
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async insert(table: string, rows: object | object[]): Promise<Record<string, unknown>[]> {
    const data = await this.request(
      "POST",
      `/${table}`,
      Array.isArray(rows) ? rows : [rows],
      "return=representation",
    );
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async upsert(
    table: string,
    rows: object | object[],
    onConflict: string,
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request(
      "POST",
      `/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      Array.isArray(rows) ? rows : [rows],
      "return=representation,resolution=merge-duplicates",
    );
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async update(
    table: string,
    values: Record<string, unknown>,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const p = new URLSearchParams();
    p.set("select", "*");
    for (const [k, v] of Object.entries(params)) p.set(k, v);
    const data = await this.request("PATCH", `/${table}?${p.toString()}`, values, "return=representation");
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async delete(table: string, params: Record<string, string>): Promise<void> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) p.set(k, v);
    await this.request("DELETE", `/${table}?${p.toString()}`);
  }
}

let _client: DbClient | null = null;

export function db(): DbClient {
  if (!_client) {
    _client = new DbClient(envStr("SUPABASE_URL"), envStr("SUPABASE_SERVICE_ROLE_KEY"));
  }
  return _client;
}

/** Тестовый сброс (используется в tests/). */
export function _resetDb(): void {
  _client = null;
}
