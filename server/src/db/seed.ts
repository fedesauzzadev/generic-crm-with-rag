import type Database from "better-sqlite3";

// Seed realista de demo (H-04 / S04): densidad para que el backoffice se
// aprecie en una demo de portafolio. Datos 100% inventados, nombres en
// inglés creíbles (audiencia portafolio), cero referencias a proyectos
// reales. Determinista (invariante I10): ids, timestamps y relaciones
// fijos — dos corridas producen exactamente la misma DB.

const DAY_MS = 86_400_000;

/** UUID determinista: versión-4 shaped, sufijo hex fijo por fila. */
function uuid(suffix: string): string {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

// ----------------------------------------------------------------------------
// Users — owners de deals (supuesto de spec: sin CRUD de usuarios en MVP).
// role es solo realismo del seed, NO autoriza nada (D-006).
// ----------------------------------------------------------------------------
const USERS = [
  { id: uuid("01"), name: "Dana Ruiz", email: "dana.ruiz@plaincrm.dev", role: "senior" },
  { id: uuid("02"), name: "Milo Vega", email: "milo.vega@plaincrm.dev", role: "owner" },
  { id: uuid("03"), name: "Ivy Chen", email: "ivy.chen@plaincrm.dev", role: "owner" },
  { id: uuid("04"), name: "Owen Barrett", email: "owen.barrett@plaincrm.dev", role: "senior" },
  { id: uuid("05"), name: "Lara Moss", email: "lara.moss@plaincrm.dev", role: "owner" },
];

// ----------------------------------------------------------------------------
// Companies — rubros variados (domain-model §5).
// ----------------------------------------------------------------------------
const COMPANIES = [
  { id: uuid("11"), name: "Northwind Logistics", industry: "Logistics", website: "https://northwindlogistics.example" },
  { id: uuid("12"), name: "Acme Software", industry: "SaaS", website: "https://acmesoftware.example" },
  { id: uuid("13"), name: "Blueharbor Retail", industry: "Retail", website: "https://blueharborretail.example" },
  { id: uuid("14"), name: "Meridian Consulting", industry: "Consulting", website: "https://meridianconsulting.example" },
  { id: uuid("15"), name: "Ironclad Manufacturing", industry: "Manufacturing", website: "https://ironcladmfg.example" },
  { id: uuid("16"), name: "Brightpath Health", industry: "Healthcare", website: "https://brightpathhealth.example" },
];

// ----------------------------------------------------------------------------
// Contacts — emails coherentes con la empresa; varios comparten company
// (relación 1:N realista) y algunos son independientes (sin empresa).
// ----------------------------------------------------------------------------
const CONTACTS: Array<{
  id: string; name: string; email: string; phone: string; title: string; company: string | null;
}> = [
  { id: uuid("21"), name: "Aria Brooks", email: "aria.brooks@northwindlogistics.example", phone: "+1-555-0101", title: "Ops Lead", company: COMPANIES[0].id },
  { id: uuid("22"), name: "Felix Grant", email: "felix.grant@northwindlogistics.example", phone: "+1-555-0102", title: "Fleet Manager", company: COMPANIES[0].id },
  { id: uuid("23"), name: "Nora Patel", email: "nora.patel@acmesoftware.example", phone: "+1-555-0103", title: "CTO", company: COMPANIES[1].id },
  { id: uuid("24"), name: "Ben Carter", email: "ben.carter@acmesoftware.example", phone: "+1-555-0104", title: "Product Lead", company: COMPANIES[1].id },
  { id: uuid("25"), name: "Selma Ortiz", email: "selma.ortiz@blueharborretail.example", phone: "+1-555-0105", title: "Head of Purchasing", company: COMPANIES[2].id },
  { id: uuid("26"), name: "Jonas Weber", email: "jonas.weber@meridianconsulting.example", phone: "+1-555-0106", title: "Managing Partner", company: COMPANIES[3].id },
  { id: uuid("27"), name: "Priya Nair", email: "priya.nair@meridianconsulting.example", phone: "+1-555-0107", title: "Engagement Director", company: COMPANIES[3].id },
  { id: uuid("28"), name: "Marcus Hale", email: "marcus.hale@ironcladmfg.example", phone: "+1-555-0108", title: "Plant Director", company: COMPANIES[4].id },
  { id: uuid("29"), name: "Elena Sokolov", email: "elena.sokolov@brightpathhealth.example", phone: "+1-555-0109", title: "Clinical Ops Manager", company: COMPANIES[5].id },
  { id: uuid("2a"), name: "Theo Lindqvist", email: "theo.lindqvist@example.com", phone: "+1-555-0110", title: "Independent Consultant", company: null },
  { id: uuid("2b"), name: "Rosa Delgado", email: "rosa.delgado@example.com", phone: "+1-555-0111", title: "Procurement Advisor", company: null },
  { id: uuid("2c"), name: "Sam Whitfield", email: "sam.whitfield@example.com", phone: "+1-555-0112", title: "Freelance Analyst", company: null },
];

// ----------------------------------------------------------------------------
// Deals — path = historia de stages ACUMULADA desde la creación. El primer
// elemento es el evento de creación (from_stage null); cada paso respeta la
// tabla de transiciones (domain-model §2): sin saltos adelante, ganado solo
// desde propuesta, perdible desde cualquier etapa abierta. stage final =
// último del path; created_at = primer evento; updated_at = último.
// ----------------------------------------------------------------------------
interface SeedDeal {
  id: string;
  title: string;
  company: string;
  contact: string | null;
  owner: string;
  amountCents: number;
  currency: string;
  closeAt: string;
  path: Array<[stage: string, at: string]>;
}

const DEALS: SeedDeal[] = [
  { id: uuid("41"), title: "Fleet telematics rollout", company: COMPANIES[0].id, contact: CONTACTS[0].id, owner: USERS[0].id, amountCents: 1_850_000, currency: "USD", closeAt: "2026-12-18", path: [["nuevo", "2026-10-05T14:00:00.000Z"]] },
  { id: uuid("42"), title: "Warehouse slotting analysis", company: COMPANIES[0].id, contact: CONTACTS[1].id, owner: USERS[1].id, amountCents: 950_000, currency: "USD", closeAt: "2027-01-15", path: [["nuevo", "2026-10-21T09:30:00.000Z"]] },
  { id: uuid("43"), title: "SSO platform license", company: COMPANIES[1].id, contact: CONTACTS[2].id, owner: USERS[2].id, amountCents: 7_200_000, currency: "EUR", closeAt: "2026-12-20", path: [["nuevo", "2026-11-02T16:00:00.000Z"]] },
  { id: uuid("44"), title: "Analytics workspace pilot", company: COMPANIES[5].id, contact: CONTACTS[8].id, owner: USERS[4].id, amountCents: 2_400_000, currency: "USD", closeAt: "2027-02-01", path: [["nuevo", "2026-11-09T11:00:00.000Z"]] },
  { id: uuid("45"), title: "Route optimization phase 2", company: COMPANIES[0].id, contact: CONTACTS[0].id, owner: USERS[0].id, amountCents: 12_800_000, currency: "USD", closeAt: "2026-12-10", path: [["nuevo", "2026-09-14T10:00:00.000Z"], ["calificado", "2026-09-30T15:00:00.000Z"]] },
  { id: uuid("46"), title: "Retail POS integration", company: COMPANIES[2].id, contact: CONTACTS[4].id, owner: USERS[3].id, amountCents: 15_600_000, currency: "USD", closeAt: "2027-01-08", path: [["nuevo", "2026-09-22T13:00:00.000Z"], ["calificado", "2026-10-10T12:00:00.000Z"]] },
  // Nace directamente en calificado: permitido por la fila "(creación)" de la tabla.
  { id: uuid("47"), title: "Compliance audit retainer", company: COMPANIES[3].id, contact: CONTACTS[5].id, owner: USERS[2].id, amountCents: 4_800_000, currency: "EUR", closeAt: "2026-12-05", path: [["calificado", "2026-10-12T08:00:00.000Z"]] },
  { id: uuid("48"), title: "Spare parts portal", company: COMPANIES[4].id, contact: CONTACTS[7].id, owner: USERS[1].id, amountCents: 6_750_000, currency: "USD", closeAt: "2027-01-22", path: [["calificado", "2026-10-28T10:30:00.000Z"]] },
  { id: uuid("49"), title: "Cold chain monitoring", company: COMPANIES[0].id, contact: CONTACTS[1].id, owner: USERS[0].id, amountCents: 22_500_000, currency: "USD", closeAt: "2026-12-12", path: [["nuevo", "2026-09-03T09:00:00.000Z"], ["calificado", "2026-09-18T14:00:00.000Z"], ["propuesta", "2026-10-15T16:30:00.000Z"]] },
  { id: uuid("4a"), title: "Customer portal redesign", company: COMPANIES[1].id, contact: CONTACTS[3].id, owner: USERS[4].id, amountCents: 18_900_000, currency: "USD", closeAt: "2026-12-28", path: [["nuevo", "2026-09-08T11:15:00.000Z"], ["calificado", "2026-09-25T10:00:00.000Z"], ["propuesta", "2026-10-20T15:45:00.000Z"]] },
  { id: uuid("4b"), title: "Market expansion study", company: COMPANIES[3].id, contact: CONTACTS[6].id, owner: USERS[2].id, amountCents: 8_400_000, currency: "GBP", closeAt: "2027-01-19", path: [["nuevo", "2026-09-17T09:45:00.000Z"], ["calificado", "2026-10-02T13:30:00.000Z"], ["propuesta", "2026-10-27T11:00:00.000Z"]] },
  { id: uuid("4c"), title: "Fleet renewal — phase 1", company: COMPANIES[0].id, contact: CONTACTS[0].id, owner: USERS[0].id, amountCents: 24_000_000, currency: "USD", closeAt: "2026-10-30", path: [["nuevo", "2026-08-10T10:00:00.000Z"], ["calificado", "2026-08-26T12:00:00.000Z"], ["propuesta", "2026-09-14T15:00:00.000Z"], ["ganado", "2026-10-08T16:00:00.000Z"]] },
  { id: uuid("4d"), title: "Onboarding toolkit", company: COMPANIES[1].id, contact: CONTACTS[2].id, owner: USERS[3].id, amountCents: 5_600_000, currency: "USD", closeAt: "2026-11-06", path: [["nuevo", "2026-08-19T09:30:00.000Z"], ["calificado", "2026-09-02T14:00:00.000Z"], ["propuesta", "2026-09-21T10:30:00.000Z"], ["ganado", "2026-10-14T17:00:00.000Z"]] },
  { id: uuid("4e"), title: "Demand planning module", company: COMPANIES[2].id, contact: CONTACTS[4].id, owner: USERS[1].id, amountCents: 31_200_000, currency: "USD", closeAt: "2026-10-02", path: [["nuevo", "2026-07-28T08:45:00.000Z"], ["calificado", "2026-08-14T11:00:00.000Z"], ["propuesta", "2026-09-04T13:15:00.000Z"], ["ganado", "2026-09-26T15:30:00.000Z"]] },
  { id: uuid("4f"), title: "Customs brokerage addon", company: COMPANIES[4].id, contact: CONTACTS[7].id, owner: USERS[3].id, amountCents: 3_200_000, currency: "USD", closeAt: "2026-11-01", path: [["nuevo", "2026-09-11T10:15:00.000Z"], ["perdido", "2026-10-06T09:00:00.000Z"]] },
  { id: uuid("50"), title: "Patient scheduling revamp", company: COMPANIES[5].id, contact: CONTACTS[8].id, owner: USERS[4].id, amountCents: 27_800_000, currency: "USD", closeAt: "2026-11-08", path: [["nuevo", "2026-08-05T13:45:00.000Z"], ["calificado", "2026-08-21T10:00:00.000Z"], ["propuesta", "2026-09-15T14:30:00.000Z"], ["perdido", "2026-10-19T16:45:00.000Z"]] },
];

// ----------------------------------------------------------------------------
// Activities — tipos mixtos (call/email/meeting/task), la mayoría hechas con
// fechas pasadas coherentes (created ≤ due, done ≥ due) y alguna pendiente.
// Todas vinculadas a contact y/o deal existente (invariante I6).
// ----------------------------------------------------------------------------
interface SeedActivity {
  id: string;
  type: "call" | "email" | "meeting" | "task";
  subject: string;
  notes: string | null;
  dueAt: string;
  doneAt: string | null;
  createdAt: string;
  contact: string | null;
  deal: string | null;
}

const ACTIVITIES: SeedActivity[] = [
  { id: uuid("91"), type: "call", subject: "Intro call — telematics scope", notes: "Wants GPS plus fuel sensors across 40 vans.", dueAt: "2026-10-06T15:00:00.000Z", doneAt: "2026-10-06T15:38:00.000Z", createdAt: "2026-10-06T08:00:00.000Z", contact: CONTACTS[0].id, deal: DEALS[0].id },
  { id: uuid("92"), type: "email", subject: "Slotting methodology deck", notes: "Shared the three-step methodology deck.", dueAt: "2026-10-22T17:00:00.000Z", doneAt: "2026-10-22T17:40:00.000Z", createdAt: "2026-10-22T08:00:00.000Z", contact: CONTACTS[1].id, deal: null },
  { id: uuid("93"), type: "meeting", subject: "SSO requirements workshop", notes: "IT needs SAML and SCIM before year end.", dueAt: "2026-11-04T14:00:00.000Z", doneAt: "2026-11-04T15:30:00.000Z", createdAt: "2026-11-03T09:00:00.000Z", contact: CONTACTS[2].id, deal: DEALS[2].id },
  { id: uuid("94"), type: "task", subject: "Prepare analytics pilot dataset", notes: "Pulled twelve months of sample data.", dueAt: "2026-11-10T12:00:00.000Z", doneAt: "2026-11-11T10:20:00.000Z", createdAt: "2026-11-09T08:00:00.000Z", contact: CONTACTS[8].id, deal: DEALS[3].id },
  { id: uuid("95"), type: "call", subject: "Qualification call — routes", notes: "Budget confirmed for phase two.", dueAt: "2026-09-16T15:00:00.000Z", doneAt: "2026-09-16T15:25:00.000Z", createdAt: "2026-09-16T08:00:00.000Z", contact: CONTACTS[0].id, deal: DEALS[4].id },
  { id: uuid("96"), type: "email", subject: "POS integration quote v2", notes: "Quote sent after the hardware walkthrough.", dueAt: "2026-10-12T18:00:00.000Z", doneAt: "2026-10-12T18:15:00.000Z", createdAt: "2026-10-11T09:00:00.000Z", contact: CONTACTS[4].id, deal: DEALS[5].id },
  { id: uuid("97"), type: "meeting", subject: "Audit scope alignment", notes: "Agreed on a quarterly retainer shape.", dueAt: "2026-10-14T09:30:00.000Z", doneAt: "2026-10-14T10:45:00.000Z", createdAt: "2026-10-13T08:30:00.000Z", contact: CONTACTS[5].id, deal: DEALS[6].id },
  { id: uuid("98"), type: "call", subject: "Parts portal follow-up", notes: "They are comparing against the incumbent supplier.", dueAt: "2026-10-29T14:00:00.000Z", doneAt: "2026-10-29T14:20:00.000Z", createdAt: "2026-10-29T08:00:00.000Z", contact: CONTACTS[7].id, deal: DEALS[7].id },
  { id: uuid("99"), type: "meeting", subject: "Proposal review — cold chain", notes: "Walked through the rollout plan and SLAs.", dueAt: "2026-10-16T11:00:00.000Z", doneAt: "2026-10-16T12:30:00.000Z", createdAt: "2026-10-15T08:00:00.000Z", contact: CONTACTS[1].id, deal: DEALS[8].id },
  { id: uuid("9a"), type: "email", subject: "Portal redesign feedback round", notes: "Nora wants the design system included.", dueAt: "2026-10-21T16:00:00.000Z", doneAt: "2026-10-21T16:50:00.000Z", createdAt: "2026-10-21T08:00:00.000Z", contact: CONTACTS[3].id, deal: DEALS[9].id },
  { id: uuid("9b"), type: "call", subject: "Contract signature call", notes: "Signed the two-year agreement.", dueAt: "2026-10-08T16:00:00.000Z", doneAt: "2026-10-08T16:12:00.000Z", createdAt: "2026-10-08T08:00:00.000Z", contact: CONTACTS[0].id, deal: DEALS[11].id },
  { id: uuid("9c"), type: "meeting", subject: "Kickoff — onboarding toolkit", notes: "Timeline agreed: six weeks.", dueAt: "2026-10-15T10:00:00.000Z", doneAt: "2026-10-15T11:30:00.000Z", createdAt: "2026-10-14T08:00:00.000Z", contact: CONTACTS[2].id, deal: DEALS[12].id },
  { id: uuid("9d"), type: "email", subject: "Lost deal debrief request", notes: "They stayed with the incumbent broker network.", dueAt: "2026-10-07T12:00:00.000Z", doneAt: "2026-10-07T12:30:00.000Z", createdAt: "2026-10-07T08:00:00.000Z", contact: CONTACTS[7].id, deal: DEALS[14].id },
  { id: uuid("9e"), type: "task", subject: "Loss post-mortem write-up", notes: "Lost on price; revisit next fiscal year.", dueAt: "2026-10-20T17:00:00.000Z", doneAt: "2026-10-21T09:15:00.000Z", createdAt: "2026-10-20T08:00:00.000Z", contact: CONTACTS[8].id, deal: DEALS[15].id },
  { id: uuid("9f"), type: "task", subject: "Draft expansion study proposal v3", notes: null, dueAt: "2026-11-18T12:00:00.000Z", doneAt: null, createdAt: "2026-11-12T08:00:00.000Z", contact: CONTACTS[6].id, deal: DEALS[10].id },
  { id: uuid("a0"), type: "call", subject: "Schedule demo — spare parts portal", notes: null, dueAt: "2026-11-17T13:00:00.000Z", doneAt: null, createdAt: "2026-11-12T08:30:00.000Z", contact: CONTACTS[7].id, deal: DEALS[7].id },
];

function tableCount(db: Database.Database, table: string): number {
  const row = db.prepare(`select count(*) as n from ${table}`).get() as { n: number };
  return row.n;
}

/** Inserta el seed de demo solo si la DB está vacía. Devuelve true si seedeó. */
export function seedIfEmpty(db: Database.Database): boolean {
  if (tableCount(db, "users") > 0) return false;

  const eventBase = 0x61; // ids deterministas de stage_events: 61..(hex)
  let eventSeq = 0;

  db.transaction(() => {
    const insertUser = db.prepare(
      "insert into users (id, name, email, role, created_at, updated_at) values (?, ?, ?, ?, ?, ?)"
    );
    const userAt = "2026-07-01T09:00:00.000Z";
    for (const u of USERS) insertUser.run(u.id, u.name, u.email, u.role, userAt, userAt);

    const insertCompany = db.prepare(
      "insert into companies (id, name, industry, website, created_at, updated_at) values (?, ?, ?, ?, ?, ?)"
    );
    for (const [i, c] of COMPANIES.entries()) {
      const at = new Date(Date.parse("2026-07-02T09:00:00.000Z") + i * DAY_MS).toISOString();
      insertCompany.run(c.id, c.name, c.industry, c.website, at, at);
    }

    const insertContact = db.prepare(
      `insert into contacts (id, full_name, email, phone, title, company_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [i, k] of CONTACTS.entries()) {
      const at = new Date(Date.parse("2026-07-10T09:00:00.000Z") + i * DAY_MS).toISOString();
      insertContact.run(k.id, k.name, k.email, k.phone, k.title, k.company, at, at);
    }

    const insertDeal = db.prepare(
      `insert into deals (id, title, company_id, contact_id, owner_id, amount_cents, currency,
         stage, expected_close_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEvent = db.prepare(
      "insert into stage_events (id, deal_id, from_stage, to_stage, actor, created_at) values (?, ?, ?, ?, ?, ?)"
    );
    for (const d of DEALS) {
      const createdAt = d.path[0][1];
      const updatedAt = d.path[d.path.length - 1][1];
      insertDeal.run(
        d.id, d.title, d.company, d.contact, d.owner, d.amountCents, d.currency,
        d.path[d.path.length - 1][0], d.closeAt, createdAt, updatedAt
      );
      // La traza nace con el deal y acumula cada transición (actor "seed").
      let from: string | null = null;
      for (const [to, at] of d.path) {
        insertEvent.run(uuid((eventBase + eventSeq).toString(16)), d.id, from, to, "seed", at);
        from = to;
        eventSeq++;
      }
    }

    const insertActivity = db.prepare(
      `insert into activities (id, type, subject, notes, due_at, done_at, contact_id, deal_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of ACTIVITIES) {
      insertActivity.run(
        a.id, a.type, a.subject, a.notes, a.dueAt, a.doneAt, a.contact, a.deal, a.createdAt, a.doneAt ?? a.createdAt
      );
    }
  })();

  return true;
}

/** Cantidad de filas por tabla (para tests, reset y smoke del seed). */
export function seedCounts(db: Database.Database): Record<string, number> {
  const tables = ["users", "companies", "contacts", "deals", "stage_events", "activities"];
  return Object.fromEntries(tables.map((t) => [t, tableCount(db, t)]));
}
