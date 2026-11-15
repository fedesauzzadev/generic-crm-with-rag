import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import { parseWith, readJsonBody } from "../http.js";
import { activeDealSummaries } from "./deals.js";

// CRUD mínimo de contacts (S01): prueba el stack completo (zod → prepared
// statements → JSON). El resto de entidades llega en S03 con el patrón ya
// validado acá.

interface ContactRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const contactCreateSchema = z.object({
  full_name: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
  title: z.string().trim().optional(),
  company_id: z.string().min(1).optional(),
});

const contactUpdateSchema = contactCreateSchema.partial();

export function createContactsRoutes(db: Database.Database): Hono {
  const getActive = (id: string): ContactRow | undefined =>
    db.prepare("select * from contacts where id = ? and deleted_at is null").get(id) as
      | ContactRow
      | undefined;

  const assertCompanyExists = (companyId: string): void => {
    const found = db
      .prepare("select id from companies where id = ? and deleted_at is null")
      .get(companyId);
    if (!found) {
      throw new HTTPException(422, { message: "company_id does not reference an existing company" });
    }
  };

  return new Hono()
    .get("/", (c) => {
      const query = (c.req.query("query") ?? "").trim();
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const like = `%${query}%`;

      const where = query
        ? "where deleted_at is null and (full_name like ? or ifnull(email, '') like ?)"
        : "where deleted_at is null";
      const params: (string | number)[] = query ? [like, like] : [];

      const total = (
        db.prepare(`select count(*) as n from contacts ${where}`).get(...params) as { n: number }
      ).n;
      const items = db
        .prepare(`select * from contacts ${where} order by created_at desc, id limit ? offset ?`)
        .all(...params, pageSize, (page - 1) * pageSize) as ContactRow[];

      return c.json({ ok: true, items, total, page, pageSize });
    })
    .post("/", async (c) => {
      const data = parseWith(contactCreateSchema, await readJsonBody(c.req.raw));
      if (data.company_id) assertCompanyExists(data.company_id);

      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(
        `insert into contacts (id, full_name, email, phone, title, company_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.full_name, data.email ?? null, data.phone ?? null, data.title ?? null, data.company_id ?? null, now, now);

      return c.json({ ok: true, contact: getActive(id) }, 201);
    })
    .get("/:id", (c) => {
      const id = c.req.param("id");
      // S10 (H-08): detalle navegable desde la búsqueda global — company_name
      // joineada (fix-pattern F-01) + deals activos del contacto.
      const withCompany = db
        .prepare(
          `select ct.*, co.name as company_name
           from contacts ct left join companies co on co.id = ct.company_id
           where ct.id = ? and ct.deleted_at is null`
        )
        .get(id) as (ContactRow & { company_name: string | null }) | undefined;
      if (!withCompany) throw new HTTPException(404, { message: "Contact not found" });
      return c.json({ ok: true, contact: { ...withCompany, deals: activeDealSummaries(db, "contact_id", id) } });
    })
    .patch("/:id", async (c) => {
      const id = c.req.param("id");
      const existing = getActive(id);
      if (!existing) throw new HTTPException(404, { message: "Contact not found" });

      const data = parseWith(contactUpdateSchema, await readJsonBody(c.req.raw));
      if (data.company_id) assertCompanyExists(data.company_id);

      // Merge sobre la fila existente: evita SQL dinámico (NFR N6).
      const merged = {
        full_name: data.full_name ?? existing.full_name,
        email: data.email ?? existing.email,
        phone: data.phone ?? existing.phone,
        title: data.title ?? existing.title,
        company_id: data.company_id ?? existing.company_id,
      };
      db.prepare(
        `update contacts set full_name = ?, email = ?, phone = ?, title = ?, company_id = ?, updated_at = ?
         where id = ? and deleted_at is null`
      ).run(merged.full_name, merged.email, merged.phone, merged.title, merged.company_id, new Date().toISOString(), id);

      return c.json({ ok: true, contact: getActive(id) });
    })
    .delete("/:id", (c) => {
      const id = c.req.param("id");
      const existing = getActive(id);
      if (!existing) throw new HTTPException(404, { message: "Contact not found" });
      // Borrado lógico: la fila queda, las referencias no se tocan (I5).
      db.prepare("update contacts set deleted_at = ?, updated_at = ? where id = ?").run(
        new Date().toISOString(),
        new Date().toISOString(),
        id
      );
      return c.json({ ok: true });
    });
}
