import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { SESSION_COOKIE, signSession, verifySession } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// Sesión demo (D-006): unit del firmado HMAC + integración end-to-end
// (login → cookie → me → logout) contra la app real con DB temp.

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-auth-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Par `cookie=value` listo para reenviar, extraído del set-cookie de la respuesta. */
function cookiePair(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("unit: firmado HMAC de sesión", () => {
  it("round-trip: sign → verify devuelve el usuario", () => {
    expect(verifySession(signSession("Dana Stone", "s1"), "s1")).toEqual({ name: "Dana Stone" });
    expect(verifySession(signSession("Ñuñoa ünïcode 😀", "s1"), "s1")).toEqual({ name: "Ñuñoa ünïcode 😀" });
  });

  it("secreto distinto → null", () => {
    expect(verifySession(signSession("Dana", "s1"), "s2")).toBeNull();
  });

  it("payload alterado (firma original) → null", () => {
    const value = signSession("Dana", "s1");
    const payload = Buffer.from(JSON.stringify({ name: "Admin" }), "utf8").toString("base64url");
    const tampered = `${payload}.${value.split(".")[1]}`;
    expect(verifySession(tampered, "s1")).toBeNull();
  });

  it("firma alterada → null; basura/vacío/undefined → null; name no string → null", () => {
    const value = signSession("Dana", "s1");
    expect(verifySession(`${value}x`, "s1")).toBeNull();
    expect(verifySession("garbage", "s1")).toBeNull();
    expect(verifySession("", "s1")).toBeNull();
    expect(verifySession(undefined, "s1")).toBeNull();
    const forgedPayload = Buffer.from(JSON.stringify({ name: 123 }), "utf8").toString("base64url");
    expect(verifySession(`${forgedPayload}.${value.split(".")[1]}`, "s1")).toBeNull();
  });
});

describe("session end-to-end", () => {
  it("login con nombre → 200 + cookie HttpOnly firmada", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dana Stone" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: { name: string } };
    expect(body).toEqual({ ok: true, user: { name: "Dana Stone" } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(verifySession(setCookie.split(";")[0].slice(SESSION_COOKIE.length + 1))).toEqual({ name: "Dana Stone" });
  });

  it("login sin nombre / vacío / body vacío → siempre entra como Guest (AC H-03)", async () => {
    for (const body of [JSON.stringify({}), JSON.stringify({ name: "   " }), undefined]) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { user: { name: string } }).user.name).toBe("Guest");
    }
  });

  it("login con JSON malformado → 400 legible (frontera N1; la SPA nunca lo envía)", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("login con nombre de 61 chars → 422", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(61) }),
    });
    expect(res.status).toBe(422);
  });

  it("whoami: sin cookie → 401; con cookie → usuario; cookie alterada → 401", async () => {
    const noCookie = await app.request("/api/auth/me");
    expect(noCookie.status).toBe(401);
    expect(((await noCookie.json()) as { ok: boolean }).ok).toBe(false);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Milo Vega" }),
    });
    const pair = cookiePair(login);

    const ok = await app.request("/api/auth/me", { headers: { cookie: pair } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { user: { name: string } }).user).toEqual({ name: "Milo Vega" });

    const tampered = await app.request("/api/auth/me", { headers: { cookie: `${pair}x` } });
    expect(tampered.status).toBe(401);
  });

  it("logout con sesión → 200 y limpia la cookie; whoami sin cookie → 401", async () => {
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dana" }),
    });
    const pair = cookiePair(login);

    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie: pair } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const after = await app.request("/api/auth/me");
    expect(after.status).toBe(401);
  });

  it("logout sin sesión → 401 (ruta protegida, plan §4)", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rutas de negocio exigen sesión: /api/contacts sin cookie → 401, con cookie → 200", async () => {
    const blocked = await app.request("/api/contacts");
    expect(blocked.status).toBe(401);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dana" }),
    });
    const allowed = await app.request("/api/contacts", { headers: { cookie: cookiePair(login) } });
    expect(allowed.status).toBe(200);
  });

  it("crash-coherencia (N2): el server sigue vivo tras todos los payloads", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
