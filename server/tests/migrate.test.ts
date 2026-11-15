import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { findRepoRoot } from "../src/db.js";
import { migrate } from "../src/db/migrate.js";

// Unit del migrador: DB real (memoria para migraciones sintéticas, esquema
// real para el test de tablas). Las invariantes del seed viven en
// seed.test.ts (desde S04 el seed es el realista de demo).

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe("migrator", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function newMigrationsDir(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "crm-migrations-"));
    dirs.push(dir);
    for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
    return dir;
  }

  it("aplica migraciones nuevas en orden y las registra en schema_migrations", () => {
    const dir = newMigrationsDir({
      "0001_a.sql": "create table if not exists t_a (id text);",
      "0002_b.sql": "create table if not exists t_b (id text);",
    });
    const db = new Database(":memory:");

    const ran = migrate(db, dir);

    expect(ran).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(tableNames(db)).toContain("t_a");
    expect(tableNames(db)).toContain("t_b");
    const registered = db.prepare("select name from schema_migrations order by name").all() as {
      name: string;
    }[];
    expect(registered.map((r) => r.name)).toEqual(["0001_a.sql", "0002_b.sql"]);
    db.close();
  });

  it("es idempotente: una segunda corrida no aplica nada", () => {
    const dir = newMigrationsDir({ "0001_a.sql": "create table if not exists t_a (id text);" });
    const db = new Database(":memory:");
    migrate(db, dir);

    expect(migrate(db, dir)).toEqual([]);
    db.close();
  });

  it("aplica cada migración en transacción: si falla a mitad, rollback completo de esa migración", () => {
    const dir = newMigrationsDir({
      "0001_ok.sql": "create table if not exists t_ok (id text);",
      "0002_bad.sql": "create table if not exists t_bad (id text); insert into nope values (1);",
    });
    const db = new Database(":memory:");

    expect(() => migrate(db, dir)).toThrow();

    // 0001 quedó aplicada y registrada; 0002 se revierte entera.
    expect(tableNames(db)).toContain("t_ok");
    expect(tableNames(db)).not.toContain("t_bad");
    const registered = db.prepare("select name from schema_migrations").all() as { name: string }[];
    expect(registered.map((r) => r.name)).toEqual(["0001_ok.sql"]);
    db.close();
  });

  it("el esquema real crea las 6 tablas del modelo de dominio", () => {
    const db = new Database(":memory:");
    migrate(db, path.join(findRepoRoot(process.cwd()), "db", "migrations"));

    const tables = tableNames(db);
    for (const expected of ["companies", "users", "contacts", "deals", "stage_events", "activities"]) {
      expect(tables).toContain(expected);
    }
    db.close();
  });
});
