import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { bootstrapDatabase } from "../src/db.js";
import { seedCounts } from "../src/db/seed.js";
import { buildSchemaDdl } from "../src/chat/schema.js";
import { createTools, openReadonlyConnection } from "../src/chat/tools.js";

// Unit tests de las tools (§11.5): SQLite REAL en archivo temp (patrón V0).
// N14: batería de SQL hostil 100% rechazada + DB intacta tras la suite.

let db: Database.Database;
let tmpDir: string;
let tools: ReturnType<typeof createTools>;
let countsBefore: Record<string, number>;

function runSql(sql: string) {
  return tools.run("sql_query", JSON.stringify({ sql }));
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-chat-tools-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  tools = createTools(db);
  countsBefore = seedCounts(db);
});

afterAll(() => {
  // N14: counts de las 6 tablas idénticos antes/después de toda la suite.
  expect(seedCounts(db)).toEqual(countsBefore);
  tools.close(); // libera la conn readonly antes de borrar el temp
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("sql_query — agregaciones correctas contra la DB real", () => {
  it("agrega deals por stage y cuadra con la query directa sobre la DB", () => {
    const result = runSql(
      "select stage, count(*) as n from deals where deleted_at is null group by stage order by stage"
    );
    expect(result.trace.ok).toBe(true);
    const got = JSON.parse(result.output).rows as Array<{ stage: string; n: number }>;

    const expected = db
      .prepare("select stage, count(*) as n from deals where deleted_at is null group by stage order by stage")
      .all() as Array<{ stage: string; n: number }>;
    expect(got).toEqual(expected);
    // Pin del seed: propuesta = 3, total = 16 (cross-checkeable contra /api/deals/pipeline).
    expect(got.find((r) => r.stage === "propuesta")?.n).toBe(3);
    expect(got.reduce((acc, r) => acc + r.n, 0)).toBe(16);
  });

  it("encuentra el deal más grande del seed", () => {
    const result = runSql("select title, amount_cents from deals order by amount_cents desc limit 1");
    expect(result.trace.ok).toBe(true);
    const row = (JSON.parse(result.output).rows as Array<{ title: string; amount_cents: number }>)[0];
    expect(row.title).toBe("Demand planning module");
    expect(row.amount_cents).toBe(31_200_000);
  });
});

describe("sql_query — LIMIT 50 forzado", () => {
  it("con 76 deals devuelve 50 filas y marca truncado", () => {
    const insert = db.prepare(
      `insert into deals (id, title, company_id, owner_id, amount_cents, currency, stage, created_at, updated_at)
       values (?, 'Volume deal', (select id from companies limit 1), (select id from users limit 1), 100, 'USD', 'nuevo', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    );
    db.transaction(() => {
      for (let i = 0; i < 60; i++) insert.run(`vol-${i}`);
    })();

    const result = runSql("select id from deals");
    const payload = JSON.parse(result.output);
    expect(payload.row_count).toBe(50);
    expect(payload.truncated).toBe(true);
    expect(result.trace.rows).toBe(50);
    // Sin LIMIT en el pedido: el wrapper lo forzó por construcción.
    expect(result.trace.ok).toBe(true);

    db.prepare("delete from deals where id like 'vol-%'").run(); // restaura la DB (N14)
  });

  it("respeta un LIMIT menor al cap si el modelo lo pide", () => {
    const result = runSql("select id from deals limit 3");
    expect(JSON.parse(result.output).row_count).toBe(3);
  });
});

describe("sql_query — batería N14: SQL hostil 100% rechazado, sin crash", () => {
  const hostile = [
    "insert into deals (id) values ('evil')",
    "update deals set amount_cents = 1",
    "delete from deals",
    "drop table deals",
    "pragma query_only = off",
    "attach database 'evil.db' as evil",
    "select 1; drop table deals", // multi-statement
    "with recursive c(x) as (select 1 union all select x + 1 from c) select x from c limit 5",
    "select * from deals where title = '' or 1=1 --", // inyección clásica (el -- rompe el wrapper)
    "vacuum",
  ];

  it.each(hostile)("rechaza: %s", (sql) => {
    const result = runSql(sql);
    expect(result.trace.ok).toBe(false);
    expect(result.trace.rows).toBe(0);
    expect(result.output).toMatch(/^error:/);
    // Sin internals: el mensaje es una guarda nuestra o un SqliteError acotado.
    expect(result.output).not.toMatch(/node_modules|[A-Z]:\\/i);
  });

  it("la DB queda intacta tras toda la batería", () => {
    expect(seedCounts(db)).toEqual(countsBefore);
    const tables = (
      db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>
    ).map((t) => t.name);
    expect(tables).toContain("deals");
    expect(tables).not.toContain("evil"); // el ATTACH no entró
  });
});

describe("sql_query — readonly garantizado en la conexión dedicada", () => {
  it("una escritura directa sobre la conn readonly lanza", () => {
    const ro = openReadonlyConnection(db.name);
    expect(ro.readonly).toBe(true);
    expect(() =>
      ro.prepare("insert into deals (id) values ('x')").run()
    ).toThrow();
    ro.close();
  });
});

describe("search_records — ranking LIKE ponderado", () => {
  it("hallar la empresa del seed por nombre (caso 'contexto de Brightpath')", () => {
    const result = tools.run("search_records", JSON.stringify({ q: "Brightpath" }));
    expect(result.trace.ok).toBe(true);
    expect(result.trace.q).toBe("Brightpath");
    const payload = JSON.parse(result.output);
    expect(payload.companies).toHaveLength(1);
    expect(payload.companies[0]).toMatchObject({ name: "Brightpath Health", score: 3 });
    expect(payload.companies[0].industry).toBe("Healthcare");
  });

  it("pondera nombre de deal (3) sobre subject de activity (2)", () => {
    // "fleet" matchea títulos de deals y nada más relevante.
    const result = tools.run("search_records", JSON.stringify({ q: "fleet" }));
    const payload = JSON.parse(result.output);
    const titles = (payload.deals as Array<{ title: string; score: number }>).map((d) => d.title);
    expect(titles).toContain("Fleet telematics rollout");
    expect(payload.deals[0].score).toBe(3);
    // orden determinista: score desc, luego id
    const scores = payload.deals.map((d: { score: number }) => d.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("suma score por término y columna (multi-término)", () => {
    // "Fleet renewal" → el deal "Fleet renewal — phase 1" puntúa 3+3=6.
    const result = tools.run("search_records", JSON.stringify({ q: "Fleet renewal" }));
    const payload = JSON.parse(result.output);
    expect(payload.deals[0]).toMatchObject({ title: "Fleet renewal — phase 1", score: 6 });
  });

  it("excluye filas soft-deleted", () => {
    db.prepare("update contacts set deleted_at = '2026-01-01T00:00:00.000Z' where full_name = 'Aria Brooks'").run();
    const result = tools.run("search_records", JSON.stringify({ q: "Aria" }));
    const names = (JSON.parse(result.output).contacts as Array<{ full_name: string }>).map((c) => c.full_name);
    expect(names).not.toContain("Aria Brooks");
    db.prepare("update contacts set deleted_at = null where full_name = 'Aria Brooks'").run();
  });

  it("q inválido → error de tool, no crash", () => {
    expect(tools.run("search_records", JSON.stringify({ q: "" })).trace.ok).toBe(false);
    expect(tools.run("search_records", JSON.stringify({ q: "a".repeat(201) })).trace.ok).toBe(false);
    expect(tools.run("search_records", JSON.stringify({ q: "x" })).trace.ok).toBe(false); // término < 2 chars
  });
});

describe("tools — entrada inválida del modelo", () => {
  it("tool desconocida y args no-JSON → tool-result de error", () => {
    expect(tools.run("rm_rf", "{}").output).toMatch(/^error: unknown tool/);
    expect(tools.run("sql_query", "not json").output).toMatch(/^error:/);
    expect(tools.run("sql_query", JSON.stringify({})).output).toMatch(/^error: sql is required/);
  });
});

describe("schema.ts — DDL runtime desde sqlite_master (no hardcodeado)", () => {
  it("contiene las tablas reales y excluye schema_migrations", () => {
    const ddl = buildSchemaDdl(db);
    for (const table of ["companies", "contacts", "deals", "stage_events", "activities", "users"]) {
      expect(ddl).toMatch(new RegExp(`create table ${table} `, "i"));
    }
    expect(ddl).not.toMatch(/schema_migrations/);
    // Columna real del seed, no un string inventado: el CHECK de stage vive en la DDL viva.
    expect(ddl).toMatch(/amount_cents integer not null check/);
  });

  it("refleja un ALTER en vivo (drift cerrado por construcción)", () => {
    db.exec("alter table contacts add column region text");
    expect(buildSchemaDdl(db)).toMatch(/region text/); // cache invalidada por schema_version
    db.exec("alter table contacts drop column region");
    expect(buildSchemaDdl(db)).not.toMatch(/region text/);
  });
});
