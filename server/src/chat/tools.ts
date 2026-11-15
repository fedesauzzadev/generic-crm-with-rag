import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { SEARCH_TARGETS, tokenize, weightedLike } from "../domain/search-rank.js";

// Tools del agente (§11.3). Guardas por CONSTRUCCIÓN, no por confianza al
// modelo (N14): conexión dedicada readonly + query_only, statement único,
// SELECT/WITH no-recursive, stmt.reader, wrapper con LIMIT forzado.

export interface TraceEntry {
  tool: "sql_query" | "search_records";
  ok: boolean;
  sql?: string;
  q?: string;
  rows: number;
  ms: number;
}

export interface ToolResult {
  /** Texto que se devuelve al modelo como tool-result. Errores incluidos: la tool nunca tumba el turno. */
  output: string;
  trace: TraceEntry;
}

export interface ToolSpecs {
  sql_query: { sql: string };
  search_records: { q: string };
}

const MAX_ROWS = 50;
const SQL_STATEMENT_TIMEOUT_MS = 5_000; // busy/lock timeout de la conn readonly

/**
 * Conexión SEPARADA read-only sobre el mismo archivo (D-011): readonly:true
 * (SQLite niega escrituras) + query_only=ON (segunda barrera). Los tests
 * N14 la usan para probar que una escritura directa muere acá.
 */
export function openReadonlyConnection(dbPath: string): Database.Database {
  const ro = new Database(dbPath, { readonly: true, timeout: SQL_STATEMENT_TIMEOUT_MS });
  ro.pragma("query_only = ON");
  return ro;
}

function errorResult(tool: TraceEntry["tool"], sql: string | undefined, q: string | undefined, message: string, startedAt: number): ToolResult {
  return {
    output: `error: ${message}`,
    trace: { tool, ok: false, sql, q, rows: 0, ms: Math.round(performance.now() - startedAt) },
  };
}

function sqlQuery(readonlyConn: () => Database.Database, rawSql: unknown, startedAt: number): ToolResult {
  const sql = typeof rawSql === "string" ? rawSql.trim() : "";
  const done = (output: string, rows: number, ok: boolean): ToolResult => ({
    output,
    trace: { tool: "sql_query", ok, sql, rows, ms: Math.round(performance.now() - startedAt) },
  });
  const fail = (message: string, rows = 0): ToolResult => done(`error: ${message}`, rows, false);

  if (!sql) return fail("sql is required", 0);

  // Guarda 1: statement único — todo ";" interno (más allá del final) es rechazado;
  // prepare() sería la segunda barrera (better-sqlite3 niega multi-statement).
  const body = sql.replace(/;+\s*$/, "");
  if (body.includes(";")) return fail("multiple statements are not allowed", 0);

  // Guarda 2: allowlist de primera keyword — SELECT o WITH no-RECURSIVE.
  // PRAGMA/ATTACH/INSERT/UPDATE/DELETE/DROP quedan fuera por acá y por reader.
  const head = body.slice(0, 10).toUpperCase();
  const isSelect = head.startsWith("SELECT");
  const isWith = head.startsWith("WITH");
  if (!isSelect && !isWith) return fail("only a single SELECT statement is allowed", 0);
  if (isWith && /\brecursive\b/i.test(body)) return fail("WITH RECURSIVE is not allowed", 0);

  try {
    // Guarda 3: stmt.reader === true solo para statements que devuelven filas.
    const inner = readonlyConn().prepare(body);
    if (inner.reader !== true) return fail("statement does not return rows", 0);

    // Guarda 4: wrapper con LIMIT forzado — cap 50; la fila 51 solo detecta truncado.
    const rows = readonlyConn()
      .prepare(`select * from (${body}) limit ?`)
      .all(MAX_ROWS + 1) as Array<Record<string, unknown>>;

    const truncated = rows.length > MAX_ROWS;
    const shown = truncated ? rows.slice(0, MAX_ROWS) : rows;
    const payload = {
      rows: shown,
      row_count: shown.length,
      ...(truncated ? { truncated: true, note: "result truncated at 50 rows — refine the query (add WHERE / LIMIT)" } : {}),
    };
    return done(JSON.stringify(payload, jsonSafe), shown.length, true);
  } catch (err) {
    // SqliteError (sintaxis, readonly, etc.) → tool-error legible, sin internals del path.
    const message = String((err as Error)?.message ?? "invalid query").slice(0, 200);
    return fail(message, 0);
  }
}

