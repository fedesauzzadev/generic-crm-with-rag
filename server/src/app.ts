import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type Database from "better-sqlite3";
import { createActivitiesRoutes } from "./routes/activities.js";
import { createAuthRoutes, sessionMiddleware, type SessionEnv } from "./auth.js";
import { createChatRoutes } from "./chat/route.js";
import { createCompaniesRoutes } from "./routes/companies.js";
import { createContactsRoutes } from "./routes/contacts.js";
import { createDealsRoutes } from "./routes/deals.js";
import { createExportRoutes } from "./routes/export.js";
import { healthRoutes } from "./routes/health.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createSearchRoutes } from "./routes/search.js";
import { createUsersRoutes } from "./routes/users.js";

// Fábrica de la app: recibe la DB ya migrada/seedeada para que los tests
// inyecten la su propia (archivo temp o memoria).

export interface AppDeps {
  /** fetch del agente de chat: los tests inyectan un mock sin red (§11.5). */
  chatFetch?: typeof fetch;
  /** Timeout por llamada LLM en ms (default 15 s, N13). Tests lo acortan. */
  chatTimeoutMs?: number;
}

export function createApp(db: Database.Database, deps: AppDeps = {}): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  // Sesión primero (D-006): 401 en todo /api salvo health y login; expone
  // c.get("session") para las trazas de stage de S03.
  app.use("/api/*", sessionMiddleware());

  app.route("/api", healthRoutes); // GET /api/ping
  app.route("/api/auth", createAuthRoutes()); // POST login/logout · GET me
  app.route("/api/users", createUsersRoutes(db)); // GET (owners del seed)
  app.route("/api/companies", createCompaniesRoutes(db));
  app.route("/api/contacts", createContactsRoutes(db));
  app.route("/api/deals", createDealsRoutes(db)); // incluye /pipeline y /:id/stage
  app.route("/api/activities", createActivitiesRoutes(db));
  app.route("/api/metrics", createMetricsRoutes(db)); // H-06: KPIs del dashboard (S07)
  app.route("/api/export", createExportRoutes(db)); // H-07: CSV contacts/deals (S09)
  app.route("/api/search", createSearchRoutes(db)); // H-08: búsqueda global agrupada (S10)
  // Agente RAG (§11.2): cookie de sesión exigida por sessionMiddleware.
  app.route("/api/chat", createChatRoutes(db, { fetch: deps.chatFetch, timeoutMs: deps.chatTimeoutMs }));

  app.notFound((c) => c.json({ ok: false, message: "Not found" }, 404));

  // Errores: {ok:false, message} únicamente, sin internals (N5). Un payload
  // malformado jamás tumba el proceso (N2).
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ ok: false, message: err.message }, err.status as 400);
    }
    console.error("[server] unhandled error:", err);
    return c.json({ ok: false, message: "Internal server error" }, 500);
  });

  return app;
}
