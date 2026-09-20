/**
 * Общие HTTP-утилиты для edge-функций:
 * - HttpError  — «бизнес-ошибка», которую сервер преобразует в JSON-ответ;
 * - json/ok    — ответ с CORS-заголовками (фронт живёт на GitHub Pages);
 * - serve      — обёртка Deno.serve: OPTIONS-префлайт + единый catch.
 */

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-telegram-init-data",
  "access-control-max-age": "86400",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export function ok(body: unknown): Response {
  return json(200, body);
}

export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) {
        const body: Record<string, unknown> = { error: e.message };
        if (e.details !== undefined) body.details = e.details;
        return json(e.status, body);
      }
      console.error(e);
      return json(500, { error: "Внутренняя ошибка сервера. Попробуйте позже." });
    }
  });
}
