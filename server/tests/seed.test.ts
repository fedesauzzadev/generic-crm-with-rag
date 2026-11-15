import Database from "better-sqlite3";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "../src/db.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty, seedCounts } from "../src/db/seed.js";
import { seedVolume } from "../src/db/seedVolume.js";
import { CREATION_STAGES, STAGES, canTransition, type Stage } from "../src/domain/pipeline.js";

// Invariantes del seed de demo (AC H-04 / invariante I10): densidad,
// cobertura de TODOS los stages, trazas acumuladas que respetan la tabla de
// transiciones, relaciones cuadradas, idempotencia y determinismo estricto.
// Todo contra SQLite real (en memoria) con el esquema de producción.

const MIGRATIONS = path.join(findRepoRoot(process.cwd()), "db", "migrations");

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db, MIGRATIONS);
  return db;
}

interface DealRow {
  id: string; company_id: string; contact_id: string | null; owner_id: string; stage: Stage;
}
interface EventRow { deal_id: string; from_stage: string | null; to_stage: string; created_at: string }

/** Dump completo y ordenado de todas las tablas — para comparar corridas. */
function dump(db: Database.Database): string {
  const tables = ["users", "companies", "contacts", "deals", "stage_events", "activities"];
  return tables
    .map((t) => JSON.stringify(db.prepare(`select * from ${t} order by id`).all()))
    .join("\n");
}

describe("seed de demo: densidad (AC H-04)", () => {
  it("cumple los mínimos: ≥10 contacts, ≥5 companies, ≥15 deals, ≥15 activities", () => {
    const db = freshDb();
    expect(seedIfEmpty(db)).toBe(true);
    const counts = seedCounts(db);
    expect(counts.users).toBeGreaterThanOrEqual(3); // owners para los deals
    expect(counts.contacts).toBeGreaterThanOrEqual(10);
    expect(counts.companies).toBeGreaterThanOrEqual(5);
    expect(counts.deals).toBeGreaterThanOrEqual(15);
    expect(counts.activities).toBeGreaterThanOrEqual(15);
    // Totales exactos: el shape del seed es parte del contrato determinista.
    expect(counts).toEqual({ users: 5, companies: 6, contacts: 12, deals: 16, stage_events: 37, activities: 16 });
    db.close();
  });

  it("cubre TODOS los stages del pipeline, con ≥1 ganado y ≥1 perdido", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const rows = db.prepare("select stage, count(*) as n from deals group by stage").all() as {
      stage: Stage; n: number;
    }[];
    const byStage = new Map(rows.map((r) => [r.stage, r.n]));
    for (const stage of STAGES) expect(byStage.get(stage) ?? 0, `stage ${stage}`).toBeGreaterThanOrEqual(1);
    expect(byStage.get("ganado")).toBeGreaterThanOrEqual(1);
    expect(byStage.get("perdido")).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("montos > 0 con moneda explícita y mayoría USD + alguna otra", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const deals = db.prepare("select amount_cents, currency from deals").all() as {
      amount_cents: number; currency: string;
    }[];
    for (const d of deals) {
      expect(d.amount_cents).toBeGreaterThan(0);
      expect(d.currency).toMatch(/^[A-Z]{3}$/);
    }
    const usd = deals.filter((d) => d.currency === "USD").length;
    expect(usd).toBeGreaterThan(deals.length / 2);
    expect(deals.length - usd).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("activities: tipos variados y ninguna huérfana (I6)", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const types = db.prepare("select distinct type from activities").all() as { type: string }[];
    expect(types.map((t) => t.type).sort()).toEqual(["call", "email", "meeting", "task"]);
    const orphans = db
      .prepare("select count(*) as n from activities where contact_id is null and deal_id is null")
      .get() as { n: number };
    expect(orphans.n).toBe(0);
    // Mezcla de estados: pendientes y hechas.
    const states = db
      .prepare("select sum(done_at is null) as pending, sum(done_at is not null) as done from activities")
      .get() as { pending: number; done: number };
    expect(states.pending).toBeGreaterThanOrEqual(1);
    expect(states.done).toBeGreaterThanOrEqual(1);
    db.close();
  });
});

describe("seed de demo: relaciones y trazas (AC H-04 / I10)", () => {
  it("todo deal tiene owner/company existentes (contact opcional pero válido)", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const deals = db.prepare("select id, company_id, contact_id, owner_id from deals").all() as DealRow[];
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      expect(db.prepare("select 1 from companies where id = ?").get(d.company_id)).toBeTruthy();
      expect(db.prepare("select 1 from users where id = ?").get(d.owner_id)).toBeTruthy();
      if (d.contact_id !== null) {
        expect(db.prepare("select 1 from contacts where id = ?").get(d.contact_id)).toBeTruthy();
      }
    }
    // Cobertura de owners: más de un owner distinto (realismo).
    const owners = db.prepare("select distinct owner_id from deals").all() as { owner_id: string }[];
    expect(owners.length).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it("ninguna activity referencia filas inexistentes", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const acts = db
      .prepare("select contact_id, deal_id from activities")
      .all() as { contact_id: string | null; deal_id: string | null }[];
    for (const a of acts) {
      if (a.contact_id) expect(db.prepare("select 1 from contacts where id = ?").get(a.contact_id)).toBeTruthy();
      if (a.deal_id) expect(db.prepare("select 1 from deals where id = ?").get(a.deal_id)).toBeTruthy();
    }
    // Los contacts referencian companies existentes (o ninguna).
    for (const c of db.prepare("select company_id from contacts where company_id is not null").all() as { company_id: string }[]) {
      expect(db.prepare("select 1 from companies where id = ?").get(c.company_id)).toBeTruthy();
    }
    db.close();
  });

  it("traza de cada deal: nace con from_stage null y acumula SOLO transiciones válidas", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const deals = db.prepare("select id, stage from deals").all() as DealRow[];
    for (const deal of deals) {
      const events = db
        .prepare("select from_stage, to_stage from stage_events where deal_id = ? order by rowid")
        .all(deal.id) as EventRow[];
      expect(events.length, `deal ${deal.id} sin traza`).toBeGreaterThanOrEqual(1);
      // La traza nace con el deal.
      expect(events[0].from_stage).toBeNull();
      expect((CREATION_STAGES as readonly string[])).toContain(events[0].to_stage);
      // Cada paso consecutivo es una transición válida de la tabla §2.
      for (let i = 1; i < events.length; i++) {
        expect(events[i].from_stage).toBe(events[i - 1].to_stage);
        expect(canTransition(events[i - 1].to_stage as Stage, events[i].to_stage as Stage), `${events[i - 1].to_stage}→${events[i].to_stage}`).toBe(true);
      }
      // El último evento deja el deal en su stage actual.
      expect(events[events.length - 1].to_stage).toBe(deal.stage);
      // Coherencia temporal: eventos en orden cronológico no decreciente.
      const times = db
        .prepare("select created_at from stage_events where deal_id = ? order by rowid")
        .all(deal.id) as { created_at: string }[];
      for (let i = 1; i < times.length; i++) {
        expect(times[i].created_at >= times[i - 1].created_at).toBe(true);
      }
    }
    // Los deals avanzados (ganado) tienen historia acumulada, no solo nacimiento.
    const wonHistories = db
      .prepare(`select count(*) as n from stage_events e join deals d on d.id = e.deal_id where d.stage = 'ganado'`)
      .get() as { n: number };
    expect(wonHistories.n).toBeGreaterThanOrEqual(2 * 2); // ≥2 ganados con cadena ≥nuevo→calificado→propuesta→ganado
    db.close();
  });
});

