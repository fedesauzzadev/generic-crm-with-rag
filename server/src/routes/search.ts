import { Hono } from "hono";
import { z } from "zod";
import type Database from "better-sqlite3";
import { parseWith } from "../http.js";
import { tokenize, weightedLike } from "../domain/search-rank.js";

// GET /api/search?q= (H-08, §12.2.3): búsqueda global contacts+companies+deals,
// 3 grupos SIEMPRE presentes (items puede ser []), top 5 por grupo, orden por
// score ponderado desc (D-011) con id como desempate determinista.
//
// Match: substring case-insensitive sobre nombre/título (columnas peso 3) +
// company_name joineada también a peso 3 (es el NAME de la empresa): sin eso,
// buscar "Brightpath" no traería sus contactos ni sus deals (AC2 exige la
// empresa, SUS contactos y SUS deals). Escaping/tokenizer: compartidos con el
// agente en domain/search-rank.ts — cero duplicación de LIKE escape (N6).
//
// Límite documentado (heredado del tokenizador): SQLite LIKE es
// case-insensitive SOLO para ASCII — "maria" no matchea "María" (el término
// con acento exacto sí). Sin folding de acentos en V2 (fuera de scope).

interface RouteTarget {
  entity: "contacts" | "companies" | "deals";
  columns: Array<{ expr: string; weight: number }>;
  select: string;
  from: string;
  activeWhere: string;
  idExpr: string;
}

const ROUTE_TARGETS: RouteTarget[] = [
  {
    entity: "contacts",
    columns: [
      { expr: "c.full_name", weight: 3 },
      { expr: "ifnull(c.title, '')", weight: 2 },
      { expr: "co.name", weight: 3 },
    ],
    select: "c.id, c.full_name, c.title, c.email, co.name as company_name",
    from: "contacts c left join companies co on co.id = c.company_id",
    activeWhere: "c.deleted_at is null",
    idExpr: "c.id",
  },
  {
    entity: "companies",
    columns: [
      { expr: "name", weight: 3 },
      { expr: "ifnull(industry, '')", weight: 2 },
    ],
    select: "id, name, industry",
    from: "companies",
    activeWhere: "deleted_at is null",
    idExpr: "id",
  },
  {
    entity: "deals",
    columns: [
      { expr: "d.title", weight: 3 },
      { expr: "co.name", weight: 3 },
    ],
    select: "d.id, d.title, d.stage, d.amount_cents, d.currency, co.name as company_name",
    from: "deals d join companies co on co.id = d.company_id",
    activeWhere: "d.deleted_at is null",
    idExpr: "d.id",
  },
];

const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

export function createSearchRoutes(db: Database.Database): Hono {
  return new Hono().get("/", (c) => {
    const { q } = parseWith(searchQuerySchema, { q: c.req.query("q") ?? "" });
    const terms = tokenize(q); // q ya validó 2..100; sin términos ≥2 chars → grupos vacíos (AC5)

    const groups = ROUTE_TARGETS.map((target) => {
      const items: Array<Record<string, unknown>> = [];
      if (terms.length > 0) {
        const { scoreSql, whereSql, params } = weightedLike(target.columns, terms);
        items.push(
          ...(db
            .prepare(
              `select ${target.select}, (${scoreSql}) as score
               from ${target.from}
               where ${target.activeWhere} and (${whereSql})
               order by score desc, ${target.idExpr}
               limit 5`
            )
            .all(...params) as Array<Record<string, unknown>>)
        );
      }
      return { entity: target.entity, items };
    });

    return c.json({ ok: true, q, total: groups.reduce((acc, g) => acc + g.items.length, 0), groups });
  });
}
