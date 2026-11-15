import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import { parseWith, readJsonBody } from "../http.js";

// Activities: CRUD con invariante I6 (siempre vinculada a un contacto O un
// deal), tipos enum y soft delete. Fechas ISO-8601 (la UI envía .toISOString()).

const ACTIVITY_TYPES = ["call", "email", "meeting", "task"] as const;

interface ActivityRow {
  id: string;
  type: (typeof ACTIVITY_TYPES)[number];
  subject: string;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  contact_id: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

const activityBase = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(1),
  notes: z.string().trim().optional(),
  due_at: isoDate.nullable().optional(),
  done_at: isoDate.nullable().optional(), // null = pendiente
  contact_id: z.string().min(1).optional(),
  deal_id: z.string().min(1).optional(),
});

// I6: sin contact_id ni deal_id no hay activity.
const activityCreateSchema = activityBase.refine(
  (a) => Boolean(a.contact_id || a.deal_id),
  { message: "an activity must reference a contact_id or a deal_id" }
);

// La guarda I6 del update se aplica en el handler sobre el merge (un payload
// parcial es válido si el resultado final queda vinculado).
const activityUpdateSchema = z.object({
  type: z.enum(ACTIVITY_TYPES).optional(),
  subject: z.string().trim().min(1).optional(),
  notes: z.string().trim().nullable().optional(),
  due_at: isoDate.nullable().optional(),
  done_at: isoDate.nullable().optional(),
  contact_id: z.string().min(1).nullable().optional(),
  deal_id: z.string().min(1).nullable().optional(),
});

export function createActivitiesRoutes(db: Database.Database): Hono {
  const getActive = (id: string): ActivityRow | undefined =>
    db.prepare("select * from activities where id = ? and deleted_at is null").get(id) as
      | ActivityRow
      | undefined;

  const assertRef = (table: "contacts" | "deals", id: string): void => {
    const found = db
      .prepare(`select id from ${table} where id = ? and deleted_at is null`)
      .get(id);
    if (!found) {
      throw new HTTPException(422, { message: `${table === "deals" ? "deal" : "contact"}_id does not reference an existing ${table === "deals" ? "deal" : "contact"}` });
    }
  };

  return new Hono()
    .get("/", (c) => {
      const query = (c.req.query("query") ?? "").trim();
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const like = `%${query}%`;

      const where = query
        ? "where a.deleted_at is null and (a.subject like ? or ifnull(a.notes, '') like ?)"
        : "where a.deleted_at is null";
      const params: (string | number)[] = query ? [like, like] : [];

      const total = (
        db.prepare(`select count(*) as n from activities a ${where}`).get(...params) as { n: number }
      ).n;
      const items = db
        .prepare(
          `select a.*, k.full_name as contact_name, d.title as deal_title
           from activities a
           left join contacts k on k.id = a.contact_id
           left join deals d on d.id = a.deal_id ${where}
           order by a.created_at desc, a.id limit ? offset ?`
        )
        .all(...params, pageSize, (page - 1) * pageSize) as (ActivityRow & {
          contact_name: string | null;
          deal_title: string | null;
        })[];

      return c.json({ ok: true, items, total, page, pageSize });
    })
    .post("/", async (c) => {
      const data = parseWith(activityCreateSchema, await readJsonBody(c.req.raw));
      if (data.contact_id) assertRef("contacts", data.contact_id);
      if (data.deal_id) assertRef("deals", data.deal_id);

      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `insert into activities (id, type, subject, notes, due_at, done_at, contact_id, deal_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.type, data.subject, data.notes ?? null, data.due_at ?? null, data.done_at ?? null, data.contact_id ?? null, data.deal_id ?? null, now, now);

      const created = getActive(id)!;
      return c.json({ ok: true, activity: created }, 201);
    })
    .get("/:id", (c) => {
      const activity = getActive(c.req.param("id"));
      if (!activity) throw new HTTPException(404, { message: "Activity not found" });
      return c.json({ ok: true, activity });
    })
    .patch("/:id", async (c) => {
      const id = c.req.param("id");
      const existing = getActive(id);
      if (!existing) throw new HTTPException(404, { message: "Activity not found" });

      const data = parseWith(activityUpdateSchema, await readJsonBody(c.req.raw));
      const merged = {
        type: data.type ?? existing.type,
        subject: data.subject ?? existing.subject,
        notes: data.notes === undefined ? existing.notes : data.notes,
        due_at: data.due_at === undefined ? existing.due_at : data.due_at,
        done_at: data.done_at === undefined ? existing.done_at : data.done_at,
        contact_id: data.contact_id === undefined ? existing.contact_id : data.contact_id,
        deal_id: data.deal_id === undefined ? existing.deal_id : data.deal_id,
      };
      if (data.contact_id !== undefined && data.contact_id !== null) assertRef("contacts", data.contact_id);
      if (data.deal_id !== undefined && data.deal_id !== null) assertRef("deals", data.deal_id);
      if (!merged.contact_id && !merged.deal_id) {
        throw new HTTPException(422, { message: "an activity must reference a contact_id or a deal_id" });
      }

      db.prepare(
        `update activities set type = ?, subject = ?, notes = ?, due_at = ?, done_at = ?, contact_id = ?, deal_id = ?, updated_at = ?
         where id = ? and deleted_at is null`
      ).run(merged.type, merged.subject, merged.notes, merged.due_at, merged.done_at, merged.contact_id, merged.deal_id, new Date().toISOString(), id);

      return c.json({ ok: true, activity: getActive(id) });
    })
    .delete("/:id", (c) => {
      const id = c.req.param("id");
      if (!getActive(id)) throw new HTTPException(404, { message: "Activity not found" });
      const now = new Date().toISOString();
      db.prepare("update activities set deleted_at = ?, updated_at = ? where id = ?").run(now, now, id);
      return c.json({ ok: true });
    });
}
