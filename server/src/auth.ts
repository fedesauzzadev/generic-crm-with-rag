import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { parseWith } from "./http.js";

// Sesión demo (D-006): cookie HttpOnly firmada HMAC-SHA256 con payload {name}.
// Sin auth real ni RBAC — el actor de trazas de S03 sale de acá. Un auth real
// futuro reemplaza este módulo entero sin tocar el dominio.

export const SESSION_COOKIE = "crm_session";

// shortcut: secret embebido solo vale porque no hay auth real (D-006, demo de
// portafolio sin datos sensibles); si se agrega auth, SESSION_SECRET pasa a ser
// obligatoria por env.
const DEFAULT_SESSION_SECRET = "generic-crm-demo-session-secret";

export interface SessionUser {
  name: string;
}

/** Contexto de sesión para los handlers (hook consumido por S03 en las trazas). */
export type SessionEnv = { Variables: { session: SessionUser } };

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Firma un nombre de sesión → valor de cookie `payload_base64url.firma`. */
export function signSession(name: string, secret = sessionSecret()): string {
  const payload = Buffer.from(JSON.stringify({ name }), "utf8").toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

/** Verifica un valor de cookie: firma válida → usuario; si no → null. */
export function verifySession(value: string | undefined, secret = sessionSecret()): SessionUser | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const got = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(hmac(payload, secret));
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { name?: unknown };
    if (typeof parsed.name !== "string" || parsed.name.length === 0) return null;
    return { name: parsed.name };
  } catch {
    return null;
  }
}

/** Extrae el par de la cookie de sesión del header `cookie` crudo. */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  for (const part of cookieHeader?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

const sessionCookieAttributes = "Path=/; HttpOnly; SameSite=Lax";

// Rutas abiertas (plan §4): healthcheck (S01: /api/ping; S03 consolida
// /api/health) y login. Todo lo demás bajo /api exige cookie válida → 401.
const OPEN_PATHS = new Set(["/api/ping", "/api/auth/login"]);

/** Middleware de sesión: 401 sin cookie válida; con ella, expone `c.get("session")`. */
export function sessionMiddleware(): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    if (!OPEN_PATHS.has(c.req.path)) {
      const user = verifySession(readSessionCookie(c.req.header("cookie")));
      if (!user) return c.json({ ok: false, message: "Session required" }, 401);
      c.set("session", user);
    }
    await next();
  };
}

const loginSchema = z.object({
  name: z.string().trim().max(60).optional(),
});

/** Rutas de sesión: login (siempre acepta, AC H-03) · logout · me. */
export function createAuthRoutes(): Hono<SessionEnv> {
  return new Hono<SessionEnv>()
    .post("/login", async (c) => {
      // Body ausente o vacío → {} (siempre entra, AC H-03); JSON malformado → 400.
      // fetch no expone content-length en Requests construidos → leer texto.
      const text = await c.req.raw.text();
      let raw: unknown = {};
      if (text.trim() !== "") {
        try {
          raw = JSON.parse(text);
        } catch {
          throw new HTTPException(400, { message: "Invalid JSON body" });
        }
      }
      const data = parseWith(loginSchema, raw);
      const name = data.name?.length ? data.name : "Guest";
      c.header("set-cookie", `${SESSION_COOKIE}=${signSession(name)}; ${sessionCookieAttributes}`);
      return c.json({ ok: true, user: { name } });
    })
    .post("/logout", (c) => {
      c.header("set-cookie", `${SESSION_COOKIE}=; ${sessionCookieAttributes}; Max-Age=0`);
      return c.json({ ok: true });
    })
    .get("/me", (c) => c.json({ ok: true, user: c.get("session") }));
}
