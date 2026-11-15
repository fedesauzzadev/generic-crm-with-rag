import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// Companies: CRUD + nombre único entre activas (409) + soft delete, con DB
// real en archivo temp (mismo estilo de suite que api.test.ts).

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-companies-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Company Tester" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function req(url: string, method: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("companies CRUD", () => {
  it("lista las empresas del seed de humo", async () => {
    const res = await app.request("/api/companies", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it("sin sesión → 401", async () => {
    const res = await app.request("/api/companies");
    expect(res.status).toBe(401);
  });

  it("crea, edita y devuelve una empresa", async () => {
    const created = (await (await req("/api/companies", "POST", { name: "Globex", industry: "Manufacturing" })).json()) as {
      company: { id: string; name: string; industry: string | null };
    };
    expect(created.company.name).toBe("Globex");

    const patched = (await (
      await req(`/api/companies/${created.company.id}`, "PATCH", { website: "https://globex.example" })
    ).json()) as { company: { website: string | null; industry: string | null } };
    expect(patched.company.website).toBe("https://globex.example");
    expect(patched.company.industry).toBe("Manufacturing"); // lo no enviado queda igual
  });

  it("rechaza nombre duplicado (activo) con 409", async () => {
    const res = await req("/api/companies", "POST", { name: "Globex" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Globex");
  });

  it("permite recrear el nombre tras soft delete (índice parcial)", async () => {
    const created = (await (await req("/api/companies", "POST", { name: "Initech" })).json()) as {
      company: { id: string };
    };
    await req(`/api/companies/${created.company.id}`, "DELETE");
    const again = await req("/api/companies", "POST", { name: "Initech" });
    expect(again.status).toBe(201);
  });

  it("rechaza payload inválido con 422 (sin nombre)", async () => {
    const res = await req("/api/companies", "POST", { industry: "NoName" });
    expect(res.status).toBe(422);
  });

  it("soft delete: desaparece del listado, GET por id 404", async () => {
    const created = (await (await req("/api/companies", "POST", { name: "Umbrella" })).json()) as {
      company: { id: string };
    };
    const del = await req(`/api/companies/${created.company.id}`, "DELETE");
    expect(del.status).toBe(200);

    const list = (await (await app.request("/api/companies?pageSize=100", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.find((i) => i.id === created.company.id)).toBeUndefined();

    const got = await app.request(`/api/companies/${created.company.id}`, { headers: { cookie } });
    expect(got.status).toBe(404);
  });

  it("GET de id inexistente da 404", async () => {
    const res = await app.request("/api/companies/00000000-0000-4000-8000-ffffffffffff", {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});
