import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { SessionEnv } from "../auth.js";
import { parseWith, readJsonBody } from "../http.js";
import {
  CREATION_STAGES,
  STAGES,
  canTransition,
  isStage,
  transitionError,
  type Stage,
} from "../domain/pipeline.js";

// Deals: CRUD + pipeline agregado + cambio de stage con traza inmutable.
// Reglas de oro (domain-model §2/§3): stage SOLO cambia por /stage (I3);
// UPDATE deal + INSERT stage_events van en UNA transacción; la traza nace con
// el deal (from_stage null); el actor es la sesión activa (D-006).

interface DealRow {
  id: string;
  title: string;
  company_id: string;
  contact_id: string | null;
  owner_id: string;
  amount_cents: number;
  currency: string;
  stage: Stage;
  expected_close_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface DealListRow extends DealRow {
  company_name: string;
  contact_name: string | null;
  owner_name: string;
}

export interface StageEventRow {
  id: string;
  deal_id: string;
  from_stage: Stage | null;
  to_stage: Stage;
  actor: string;
  created_at: string;
}

// H-09: traza de monto — append-only, sin endpoint mutador (inmutabilidad
// por ausencia, mismo dictamen que stage_events).
export interface AmountEventRow {
  id: string;
  deal_id: string;
  old_cents: number;
  new_cents: number;
  actor: string;
  created_at: string;
}

// S10 (H-08): deals resumidos embebidos en los detalles de contact/company
// (joins del fix-pattern F-01: siempre company_name/owner_name legibles).
export interface DealSummaryRow {
  id: string;
  title: string;
  stage: Stage;
  amount_cents: number;
  currency: string;
  expected_close_at: string | null;
  company_name: string;
  owner_name: string;
}

/** Deals activos de un contacto o empresa (columna fija por llamada, nunca input). */
export function activeDealSummaries(
  db: Database.Database,
  column: "contact_id" | "company_id",
  id: string
): DealSummaryRow[] {
  return db
    .prepare(
      `select d.id, d.title, d.stage, d.amount_cents, d.currency, d.expected_close_at,
              co.name as company_name, u.name as owner_name
       from deals d
       join companies co on co.id = d.company_id
       join users u on u.id = d.owner_id
       where d.deleted_at is null and d.${column} = ?
       order by d.created_at desc, d.id`
    )
    .all(id) as DealSummaryRow[];
}

const dealCreateSchema = z.object({
  title: z.string().trim().min(1),
  company_id: z.string().min(1),
  contact_id: z.string().min(1).optional(),
  owner_id: z.string().min(1), // I1: deal SIEMPRE tiene owner
  amount_cents: z.number().int().positive(), // I2: > 0, en centavos
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  stage: z.string().default("nuevo"),
  expected_close_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const dealUpdateSchema = dealCreateSchema
  .omit({ stage: true }) // stage: única vía = PATCH /:id/stage (I3)
  .partial();

const stageChangeSchema = z.object({ to_stage: z.string().min(1) });

export function createDealsRoutes(db: Database.Database): Hono<SessionEnv> {
  const getActive = (id: string): DealListRow | undefined =>
    // QA F-01: mismos joins que el listado — el detalle (y las respuestas de
    // POST/PATCH//stage) renderiza company_name/owner_name/contact_name.
    db
      .prepare(
        `select d.*, co.name as company_name, k.full_name as contact_name, u.name as owner_name
         from deals d
         join companies co on co.id = d.company_id
         join users u on u.id = d.owner_id
         left join contacts k on k.id = d.contact_id
         where d.id = ? and d.deleted_at is null`
      )
      .get(id) as DealListRow | undefined;

  const assertRefExists = (table: "companies" | "contacts" | "users", id: string, label: string): void => {
    const found = db
      .prepare(`select id from ${table} where id = ?${table === "users" ? "" : " and deleted_at is null"}`)
      .get(id);
    if (!found) throw new HTTPException(422, { message: `${label} does not reference an existing ${table === "users" ? "owner" : table.slice(0, -1)}` });
  };

  const stageEvents = (dealId: string): StageEventRow[] =>
    db
      // rowid = orden real de inserción: dos eventos en el mismo milisegundo
      // (resolución ISO 1ms) quedan cronológicos igual. El id UUID no sirve
      // de desempate — es aleatorio.
      .prepare("select * from stage_events where deal_id = ? order by created_at asc, rowid asc")
      .all(dealId) as StageEventRow[];

  const amountEvents = (dealId: string): AmountEventRow[] =>
    // Mismo desempate rowid que stage_events (L-04).
    db
      .prepare("select * from deal_amount_history where deal_id = ? order by created_at asc, rowid asc")
      .all(dealId) as AmountEventRow[];

  // Respuesta embebida (§12.2.4): toda respuesta que devuelve deal trae las
  // dos trazas — el único consumidor es DealDetail (un solo fetch).
  const dealWithHistory = (id: string) => ({
    ...getActive(id)!,
    stage_events: stageEvents(id),
    amount_history: amountEvents(id),
  });

  return new Hono<SessionEnv>()
    // Registrada ANTES que /:id para que "pipeline" no colisione.
    .get("/pipeline", (c) => {
      const rows = db
        .prepare(
          `select stage, count(*) as count, sum(amount_cents) as total_cents
           from deals where deleted_at is null group by stage`
        )
        .all() as { stage: Stage; count: number; total_cents: number | null }[];
      const byStage = new Map(rows.map((r) => [r.stage, r]));
      // I8: suma por stage = total, calculada del MISMO dataset.
      const stages = STAGES.map((stage) => ({
        stage,
        count: byStage.get(stage)?.count ?? 0,
        total_cents: byStage.get(stage)?.total_cents ?? 0,
      }));
      const total_cents = stages.reduce((acc, s) => acc + s.total_cents, 0);
      const total_count = stages.reduce((acc, s) => acc + s.count, 0);
      return c.json({ ok: true, stages, total_cents, total_count });
    })
    .get("/", (c) => {
      const query = (c.req.query("query") ?? "").trim();
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const like = `%${query}%`;

      const where = query
        ? `where d.deleted_at is null and (d.title like ? or co.name like ? or u.name like ?)`
        : "where d.deleted_at is null";
      const params: (string | number)[] = query ? [like, like, like] : [];

      const total = (
        db
          .prepare(
            `select count(*) as n from deals d
             join companies co on co.id = d.company_id
             join users u on u.id = d.owner_id ${where}`
          )
          .get(...params) as { n: number }
      ).n;
      const items = db
        .prepare(
          `select d.*, co.name as company_name, k.full_name as contact_name, u.name as owner_name
           from deals d
           join companies co on co.id = d.company_id
           join users u on u.id = d.owner_id
           left join contacts k on k.id = d.contact_id ${where}
           order by d.created_at desc, d.id limit ? offset ?`
        )
        .all(...params, pageSize, (page - 1) * pageSize) as DealListRow[];

      return c.json({ ok: true, items, total, page, pageSize });
    })
    .post("/", async (c) => {
      const data = parseWith(dealCreateSchema, await readJsonBody(c.req.raw));

      // Guardas de creación (fila "(creación)" de la tabla §2).
      if (!isStage(data.stage) || !CREATION_STAGES.includes(data.stage)) {
        throw new HTTPException(422, {
          message: `stage: a new deal cannot start in \`${data.stage}\` (allowed: ${CREATION_STAGES.join(", ")})`,
        });
      }
      assertRefExists("companies", data.company_id, "company_id");
      if (data.contact_id) assertRefExists("contacts", data.contact_id, "contact_id");
      assertRefExists("users", data.owner_id, "owner_id");

      const id = randomUUID();
      const now = new Date().toISOString();
      const actor = c.get("session").name;
      // Traza atómica: el evento inicial nace con el deal (guarda 5, §2).
      db.transaction(() => {
        db.prepare(
          `insert into deals (id, title, company_id, contact_id, owner_id, amount_cents, currency,
             stage, expected_close_at, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, data.title, data.company_id, data.contact_id ?? null, data.owner_id,
          data.amount_cents, data.currency, data.stage, data.expected_close_at ?? null, now, now
        );
        db.prepare(
          `insert into stage_events (id, deal_id, from_stage, to_stage, actor, created_at)
           values (?, ?, null, ?, ?, ?)`
        ).run(randomUUID(), id, data.stage, actor, now);
      })();

      return c.json({ ok: true, deal: dealWithHistory(id) }, 201);
    })
    .get("/:id", (c) => {
      const deal = getActive(c.req.param("id"));
      if (!deal) throw new HTTPException(404, { message: "Deal not found" });
      return c.json({ ok: true, deal: dealWithHistory(deal.id) });
    })
    .patch("/:id", async (c) => {
      const id = c.req.param("id");
      const existing = getActive(id);
      if (!existing) throw new HTTPException(404, { message: "Deal not found" });

      const raw = await readJsonBody(c.req.raw);
      if (raw && typeof raw === "object" && "stage" in raw) {
        // I3: el stage solo cambia por la vía validada con traza.
        throw new HTTPException(422, { message: "stage cannot be edited here; use PATCH /api/deals/:id/stage" });
      }
      const data = parseWith(dealUpdateSchema, raw);

      if (data.company_id !== undefined) assertRefExists("companies", data.company_id, "company_id");
      if (data.contact_id !== undefined) assertRefExists("contacts", data.contact_id, "contact_id");
      if (data.owner_id !== undefined) assertRefExists("users", data.owner_id, "owner_id");

      // undefined = "no viene en el payload" (deja el valor); null explícito limpia.
      const pick = <T>(value: T | undefined, current: T): T => (value === undefined ? current : value);
      const nextAmount = pick(data.amount_cents, existing.amount_cents);
      const now = new Date().toISOString();
      const amountChanged = nextAmount !== existing.amount_cents;
      // H-09 (guarda 4, §2): UPDATE + evento de monto en UNA transacción —
      // o cambia todo o nada. El evento SOLO nace si amount_cents cambia
      // (AC3): ni la edición de otros campos ni el mismo monto generan ruido.
      // A diferencia del stage (que registra su estado inicial "created"),
      // el monto inicial no es un "cambio": la traza nace con la primera
      // edición real (AC4, mismo criterio del seed — plan §12.3).
      db.transaction(() => {
        db.prepare(
          `update deals set title = ?, company_id = ?, contact_id = ?, owner_id = ?, amount_cents = ?,
             currency = ?, expected_close_at = ?, updated_at = ? where id = ? and deleted_at is null`
        ).run(
          pick(data.title, existing.title),
          pick(data.company_id, existing.company_id),
          pick(data.contact_id ?? null, existing.contact_id),
          pick(data.owner_id, existing.owner_id),
          nextAmount,
          pick(data.currency, existing.currency),
          pick(data.expected_close_at ?? null, existing.expected_close_at),
          now,
          id
        );
        if (amountChanged) {
          db.prepare(
            `insert into deal_amount_history (id, deal_id, old_cents, new_cents, actor, created_at)
             values (?, ?, ?, ?, ?, ?)`
          ).run(randomUUID(), id, existing.amount_cents, nextAmount, c.get("session").name, now);
        }
      })();

      return c.json({ ok: true, deal: dealWithHistory(id) });
    })
    // ÚNICA vía de cambio de stage (I3): valida transición + traza atómica.
    .patch("/:id/stage", async (c) => {
      const id = c.req.param("id");
      const deal = getActive(id);
      if (!deal) throw new HTTPException(404, { message: "Deal not found" });

      const data = parseWith(stageChangeSchema, await readJsonBody(c.req.raw));
      if (!isStage(data.to_stage)) {
        throw new HTTPException(422, { message: `to_stage: unknown stage \`${data.to_stage}\`` });
      }
      if (!canTransition(deal.stage, data.to_stage)) {
        throw new HTTPException(422, { message: transitionError(deal.stage, data.to_stage) });
      }

      const now = new Date().toISOString();
      const actor = c.get("session").name;
      // Guarda 4 (§2): efecto atómico — update + evento o nada.
      db.transaction(() => {
        db.prepare("update deals set stage = ?, updated_at = ? where id = ? and deleted_at is null").run(
          data.to_stage, now, id
        );
        db.prepare(
          `insert into stage_events (id, deal_id, from_stage, to_stage, actor, created_at)
           values (?, ?, ?, ?, ?, ?)`
        ).run(randomUUID(), id, deal.stage, data.to_stage, actor, now);
      })();

      return c.json({ ok: true, deal: dealWithHistory(id) });
    })
    .delete("/:id", (c) => {
      const id = c.req.param("id");
      if (!getActive(id)) throw new HTTPException(404, { message: "Deal not found" });
      // Borrado lógico (I5): las trazas de stage NO se tocan.
      const now = new Date().toISOString();
      db.prepare("update deals set deleted_at = ?, updated_at = ? where id = ?").run(now, now, id);
      return c.json({ ok: true });
    });
}
