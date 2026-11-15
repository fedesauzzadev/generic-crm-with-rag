import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import { parseWith, readJsonBody } from "../http.js";
import { activeDealSummaries } from "./deals.js";

// Companies (cuentas): CRUD con listado paginado + búsqueda, soft delete y
// nombre único entre empresas no borradas (índice de 0001_init.sql → 409).

interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const companyCreateSchema = z.object({
  name: z.string().trim().min(1),
  industry: z.string().trim().optional(),
  website: z.string().trim().optional(),
});

const companyUpdateSchema = companyCreateSchema.partial();

export function createCompaniesRoutes(db: Database.Database): Hono {
  const getActive = (id: string): CompanyRow | undefined =>
    db.prepare("select * from companies where id = ? and deleted_at is null").get(id) as
      | CompanyRow
      | undefined;

  const insert = db.prepare(
    `insert into companies (id, name, industry, website, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)`
  );
  const insertInitial = (data: z.infer<typeof companyCreateSchema>, now: string): string => {
    const id = randomUUID();
    try {
      insert.run(id, data.name, data.industry ?? null, data.website ?? null, now, now);
    } catch (err) {
      // Índice único (name where deleted_at is null): duplicado → 409 legible.
      if ((err as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT")) {
        throw new HTTPException(409, { message: `A company named "${data.name}" already exists` });
      }
      throw err;
    }
    return id;
  };

  return new Hono()
    .get("/", (c) => {
      const query = (c.req.query("query") ?? "").trim();
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const like = `%${query}%`;

      const where = query
        ? "where deleted_at is null and (name like ? or ifnull(industry, '') like ?)"
        : "where deleted_at is null";
      const params: (string | number)[] = query ? [like, like] : [];

      const total = (
        db.prepare(`select count(*) as n from companies ${where}`).get(...params) as { n: number }
      ).n;
      const items = db
        .prepare(`select * from companies ${where} order by created_at desc, id limit ? offset ?`)
        .all(...params, pageSize, (page - 1) * pageSize) as CompanyRow[];

      return c.json({ ok: true, items, total, page, pageSize });
    })
    .post("/", async (c) => {
      const data = parseWith(companyCreateSchema, await readJsonBody(c.req.raw));
      const id = insertInitial(data, new Date().toISOString());
      return c.json({ ok: true, company: getActive(id) }, 201);
    })
    .get("/:id", (c) => {
      const id = c.req.param("id");
      const company = getActive(id);
      if (!company) throw new HTTPException(404, { message: "Company not found" });
      // S10 (H-08): detalle navegable desde la búsqueda global — contactos y
      // deals activos de la empresa embebidos (patrón dealWithHistory: un
      // solo fetch para la página de detalle).
      const contacts = db
        .prepare(
          `select id, full_name, title, email from contacts
           where company_id = ? and deleted_at is null order by created_at desc, id`
        )
        .all(id) as Array<{ id: string; full_name: string; title: string | null; email: string | null }>;
      return c.json({ ok: true, company, contacts, deals: activeDealSummaries(db, "company_id", id) });
    })
    .patch("/:id", async (c) => {
      const id = c.req.param("id");
      const existing = getActive(id);
      if (!existing) throw new HTTPException(404, { message: "Company not found" });

      const data = parseWith(companyUpdateSchema, await readJsonBody(c.req.raw));
      // Merge sobre la fila existente: evita SQL dinámico (NFR N6).
      const merged = {
        name: data.name ?? existing.name,
        industry: data.industry ?? existing.industry,
        website: data.website ?? existing.website,
      };
      try {
        db.prepare(
          `update companies set name = ?, industry = ?, website = ?, updated_at = ?
           where id = ? and deleted_at is null`
        ).run(merged.name, merged.industry, merged.website, new Date().toISOString(), id);
      } catch (err) {
        if ((err as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT")) {
          throw new HTTPException(409, { message: `A company named "${merged.name}" already exists` });
        }
        throw err;
      }

      return c.json({ ok: true, company: getActive(id) });
    })
    .delete("/:id", (c) => {
      const id = c.req.param("id");
      if (!getActive(id)) throw new HTTPException(404, { message: "Company not found" });
      // Borrado lógico: la fila queda, los FKs de contacts/deals no se tocan (I5).
      const now = new Date().toISOString();
      db.prepare("update companies set deleted_at = ?, updated_at = ? where id = ?").run(now, now, id);
      return c.json({ ok: true });
    });
}
