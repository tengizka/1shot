/**
 * Шим рантайма Deno для запуска edge-функций в Node (тесты).
 * Подменяет globalThis.Deno: env.get() читает из объекта,
 * serve() запоминает handler, который тесты вызывают напрямую.
 */

const env: Record<string, string> = {};

(globalThis as any).Deno = {
  env: {
    get(name: string): string | undefined {
      return env[name];
    },
  },
  serve(handler: (req: Request) => Response | Promise<Response>): void {
    (globalThis as any).__handler = handler;
  },
};

export function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

export function getHandler(): (req: Request) => Promise<Response> {
  const h = (globalThis as any).__handler;
  if (!h) throw new Error("Deno.serve handler не установлен");
  return h;
}
