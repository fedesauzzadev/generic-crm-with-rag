import { existsSync } from "node:fs";
import type { Context, Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { SessionEnv } from "./auth.js";

// Sirve la SPA compilada (admin/dist copiada a public/ por el Dockerfile) cuando
// existe. En dev la carpeta no está y esto no registra nada — el proxy de Vite manda.
// Registro: static files primero, fallback a index.html para rutas client-side
// (/login, /deals/:id); /api/* nunca cae acá (JSON 404 preservado).
export function registerSpa(app: Hono<SessionEnv>, spaDir = process.env.SPA_DIR ?? "public"): boolean {
  if (!existsSync(spaDir)) return false;
  app.use("*", serveStatic({ root: spaDir }));
  // SPA fallback: rutas client-side (/login, /deals/:id) → index.html; /api → JSON 404.
  const indexHandler = serveStatic({ path: `${spaDir}/index.html` }) as unknown as (
    c: Context<SessionEnv>,
  ) => Promise<Response> | Response;
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    return indexHandler(c);
  });
  return true;
}
