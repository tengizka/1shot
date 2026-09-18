/**
 * Минимальные декларации рантайма Deno для локальной проверки типов (tsc).
 *
 * В продакшене код исполняется на реальном Deno (Supabase Edge Functions),
 * в тестах — на Node-шиме (tests/deno-shim.mts), который подставляет
 * globalThis.Deno с env.get() и serve().
 */
declare namespace Deno {
  const env: {
    get(name: string): string | undefined;
  };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
