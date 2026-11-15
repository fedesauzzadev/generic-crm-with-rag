import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// Smoke de API con DB real en archivo temp (mismo camino de producción:
// bootstrap = migrar + seed). Se prueba el stack completo de punta a punta.
// Desde S02 todo /api exige sesión (D-006): se loguea una vez en beforeAll.

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-api-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test User" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function jsonRequest(url: string, method: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/ping", () => {
  it("responde 200 con {ok:true}", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("generic-crm-server");
  });
});

describe("contacts CRUD", () => {
  it("sin cookie de sesión → 401 (middleware D-006)", async () => {
    const res = await app.request("/api/contacts");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
  });

  it("lista los contactos del seed de demo", async () => {
    const res = await app.request("/api/contacts", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: unknown[]; total: number };
    expect(body.ok).toBe(true);
    expect(body.items.length).toBe(12);
    expect(body.total).toBe(12);
  });

  it("crea un contacto válido y lo devuelve", async () => {
    const res = await jsonRequest("/api/contacts", "POST", { full_name: "Test Person" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; contact: { id: string; full_name: string } };
    expect(body.ok).toBe(true);
    expect(body.contact.full_name).toBe("Test Person");

    const got = await app.request(`/api/contacts/${body.contact.id}`, { headers: { cookie } });
    expect(got.status).toBe(200);
  });

  it("rechaza payload inválido con 422 legible y sin internals", async () => {
    const res = await jsonRequest("/api/contacts", "POST", { email: "nope" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/stack|at \/|node_modules/i);
  });

  it("rechaza body que no es JSON con 400", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "not json at all {{{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("rechaza company_id inexistente con 422", async () => {
    const res = await jsonRequest("/api/contacts", "POST", {
      full_name: "Orphan",
      company_id: "does-not-exist",
    });
    expect(res.status).toBe(422);
  });

  it("edita un contacto con PATCH", async () => {
    const created = (await (await jsonRequest("/api/contacts", "POST", { full_name: "Before Edit" })).json()) as {
      contact: { id: string };
    };
    const res = await jsonRequest(`/api/contacts/${created.contact.id}`, "PATCH", { title: "PM" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact: { title: string; full_name: string } };
    expect(body.contact.title).toBe("PM");
    expect(body.contact.full_name).toBe("Before Edit"); // lo no enviado queda igual
  });

  it("borrado lógico: desaparece del listado y el GET por id da 404", async () => {
    const created = (await (await jsonRequest("/api/contacts", "POST", { full_name: "To Delete" })).json()) as {
      contact: { id: string };
    };
    const del = await app.request(`/api/contacts/${created.contact.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);

    const list = (await (await app.request("/api/contacts", { headers: { cookie } })).json()) as {
      items: { id: string }[];
      total: number;
    };
    expect(list.items.find((i) => i.id === created.contact.id)).toBeUndefined();

    const got = await app.request(`/api/contacts/${created.contact.id}`, { headers: { cookie } });
    expect(got.status).toBe(404);
  });

  it("GET de id inexistente da 404 con {ok:false}", async () => {
    const res = await app.request("/api/contacts/00000000-0000-4000-8000-ffffffffffff", {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
  });
});

describe("crash-coherencia (NFR N2)", () => {
  it("después de todos los payloads malformados, el server sigue respondiendo", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
