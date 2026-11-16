import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerSpa } from "../src/static.js";
import type { SessionEnv } from "../src/auth.js";

// SPA static + fallback (Docker): sirve index.html para rutas client-side,
// JSON 404 para /api/*, y no registra nada si la carpeta no existe (dev).

function appWith(spaDir: string) {
  const app = new Hono<SessionEnv>();
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.notFound((c) => c.json({ ok: false, message: "Not found" }, 404));
  return { app, registered: registerSpa(app, spaDir) };
}

describe("registerSpa (SPA static serving)", () => {
  it("no registra nada si la carpeta no existe (modo dev)", async () => {
    const { app, registered } = appWith("tests/fixtures/no-existe");
    expect(registered).toBe(false);
    const res = await app.request("/login");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: "Not found" });
  });

  it("sirve index.html en la raíz y en rutas client-side (/login)", async () => {
    const { app, registered } = appWith("tests/fixtures/spa");
    expect(registered).toBe(true);
    for (const path of ["/", "/login", "/deals/00000000-0000-4000-8000-000000000044"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect((await res.text()).includes("spa-fixture-index")).toBe(true);
    }
  });

  it("JSON 404 para /api/* desconocido (fallback no lo traga)", async () => {
    const { app } = appWith("tests/fixtures/spa");
    const res = await app.request("/api/no-existe");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: "Not found" });
  });

  it("las rutas /api existentes siguen funcionando con la SPA montada", async () => {
    const { app } = appWith("tests/fixtures/spa");
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
