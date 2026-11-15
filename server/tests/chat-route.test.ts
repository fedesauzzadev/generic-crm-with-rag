import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";
import { seedCounts } from "../src/db/seed.js";
import { createTools } from "../src/chat/tools.js";

// Integración del contrato POST /api/chat (§11.5): 401/400/422/429 + N14
// (counts antes/después). Corre SIN key en el env → los 200 son degradación,
// que es exactamente el estado que el runtime de demo verifica.

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let countsBefore: Record<string, number>;
const hadKey = process.env.CRM_LLM_API_KEY;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-chat-route-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db); // fetch real (default) — sin key nunca se llama
  delete process.env.CRM_LLM_API_KEY;
  countsBefore = seedCounts(db);
});

afterAll(() => {
  // N14: counts de las 6 tablas idénticos antes/después de TODA la suite de chat.
  expect(seedCounts(db)).toEqual(countsBefore);
  createTools(db).close(); // libera la conn readonly antes de borrar el temp
  if (hadKey !== undefined) process.env.CRM_LLM_API_KEY = hadKey;
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function loginAs(name: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function postChat(cookie: string, body: unknown, raw = false): Promise<Response> {
  return app.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/chat — contrato §11.2", () => {
  it("sin cookie de sesión → 401", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
  });

  it("JSON inválido → 400", async () => {
    const cookie = await loginAs("Valid User");
    const res = await postChat(cookie, "not json {{{", true);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("messages vacío → 422", async () => {
    const cookie = await loginAs("Valid User");
    const res = await postChat(cookie, { messages: [] });
    expect(res.status).toBe(422);
  });

  it("content de 501 chars → 422", async () => {
    const cookie = await loginAs("Valid User");
    const res = await postChat(cookie, { messages: [{ role: "user", content: "a".repeat(501) }] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/messages\.0\.content/);
  });

  it("lang inválido ('fr') → 422", async () => {
    const cookie = await loginAs("Valid User");
    const res = await postChat(cookie, { messages: [{ role: "user", content: "salut" }], lang: "fr" });
    expect(res.status).toBe(422);
  });

  it("más de 20 mensajes → 422", async () => {
    const cookie = await loginAs("Valid User");
    const messages = Array.from({ length: 21 }, () => ({ role: "user" as const, content: "x" }));
    const res = await postChat(cookie, { messages });
    expect(res.status).toBe(422);
  });

  it("sin key en el env → 200 {ok, degraded:true, reason:'missing_key'} accionable", async () => {
    const cookie = await loginAs("Degraded User");
    const res = await postChat(cookie, { messages: [{ role: "user", content: "¿cuántos deals hay?" }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean; degraded: boolean; reason: string; reply: string; trace: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe("missing_key");
    expect(body.reply).toContain("CRM_LLM_API_KEY");
    expect(body.reply).toContain(".env");
    expect(body.trace).toEqual([]);
  });
});

describe("rate limit (N17): 10 req/min por sesión", () => {
  it("burst de 11 → 429 en la 11ª, y el server sigue vivo (N2)", async () => {
    const cookie = await loginAs("Burst User");
    const post = () => postChat(cookie, { messages: [{ role: "user", content: "¿total?" }] });
    for (let i = 1; i <= 10; i++) {
      const res = await post();
      expect(res.status).toBe(200); // degradación honesta, pero 200
    }
    const eleventh = await post();
    expect(eleventh.status).toBe(429);
    const body = (await eleventh.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/too many/i);

    // N2: el 429 no tumba nada — health responde.
    const ping = await app.request("/api/ping");
    expect(ping.status).toBe(200);
  });

  it("otra sesión no hereda el rate limit de Burst User", async () => {
    const cookie = await loginAs("Fresh User");
    const res = await postChat(cookie, { messages: [{ role: "user", content: "hola" }] });
    expect(res.status).toBe(200);
  });
});
