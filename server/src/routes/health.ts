import { Hono } from "hono";

// Healthcheck: confirma que el proceso responde, sin tocar la DB (smoke de
// arranque N8/N9). En S03 se consolida el contract completo de /api/health.
export const healthRoutes = new Hono().get("/ping", (c) =>
  c.json({ ok: true, service: "generic-crm-server", time: new Date().toISOString() })
);