describe("seed de demo: idempotencia y determinismo (AC H-04)", () => {
  it("re-seed sobre DB poblada es no-op: no duplica nada", () => {
    const db = freshDb();
    seedIfEmpty(db);
    const before = seedCounts(db);
    expect(seedIfEmpty(db)).toBe(false);
    expect(seedCounts(db)).toEqual(before);
    db.close();
  });

  it("dos corridas sobre DB vírgenes producen EXACTAMENTE la misma data", () => {
    const dbA = freshDb();
    const dbB = freshDb();
    seedIfEmpty(dbA);
    seedIfEmpty(dbB);
    expect(dump(dbB)).toBe(dump(dbA));
    dbA.close();
    dbB.close();
  });
});

describe("seed de volumen (NFR N7)", () => {
  it("completa exactamente 10k contacts y 1k deals, determinista y con relaciones válidas", () => {
    const dbA = freshDb();
    seedIfEmpty(dbA);
    const inserted = seedVolume(dbA);
    expect(inserted).toEqual({ contacts: 10_000 - 12, deals: 1_000 - 16 });
    expect(seedCounts(dbA)).toEqual({
      users: 5,
      companies: 6,
      contacts: 10_000,
      deals: 1_000,
      stage_events: 37 + 1_000 - 16,
      activities: 16,
    });
    // FKs cuadradas: sin ellas el insert habría fallado con foreign_keys=ON;
    // además ningún deal quedó sin su evento inicial.
    const noEvent = dbA
      .prepare("select count(*) as n from deals d where not exists (select 1 from stage_events e where e.deal_id = d.id)")
      .get() as { n: number };
    expect(noEvent.n).toBe(0);
    const badStage = dbA
      .prepare("select count(*) as n from deals where stage = 'ganado' and id not in (select deal_id from stage_events where to_stage = 'ganado')")
      .get() as { n: number };
    expect(badStage.n).toBe(0);

    // Determinismo del volumen: misma PRNG seed → misma data.
    const dbB = freshDb();
    seedIfEmpty(dbB);
    seedVolume(dbB);
    const fingerprint = (db: Database.Database): string =>
      JSON.stringify({
        c: db.prepare("select email from contacts order by id").all(),
        d: db.prepare("select title, amount_cents, currency, stage from deals order by id").all(),
        e: db.prepare("select deal_id, to_stage from stage_events order by id").all(),
      });
    expect(fingerprint(dbB)).toBe(fingerprint(dbA));
    dbA.close();
    dbB.close();
  });
});