/** bigint (safe integers) y otros valores → JSON plano seguro. */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// ---------------------------------------------------------------------------
// search_records: ranking de términos con pesos por columna (D-011), SIN
// embeddings. Determinista (ORDER BY score DESC, id), top 5 por entidad.
// Ranking/escaping compartidos con GET /api/search en domain/search-rank.ts
// (S10): un solo punto de verdad para el LIKE escape (N6).
// ---------------------------------------------------------------------------

function searchRecords(ro: Database.Database, rawQ: unknown, startedAt: number): ToolResult {
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const done = (output: string, rows: number, ok: boolean): ToolResult => ({
    output,
    trace: { tool: "search_records", ok, q, rows, ms: Math.round(performance.now() - startedAt) },
  });

  if (!q || q.length > 200) return done("error: q must be a string of 1..200 chars", 0, false);
  const terms = tokenize(q);
  if (terms.length === 0) return done("error: q has no searchable terms (min 2 chars each)", 0, false);

  try {
    const byEntity: Record<string, unknown[]> = {};
    let total = 0;
    for (const target of SEARCH_TARGETS) {
      const { scoreSql, whereSql, params } = weightedLike(target.columns, terms);
      const rows = ro
        .prepare(
          `select ${target.select}, (${scoreSql}) as score
           from ${target.entity}
           where deleted_at is null and (${whereSql})
           order by score desc, id
           limit 5`
        )
        .all(...params) as Array<Record<string, unknown>>;
      byEntity[target.entity] = rows;
      total += rows.length;
    }
    return done(JSON.stringify(byEntity, jsonSafe), total, true);
  } catch (err) {
    const message = String((err as Error)?.message ?? "search failed").slice(0, 200);
    return done(`error: ${message}`, 0, false);
  }
}

/** Specs de las tools para el protocolo OpenAI (§11.3). */
export const CHAT_TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "sql_query",
      description:
        "Run a single read-only SELECT statement against the CRM SQLite database. Use it for counts, sums, aggregations and exact lookups. Soft-deleted rows (deleted_at not null) must be excluded. Returns at most 50 rows.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "A single SELECT statement (no semicolons, no PRAGMA/ATTACH, no WITH RECURSIVE)." },
        },
        required: ["sql"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_records",
      description:
        "Weighted keyword search over companies, contacts, deals and activities (top 5 per entity). Use it to find records by name or topic when the question is not an aggregation.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search terms, 1..200 chars." },
        },
        required: ["q"],
        additionalProperties: false,
      },
    },
  },
] as const;

// Conexión dedicada SINGLETON por archivo de DB (§11.3): readonly:true +
// query_only=ON. Compartida entre requests (better-sqlite3 es síncrono: sin
// concurrencia real dentro del proceso). close() la libera (tests/Windows).
const readonlySingletons = new Map<string, Database.Database>();

function readonlyConnectionFor(dbPath: string): Database.Database {
  let ro = readonlySingletons.get(dbPath);
  if (!ro) {
    ro = openReadonlyConnection(dbPath);
    readonlySingletons.set(dbPath, ro);
  }
  return ro;
}

export interface ChatTools {
  specs: typeof CHAT_TOOL_SPECS;
  /** Ejecuta una tool por nombre; nombre/args inválidos → tool-result de error (el loop sigue). */
  run(name: string, argsJson: string): ToolResult;
  /** Cierra la conexión readonly dedicada (Windows: libera handles del archivo). */
  close(): void;
}

export function createTools(db: Database.Database): ChatTools {
  // La conn dedicada exige archivo (una DB :memory: no tiene DDL compartible).
  const readonlyConn = (): Database.Database => {
    if (db.memory || !existsSync(db.name)) {
      throw new Error("sql_query requires the file-based database of this server");
    }
    return readonlyConnectionFor(db.name);
  };

  return {
    specs: CHAT_TOOL_SPECS,
    close(): void {
      const ro = readonlySingletons.get(db.name);
      if (ro) {
        ro.close();
        readonlySingletons.delete(db.name);
      }
    },
    run(name: string, argsJson: string): ToolResult {
      const startedAt = performance.now();
      let args: unknown;
      try {
        args = JSON.parse(argsJson || "{}");
      } catch {
        return errorResult("sql_query", undefined, undefined, "invalid tool arguments (expected JSON)", startedAt);
      }
      if (name === "sql_query") {
        return sqlQuery(readonlyConn, (args as ToolSpecs["sql_query"])?.sql, startedAt);
      }
      if (name === "search_records") {
        return searchRecords(readonlyConn(), (args as ToolSpecs["search_records"])?.q, startedAt);
      }
      return errorResult("sql_query", undefined, undefined, `unknown tool "${name}"`, startedAt);
    },
  };
}
