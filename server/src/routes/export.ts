import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import { toCsv } from "../domain/csv.js";

// GET /api/export/:entity (H-07 / S09): CSV de TODOS los registros activos,
// columnas espejo del listado API, orden created_at desc, id (§12.2.2).
// String único, sin stream: better-sqlite3 es síncrono — 10k filas ≈ 2 MB
// (presupuesto N19 < 3 s; decisión del plan §12.2.2).

const entitySchema = z.enum(["contacts", "deals"]);

interface ExportConfig {
  columns: string[];
  // Espejo del SELECT del listado (routes/contacts.ts / routes/deals.ts).
  sql: string;
}

const CONFIGS: Record<z.infer<typeof entitySchema>, ExportConfig> = {
  contacts: {
    columns: ["id", "full_name", "email", "phone", "title", "company_id", "company_name", "created_at", "updated_at"],
    // LEFT JOIN: mismo criterio que el listado (contact sin empresa sigue
    // apareciendo; company_name queda vacío).
    sql: `select c.id, c.full_name, c.email, c.phone, c.title, c.company_id,
                 co.name as company_name, c.created_at, c.updated_at
          from contacts c
          left join companies co on co.id = c.company_id
          where c.deleted_at is null
          order by c.created_at desc, c.id`,
  },
  deals: {
    columns: ["id", "title", "company_id", "company_name", "contact_id", "contact_name", "owner_id", "owner_name", "amount_cents", "currency", "stage", "expected_close_at", "created_at", "updated_at"],
    sql: `select d.id, d.title, d.company_id, co.name as company_name, d.contact_id,
                 k.full_name as contact_name, d.owner_id, u.name as owner_name,
                 d.amount_cents, d.currency, d.stage, d.expected_close_at,
                 d.created_at, d.updated_at
          from deals d
          join companies co on co.id = d.company_id
          join users u on u.id = d.owner_id
          left join contacts k on k.id = d.contact_id
          where d.deleted_at is null
          order by d.created_at desc, d.id`,
  },
};

export function createExportRoutes(db: Database.Database): Hono {
  const prepared = {
    contacts: db.prepare(CONFIGS.contacts.sql),
    deals: db.prepare(CONFIGS.deals.sql),
  };

  return new Hono().get("/:entity", (c) => {
    const entity = entitySchema.safeParse(c.req.param("entity"));
    // Otro valor → mismo 404 que el notFound global (§12.2.2).
    if (!entity.success) throw new HTTPException(404, { message: "Not found" });

    const config = CONFIGS[entity.data];
    const rows = prepared[entity.data].all() as Record<string, unknown>[];
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return c.body(toCsv(rows, config.columns), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${entity.data}-${date}.csv"`,
    });
  });
}
