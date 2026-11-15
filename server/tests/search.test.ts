import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// GET /api/search (H-08, §12.2.3): grupos SIEMPRE presentes, top 5 por grupo,
// score ponderado D-011 (desc, id desempate), deleted excluidos, q 2..100 →
// 422 fuera. + GET /api/contacts/:id y /api/companies/:id extendidos (S10).

interface SearchItem {
  id: string;
  score: number;
  full_name?: string;
  title?: string | null;
  email?: string | null;
  company_name?: string | null;
  name?: string;
  industry?: string | null;
  stage?: string;
  amount_cents?: number;
  currency?: string;
}

interface SearchBody {
  ok: boolean;
  q: string;
  total: number;
  groups: { entity: string; items: SearchItem[] }[];
}

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-search-"));
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

async function search(q: string): Promise<{ res: Response; body: SearchBody }> {
  const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers: { cookie } });
  return { res, body: (await res.json()) as SearchBody };
}

const GROUP_ENTITIES = ["contacts", "companies", "deals"];

describe("GET /api/search — sesión y validación (§12.2.3)", () => {
  it("sin cookie → 401", async () => {
    const res = await app.request("/api/search?q=brigh");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("q ausente / 1 char / 101 chars → 422 con {ok:false,message}", async () => {
    for (const q of ["", "a", "x".repeat(101)]) {
      const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers: { cookie } });
      expect(res.status, `q="${q.slice(0, 12)}"`).toBe(422);
      const body = (await res.json()) as { ok: boolean; message: string };
      expect(body.ok).toBe(false);
      expect(body.message.startsWith("q:")).toBe(true);
    }
  });

  it("q solo espacios → trim → 422 (min 2)", async () => {
    const res = await app.request("/api/search?q=%20%20%20", { headers: { cookie } });
    expect(res.status).toBe(422);
  });

  it("tras el 422 el server sigue vivo (N2)", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/search — contrato de grupos (AC1/AC2/AC4/AC5)", () => {
  it("'bright' → 3 grupos SIEMPRE en orden fijo, Brightpath en companies con score top", async () => {
    const { res, body } = await search("bright");
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.q).toBe("bright");
    expect(body.groups.map((g) => g.entity)).toEqual(GROUP_ENTITIES);
    const companies = body.groups.find((g) => g.entity === "companies")!;
    expect(companies.items[0]).toMatchObject({ name: "Brightpath Health", industry: "Healthcare" });
    // Score desciende dentro del grupo (D-011: name 3 + industry 2).
    const scores = companies.items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("case-insensitive ASCII: 'BRIGHT' halla lo mismo que 'bright'", async () => {
    const { body } = await search("BRIGHT");
    expect(body.groups.find((g) => g.entity === "companies")!.items[0]).toMatchObject({
      name: "Brightpath Health",
    });
  });

  it("'brightpath health' → los 3 grupos poblados (AC2: empresa + SUS contactos + SUS deals)", async () => {
    const { body } = await search("brightpath health");
    const contacts = body.groups.find((g) => g.entity === "contacts")!;
    const companies = body.groups.find((g) => g.entity === "companies")!;
    const deals = body.groups.find((g) => g.entity === "deals")!;
    // Elena Sokolov matchea por company_name (peso 3): su nombre no contiene "brightpath".
    expect(contacts.items.map((i) => i.full_name)).toContain("Elena Sokolov");
    expect(companies.items[0]).toMatchObject({ name: "Brightpath Health" });
    // Los 2 deals de Brightpath ("Analytics workspace pilot", "Patient scheduling
    // revamp") matchean por company_name — sus títulos no contienen el término.
    const titles = deals.items.map((i) => i.title);
    expect(titles).toContain("Analytics workspace pilot");
    expect(titles).toContain("Patient scheduling revamp");
    expect(body.total).toBe(body.groups.reduce((acc, g) => acc + g.items.length, 0));
  });

  it("item shapes: contacts (id,full_name,title,email,company_name,score) · deals (con stage/monto/moneda)", async () => {
    const { body } = await search("brightpath health");
    const contact = body.groups.find((g) => g.entity === "contacts")!.items[0];
    expect(contact).toMatchObject({ full_name: "Elena Sokolov", company_name: "Brightpath Health", email: expect.stringContaining("@") });
    expect(typeof contact.id).toBe("string");
    const deal = body.groups.find((g) => g.entity === "deals")!.items[0];
    expect(deal).toMatchObject({ stage: expect.any(String), amount_cents: expect.any(Number), currency: "USD" });
  });

  it("score ponderado ordena: título que matchea ambos términos (6) arriba del que matchea uno (3)", async () => {
    const { body } = await search("fleet renewal");
    const deals = body.groups.find((g) => g.entity === "deals")!.items;
    expect(deals[0]).toMatchObject({ title: "Fleet renewal — phase 1", score: 6 });
    expect(deals[1]).toMatchObject({ title: "Fleet telematics rollout", score: 3 });
    const scores = deals.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("sin matches ('zzqqxw') → 200 con 3 grupos VACÍOS y total 0 (AC5, sin crash)", async () => {
    const { res, body } = await search("zzqqxw");
    expect(res.status).toBe(200);
    expect(body.groups).toEqual(GROUP_ENTITIES.map((entity) => ({ entity, items: [] })));
    expect(body.total).toBe(0);
  });

  it("q válida sin términos buscables ('a b') → 200 con 3 grupos vacíos (tokenizador ≥2)", async () => {
    const { res, body } = await search("a b");
    expect(res.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.groups).toHaveLength(3);
  });

  it("LÍMITE DOCUMENTADO: LIKE de SQLite es case-insensitive solo ASCII — acentos exactos sí, folding no", async () => {
    db.prepare(
      `insert into contacts (id, full_name, email, phone, title, company_id, created_at, updated_at)
       values ('accent-test-1', 'María González', null, null, null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    const withAccent = await search("maría");
    expect(
      withAccent.body.groups.find((g) => g.entity === "contacts")!.items.map((i) => i.full_name)
    ).toContain("María González");
    const withoutAccent = await search("maria");
    expect(
      withoutAccent.body.groups.find((g) => g.entity === "contacts")!.items.map((i) => i.full_name)
    ).not.toContain("María González");
  });
});

describe("GET /api/search — top 5 y deleted excluidos (gate 6)", () => {
  it("más de 5 matches → exactamente 5 en el grupo", async () => {
    const insert = db.prepare(
      `insert into contacts (id, full_name, email, phone, title, company_id, created_at, updated_at)
       values (?, ?, null, null, null, null, ?, ?)`
    );
    const now = new Date().toISOString();
    for (let i = 1; i <= 7; i++) insert.run(`zz-contacts-${i}`, `Zzdemo Contact ${i}`, now, now);
    const { body } = await search("zzdemo");
    const contacts = body.groups.find((g) => g.entity === "contacts")!;
    expect(contacts.items).toHaveLength(5);
    for (const item of contacts.items) expect(item.full_name).toContain("Zzdemo");
  });

  it("soft-deleted con nombre matcheante NO aparece (registro borrado fuera; el deal vivo de una company borrada sigue visible — mismo criterio que el listado)", async () => {
    db.prepare("update contacts set deleted_at = ? where id = 'zz-contacts-1'").run(
      new Date().toISOString()
    );
    const { body } = await search("zzdemo");
    const remaining = body.groups.find((g) => g.entity === "contacts")!.items;
    expect(remaining).toHaveLength(5); // siguen siendo 5: entró el 6°/7°
    // Company borrada → fuera de SU grupo…
    const company = db.prepare("select id from companies where name = 'Brightpath Health'").get() as { id: string };
    db.prepare("update companies set deleted_at = ? where id = ?").run(new Date().toISOString(), company.id);
    const afterCompany = await search("brightpath");
    expect(afterCompany.body.groups.find((g) => g.entity === "companies")!.items).toEqual([]);
    // …y el DEAL borrado cuyo título matchea también fuera del suyo.
    const deal = db.prepare("select id from deals where title = 'Analytics workspace pilot'").get() as { id: string };
    db.prepare("update deals set deleted_at = ? where id = ?").run(new Date().toISOString(), deal.id);
    const afterDeal = await search("analytics workspace");
    expect(afterDeal.body.groups.find((g) => g.entity === "deals")!.items).toEqual([]);
    // Restore: los tests de detalle posteriores usan este seed.
    db.prepare("update deals set deleted_at = null where id = ?").run(deal.id);
    db.prepare("update companies set deleted_at = null where id = ?").run(company.id);
  });
});

describe("GET /api/contacts/:id y /api/companies/:id — detalle extendido (S10)", () => {
  it("contacto del seed → 200 con company_name joineada + sus deals activos", async () => {
    const elena = db.prepare("select id from contacts where full_name = 'Elena Sokolov'").get() as { id: string };
    const res = await app.request(`/api/contacts/${elena.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      contact: {
        full_name: string;
        company_name: string | null;
        email: string | null;
        deals: { id: string; title: string; stage: string; company_name: string; owner_name: string }[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.contact.full_name).toBe("Elena Sokolov");
    expect(body.contact.company_name).toBe("Brightpath Health");
    expect(body.contact.deals.map((d) => d.title).sort()).toEqual([
      "Analytics workspace pilot",
      "Patient scheduling revamp",
    ]);
  });

  it("empresa del seed → 200 con company + contactos + deals", async () => {
    const northwind = db.prepare("select id from companies where name = 'Northwind Logistics'").get() as { id: string };
    const res = await app.request(`/api/companies/${northwind.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      company: { name: string };
      contacts: { full_name: string }[];
      deals: { title: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.company.name).toBe("Northwind Logistics");
    expect(body.contacts.map((c) => c.full_name).sort()).toEqual(["Aria Brooks", "Felix Grant"]);
    expect(body.deals.length).toBeGreaterThanOrEqual(4); // 5 deals seed de Northwind
  });

  it("id inexistente → 404 en ambos; sin cookie → 401", async () => {
    const notFound = await app.request("/api/contacts/00000000-0000-4000-8000-ffffffffffff", { headers: { cookie } });
    expect(notFound.status).toBe(404);
    const notFoundCo = await app.request("/api/companies/00000000-0000-4000-8000-ffffffffffff", { headers: { cookie } });
    expect(notFoundCo.status).toBe(404);
    const unauth = await app.request(`/api/contacts/${(db.prepare("select id from contacts limit 1").get() as { id: string }).id}`);
    expect(unauth.status).toBe(401);
  });
});
