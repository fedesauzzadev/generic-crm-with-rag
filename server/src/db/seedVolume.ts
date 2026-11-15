import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { bootstrapDatabase, findRepoRoot } from "../db.js";

// Seed de VOLUMEN para el bench de performance (NFR N7). NO corre en el
// arranque: solo vía `npm run seed:volume`. Determinista: PRNG mulberry32
// con seed fija → misma data en cada corrida (invariante I10 también acá).
// Completa el demo seed hasta 10.000 contacts y 1.000 deals exactos.

const CONTACT_TARGET = 10_000;
const DEAL_TARGET = 1_000;
const SEED = 42;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Aiden", "Bella", "Cyrus", "Dalia", "Ezra", "Fiona", "Gustav", "Hana", "Iker", "Jade", "Kian", "Lena", "Mateo", "Nadia", "Omar", "Paloma", "Quinn", "Rania", "Soren", "Talia", "Ulises", "Vera", "Wren", "Ximena", "Yusuf", "Zara", "Anya", "Bruno", "Celia", "Dev"];
const LAST_NAMES = ["Ashford", "Bianchi", "Calloway", "Duarte", "Everly", "Farrow", "Galloway", "Huxley", "Ibarra", "Jansen", "Keller", "Lombard", "Mireles", "Novak", "Okafor", "Presley", "Quintero", "Rhodes", "Sandoval", "Thorne", "Urbina", "Vasquez", "Whitmore", "Xiong", "Ybarra", "Zamora", "Alcott", "Bishop", "Cruz", "Delaney"];
const CONTACT_TITLES = ["Operations Analyst", "Sales Manager", "IT Director", "Procurement Lead", "Marketing Manager", "Finance Controller", "Support Lead", "Product Owner"];
const DEAL_SUBJECTS = ["Platform rollout", "License renewal", "Integration project", "Data migration", "Pilot program", "Support package", "Training engagement", "Infrastructure upgrade", "Analytics retainer", "Automation pilot"];

function volId(prefix: number, n: number): string {
  return `00000000-0000-4000-8000-${(prefix + n).toString(16).padStart(12, "0")}`;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Agrega filas de volumen sobre el demo seed existente hasta los targets
 * exactos (10k contacts, 1k deals). Devuelve las cantidades insertadas.
 */
export function seedVolume(db: Database.Database): { contacts: number; deals: number } {
  const rand = mulberry32(SEED);
  const existingContacts = (db.prepare("select count(*) as n from contacts").get() as { n: number }).n;
  const existingDeals = (db.prepare("select count(*) as n from deals").get() as { n: number }).n;
  const contactsToInsert = Math.max(0, CONTACT_TARGET - existingContacts);
  const dealsToInsert = Math.max(0, DEAL_TARGET - existingDeals);

  const companyIds = (db.prepare("select id from companies order by id").all() as { id: string }[]).map((r) => r.id);
  const userIds = (db.prepare("select id from users order by id").all() as { id: string }[]).map((r) => r.id);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  // Stages permitidos al CREAR (tabla §2): ganado no puede ser inicial.
  const VOLUME_STAGES = ["nuevo", "calificado", "propuesta", "perdido"] as const;

  db.transaction(() => {
    const insertContact = db.prepare(
      `insert into contacts (id, full_name, email, phone, title, company_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < contactsToInsert; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const at = iso(Date.parse("2025-06-01T08:00:00.000Z") + i * 6 * 3_600_000);
      insertContact.run(
        volId(0x1_0000, i),
        `${first} ${last}`,
        `${first.toLowerCase()}.${last.toLowerCase()}${i}@volcrm.example`,
        `+1-555-${String(2000 + (i % 7000)).padStart(4, "0")}`,
        pick(CONTACT_TITLES),
        rand() < 0.9 ? pick(companyIds) : null,
        at,
        at
      );
    }

    const insertDeal = db.prepare(
      `insert into deals (id, title, company_id, contact_id, owner_id, amount_cents, currency,
         stage, expected_close_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEvent = db.prepare(
      "insert into stage_events (id, deal_id, from_stage, to_stage, actor, created_at) values (?, ?, null, ?, ?, ?)"
    );
    for (let i = 0; i < dealsToInsert; i++) {
      const stage = VOLUME_STAGES[Math.floor(rand() * VOLUME_STAGES.length)];
      const createdAt = iso(Date.parse("2026-01-05T09:00:00.000Z") + i * 6 * 3_600_000);
      const id = volId(0x2_0000, i);
      const contactId =
        rand() < 0.8
          ? (db.prepare("select id from contacts order by id limit 1 offset ?").get(Math.floor(rand() * (existingContacts + contactsToInsert))) as { id: string }).id
          : null;
      insertDeal.run(
        id,
        `${pick(DEAL_SUBJECTS)} #${1000 + i}`,
        pick(companyIds),
        contactId,
        pick(userIds),
        Math.round((50_000 + rand() * 19_950_000) / 100) * 100, // $500–$200k, centavos exactos
        rand() < 0.12 ? "EUR" : "USD",
        stage,
        iso(Date.parse("2026-12-01T00:00:00.000Z") + Math.floor(rand() * 120) * 86_400_000).slice(0, 10),
        createdAt,
        createdAt
      );
      insertEvent.run(volId(0x3_0000, i), id, stage, "seed", createdAt);
    }
  })();

  return { contacts: contactsToInsert, deals: dealsToInsert };
}

// CLI (`npm run seed:volume`): DB limpia → migrar → demo seed + volumen.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const dbFile = path.join(root, "db", "data", "crm.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(dbFile + suffix, { force: true });
  }
  const db = bootstrapDatabase(dbFile); // migra + demo seed (bootstrap completo)
  const inserted = seedVolume(db);
  const counts = {
    contacts: (db.prepare("select count(*) as n from contacts").get() as { n: number }).n,
    deals: (db.prepare("select count(*) as n from deals").get() as { n: number }).n,
    stage_events: (db.prepare("select count(*) as n from stage_events").get() as { n: number }).n,
  };
  console.log(`[seed:volume] inserted +${inserted.contacts} contacts, +${inserted.deals} deals`);
  console.log(`[seed:volume] totals: ${JSON.stringify(counts)}`);
  db.close();
}
