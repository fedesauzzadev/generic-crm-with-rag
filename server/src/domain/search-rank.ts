// Ranking de búsqueda compartido (S10 / H-08, plan §12.2.3): extraído de
// chat/tools.ts SIN cambio de comportamiento — la suite de chat debe seguir
// verde sin edición. Lo consumen el tool `search_records` del agente (D-011)
// y la ruta GET /api/search. Duplicar el escaping de LIKE sería un bug de
// seguridad esperando pasar (todo LIKE de búsqueda pasa por acá).

// Pesos D-011 (§11.3): name 3 > title/industry 2 > notes 1.
export interface SearchTarget {
  entity: "companies" | "contacts" | "deals" | "activities";
  columns: Array<{ expr: string; weight: number }>;
  select: string;
}

export const SEARCH_TARGETS: SearchTarget[] = [
  { entity: "companies", columns: [{ expr: "name", weight: 3 }, { expr: "ifnull(industry, '')", weight: 2 }], select: "id, name, industry" },
  { entity: "contacts", columns: [{ expr: "full_name", weight: 3 }, { expr: "ifnull(title, '')", weight: 2 }], select: "id, full_name, title, company_id" },
  { entity: "deals", columns: [{ expr: "title", weight: 3 }], select: "id, title, stage, amount_cents, currency, company_id" },
  { entity: "activities", columns: [{ expr: "subject", weight: 2 }, { expr: "ifnull(notes, '')", weight: 1 }], select: "id, type, subject, contact_id, deal_id" },
];

/** Tokeniza q: lowercase, términos ≥ 2 chars, máx 8 (§11.3). */
export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

/** Escapa los metacaracteres de LIKE (`\ % _`) — SIEMPRE antes de parametrizar. */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Condiciones ponderadas por término: score = suma de pesos de las columnas
 * que matchean (CASE por columna) y where = OR de todos los LIKE.
 *
 * El orden de `params` DEBE seguir el orden de los placeholders en el SQL
 * final (sección score completa primero, sección where después): los dos
 * consumidores componen `select …, (scoreSql) … where … (whereSql)`. La
 * versión original del tool de chat intercalaba los params por término, lo
 * que con múltiples términos asignaba patrones a slots equivocados (el WHERE
 * quedaba evaluando solo el último término) — bug latente enmascarado por
 * los tests single-término; corregido al extraer el helper (S10).
 */
export function weightedLike(
  columns: SearchTarget["columns"],
  terms: string[]
): { scoreSql: string; whereSql: string; params: string[] } {
  const scoreParts: string[] = [];
  const whereParts: string[] = [];
  const scoreParams: string[] = [];
  const whereParams: string[] = [];
  for (const term of terms) {
    const like = `%${escapeLike(term)}%`;
    for (const col of columns) {
      scoreParts.push(`(case when ${col.expr} like ? escape '\\' then ${col.weight} else 0 end)`);
      scoreParams.push(like);
    }
    for (const col of columns) {
      whereParts.push(`${col.expr} like ? escape '\\'`);
      whereParams.push(like);
    }
  }
  return { scoreSql: scoreParts.join(" + "), whereSql: whereParts.join(" or "), params: [...scoreParams, ...whereParams] };
}
