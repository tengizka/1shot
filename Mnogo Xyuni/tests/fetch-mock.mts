/**
 * Мок globalThis.fetch для двух «серверов» в тестах:
 *   supabase.test — эмуляция PostgREST (наши таблицы)
 *   gizmo.test    — эмуляция Gizmo Web API v2.0
 */

interface Row {
  [k: string]: unknown;
}

export interface MockState {
  hosts: Row[]; // hosts_cache
  reservations: Row[]; // reservations
  usersMap: Row[]; // users_map
  nextReservationId: number;
  conflictOnNextReservation: boolean;

  gizmoHosts: Row[];
  gizmoUsers: Row[];
  gizmoError: boolean; // если true — Gizmo отвечает 401
  lastGizmoReservationBody: Row | null;
  gizmoDeletes: number[];

  requests: { method: string; url: string; body?: unknown; headers?: Record<string, string> }[];
}

export function createMock() {
  const state: MockState = {
    hosts: [],
    reservations: [],
    usersMap: [],
    nextReservationId: 1,
    conflictOnNextReservation: false,
    gizmoHosts: [],
    gizmoUsers: [],
    gizmoError: false,
    lastGizmoReservationBody: null,
    gizmoDeletes: [],
    requests: [],
  };

  function resp(data: unknown, status = 200): Response {
    return new Response(data === null || data === undefined ? "" : JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
    return rows.filter((r) => {
      for (const [k, v] of params.entries()) {
        if (k === "select" || k === "order" || k === "limit") continue;
        if (v.startsWith("eq.")) {
          if (String(r[k]) !== v.slice(3)) return false;
        } else if (v.startsWith("lt.")) {
          if (!(new Date(String(r[k])).getTime() < new Date(v.slice(3)).getTime())) return false;
        } else if (v.startsWith("gt.")) {
          if (!(new Date(String(r[k])).getTime() > new Date(v.slice(3)).getTime())) return false;
        } else if (v.startsWith("in.(")) {
          const ids = v.slice(4, -1).split(",");
          if (!ids.includes(String(r[k]))) return false;
        }
      }
      return true;
    });
  }

  function routeSupabase(url: string, method: string, body: unknown): Response {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/rest\/v1\/?/, "");
    const [table, subPath] = path.split("/");
    const params = new URLSearchParams(u.search);

    if (table === "hosts_cache") {
      if (method === "GET") {
        let rows = applyFilters(state.hosts, params);
        const order = params.get("order") ?? "";
        if (order.includes("updated_at.desc")) {
          rows = rows.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        } else if (order.includes("number")) {
          rows = rows.slice().sort((a, b) => {
            const an = a.number == null ? Infinity : Number(a.number);
            const bn = b.number == null ? Infinity : Number(b.number);
            return an !== bn ? an - bn : String(a.name).localeCompare(String(b.name));
          });
        }
        const limit = params.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));
        return resp(rows);
      }
      if (method === "POST") {
        const rows = (Array.isArray(body) ? body : [body]) as Row[];
        for (const r of rows) {
          const idx = state.hosts.findIndex((h) => String(h.gizmo_host_id) === String(r.gizmo_host_id));
          if (idx >= 0) state.hosts[idx] = { ...state.hosts[idx], ...r };
          else state.hosts.push(r);
        }
        return resp(rows);
      }
      if (method === "DELETE") {
        const keep = new Set(applyFilters(state.hosts, params).map((r) => String(r.gizmo_host_id)));
        state.hosts = state.hosts.filter((r) => !keep.has(String(r.gizmo_host_id)));
        return new Response(null, { status: 204 });
      }
    }

    if (table === "reservations") {
      if (method === "GET") return resp(applyFilters(state.reservations, params));
      if (method === "POST") {
        if (state.conflictOnNextReservation) {
          state.conflictOnNextReservation = false;
          return resp(
            {
              code: "23P01",
              message: 'conflicting key value violates exclusion constraint "reservations_no_overlap"',
              details: "Key (host_id, starts_at, ends_at) already exists.",
            },
            409,
          );
        }
        const rows = (Array.isArray(body) ? body : [body]) as Row[];
        const r = { ...rows[0], id: state.nextReservationId++ };
        state.reservations.push(r);
        return resp([r]);
      }
      if (method === "PATCH") {
        const rows = applyFilters(state.reservations, params);
        for (const row of rows) Object.assign(row, body as Row);
        return resp(rows);
      }
    }

    if (table === "users_map") {
      if (method === "GET") return resp(applyFilters(state.usersMap, params));
      if (method === "POST") {
        const rows = (Array.isArray(body) ? body : [body]) as Row[];
        for (const r of rows) {
          const idx = state.usersMap.findIndex((m) => String(m.telegram_id) === String(r.telegram_id));
          if (idx >= 0) state.usersMap[idx] = { ...state.usersMap[idx], ...r };
          else state.usersMap.push(r);
        }
        return resp(rows);
      }
    }

    return new Response(JSON.stringify({ message: `mock: unsupported ${method} ${path}` }), { status: 500 });
  }

  function routeGizmo(url: string, method: string, body: unknown): Response {
    const u = new URL(url);
    const path = u.pathname;
    if (state.gizmoError) {
      return resp({ message: "Unauthorized" }, 401);
    }

    if (path === "/api/v2.0/hosts" && method === "GET") {
      return resp(state.gizmoHosts);
    }
    const hostMatch = path.match(/^\/api\/v2\.0\/hosts\/(\d+)$/);
    if (hostMatch && method === "GET") {
      const h = state.gizmoHosts.find((x) => String(x.Id ?? x.id) === hostMatch[1]);
      return h ? resp(h) : new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
    if (path === "/api/v2.0/users" && method === "GET") {
      const username = u.searchParams.get("Username");
      return resp(username ? state.gizmoUsers.filter((x) => String(x.Username ?? x.username) === username) : state.gizmoUsers);
    }
    if (path === "/api/v2.0/users" && method === "POST") {
      const created = { Id: 501, ...((body as Row) ?? {}) };
      state.gizmoUsers.push(created);
      return resp(created);
    }
    if (path === "/api/v2.0/reservations" && method === "POST") {
      state.lastGizmoReservationBody = (body as Row) ?? {};
      return resp({ Id: 900 });
    }
    const delMatch = path.match(/^\/api\/v2\.0\/reservations\/(\d+)$/);
    if (delMatch && method === "DELETE") {
      state.gizmoDeletes.push(Number(delMatch[1]));
      return resp(null, 200);
    }

    return new Response(JSON.stringify({ message: `mock: unsupported gizmo ${method} ${path}` }), { status: 500 });
  }

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    state.requests.push({
      method,
      url,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    if (url.startsWith("http://supabase.test")) return routeSupabase(url, method, body);
    if (url.startsWith("http://gizmo.test")) return routeGizmo(url, method, body);
    throw new Error(`mock fetch: unexpected URL ${url}`);
  };

  return { state, fetch: fetchMock as typeof fetch };
}

export function gizmoRequestCount(state: MockState, method: string, pathFragment: string): number {
  return state.requests.filter(
    (r) => r.url.includes("gizmo.test") && r.method === method && r.url.includes(pathFragment),
  ).length;
}
