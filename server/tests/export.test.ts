import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { parse } from "csv-parse/sync";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// GET /api/export/:entity (H-07 / S09): contrato §12.2.2 + round-trip gate 3
// con csv-parse (parser RFC 4180 estándar, D-013) 1-a-1 contra la API.

const HOSTILE_NAME = 'Silva, María «La Croix»';
const HOSTILE_TITLE = 'Directora "Comercial" — Zona Ñ 🌎';

const CONTACT_COLUMNS = ["id", "full_name", "email", "phone", "title", "company_id", "company_name", "created_at", "updated_at"];
const DEAL_COLUMNS = ["id", "title", "company_id", "company_name", "contact_id", "contact_name", "owner_id", "owner_name", "amount_cents", "currency", "stage", "expected_close_at", "created_at", "updated_at"];

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;
let hostileContactId: string;
let deletedContactId: string;
let hostileDealId: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-export-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Export Test" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const companyId = (db.prepare("select id from companies limit 1").get() as { id: string }).id;
  const ownerId = (db.prepare("select id from users limit 1").get() as { id: string }).id;
  const post = async (pathName: string, body: unknown) =>
    (await app.request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    })) as Response;

  // Caso hostil AC3: coma, comillas dobles, acentos, Ñ, guillemets y emoji.
  const hostile = await post("/api/contacts", { full_name: HOSTILE_NAME, phone: "+1-555,0100", title: HOSTILE_TITLE, company_id: companyId });
  hostileContactId = ((await hostile.json()) as { contact: { id: string } }).contact.id;
  // Soft-deleted: debe quedar fuera del export (misma regla que el listado).
  const doomed = await post("/api/contacts", { full_name: "Temporal Borrado" });
  deletedContactId = ((await doomed.json()) as { contact: { id: string } }).contact.id;
  expect((await app.request(`/api/contacts/${deletedContactId}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);

  const hostileDeal = await post("/api/deals", {
    title: 'Renovación "Q4" — Europa, zona sur', company_id: companyId, owner_id: ownerId,
    amount_cents: 1_234_567, currency: "EUR", expected_close_at: "2027-03-01",
  });
  hostileDealId = ((await hostileDeal.json()) as { deal: { id: string } }).deal.id;
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function getExport(entity: string): Promise<{ res: Response; body: string }> {
  const res = await app.request(`/api/export/${entity}`, { headers: { cookie } });
  // Bytes crudos: Response.text() strippa el BOM (TextDecoder); Buffer no.
  const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
  return { res, body };
}

/** Página la API del listado completo (pageSize 100, demo dataset entra en 1). */
async function listApi(entity: string): Promise<Record<string, unknown>[]> {
  const res = await app.request(`/api/${entity}?page=1&pageSize=100`, { headers: { cookie } });
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  return body.items;
}

describe("GET /api/export/:entity — frontera", () => {
  it("sin cookie → 401", async () => {
    const res = await app.request("/api/export/contacts");
    expect(res.status).toBe(401);
  });

  it("entity inválida → 404 {ok:false} (mismo shape que notFound global)", async () => {
    const res = await app.request("/api/export/companies", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: "Not found" });
  });
});

describe("GET /api/export/:entity — contrato CSV exacto (§12.2.2)", () => {
  it("headers: content-type + disposition con entity y fecha ISO YYYYMMDD", async () => {
    const { res } = await getExport("contacts");
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="contacts-${today}.csv"`);
  });

  it("BOM EF BB BF presente y solo CRLF como fin de línea", async () => {
    const { body } = await getExport("deals");
    const bytes = Buffer.from(body, "utf8");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.startsWith("\uFEFF")).toBe(true);
    const sinCrLf = body.replaceAll("\r\n", "");
    expect(sinCrLf.includes("\r") || sinCrLf.includes("\n")).toBe(false);
  });

  it("contacts: header exacto + 1+N filas (N = total activo), soft-deleted excluido", async () => {
    const { body } = await getExport("contacts");
    const lines = body.slice(1).split("\r\n"); // sin BOM
    expect(lines[0]).toBe(CONTACT_COLUMNS.join(","));
    const items = await listApi("contacts");
    expect(lines.length).toBe(items.length + 2); // header + N + trailing CRLF
    const ids = lines.slice(1, -1).map((l) => (parse(l, { bom: false }) as string[][])[0][0]);
    expect(ids).not.toContain(deletedContactId);
    expect(ids).toContain(hostileContactId);
  });

  it("caso hostil AC: 'Silva, María «La Croix»' parsea limpio (columnas completas, valores íntegros)", async () => {
    const { body } = await getExport("contacts");
    const records = parse(body, { bom: true, columns: true }) as Record<string, string>[];
    const row = records.find((r) => r.id === hostileContactId)!;
    expect(Object.keys(row)).toEqual(CONTACT_COLUMNS);
    expect(row.full_name).toBe(HOSTILE_NAME);
    expect(row.title).toBe(HOSTILE_TITLE);
    expect(row.phone).toBe("+1-555,0100");
  });
});

describe("GET /api/export/:entity — ROUND-TRIP gate 3 (csv-parse vs API)", () => {
  // Columnas compartidas con la fila del listado API (contacts no expone
  // company_name en su listado: se verifica aparte).
  it("contacts: cada fila mapea 1-a-1 con la API (mismo id, orden y valores)", async () => {
    const { body } = await getExport("contacts");
    const records = parse(body, { bom: true, columns: true }) as Record<string, string>[];
    const items = await listApi("contacts");
    expect(records.map((r) => r.id)).toEqual(items.map((i) => String(i.id))); // orden espejo
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const item of items) {
      const row = byId.get(String(item.id))!;
      for (const col of CONTACT_COLUMNS) {
        if (col === "company_name") continue;
        expect(row[col], `${item.id}.${col}`).toBe(String(item[col] ?? ""));
      }
    }
    // company_name cuadra con la empresa de la fila (join verificado).
    const companies = await listApi("companies");
    const names = new Map(companies.map((c) => [String(c.id), String(c.name)]));
    for (const item of items) {
      const row = byId.get(String(item.id))!;
      expect(row.company_name, item.id).toBe(item.company_id ? names.get(String(item.company_id))! : "");
    }
  });

  it("deals: 14 columnas espejo, monto y moneda incluidos, 1-a-1 con la API", async () => {
    const { body } = await getExport("deals");
    const records = parse(body, { bom: true, columns: true }) as Record<string, string>[];
    const items = await listApi("deals");
    expect(records.map((r) => r.id)).toEqual(items.map((i) => String(i.id)));
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const item of items) {
      const row = byId.get(String(item.id))!;
      for (const col of DEAL_COLUMNS) {
        expect(row[col], `${item.id}.${col}`).toBe(String(item[col] ?? ""));
      }
    }
    const hostile = byId.get(hostileDealId)!;
    expect(hostile.title).toBe('Renovación "Q4" — Europa, zona sur');
    expect(hostile.amount_cents).toBe("1234567");
    expect(hostile.currency).toBe("EUR");
  });
});

describe("NFR N19 (demo dataset): export < 1 s", () => {
  it("contacts y deals exportan en < 1 s cada uno (DB demo)", async () => {
    for (const entity of ["contacts", "deals"]) {
      const t0 = performance.now();
      const { res } = await getExport(entity);
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      expect(ms, entity).toBeLessThan(1000);
    }
  });
});
