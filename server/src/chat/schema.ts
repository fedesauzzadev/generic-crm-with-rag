import type Database from "better-sqlite3";

// DDL generado EN RUNTIME desde sqlite_master (D-011): la DB viva es la única
// fuente de verdad del esquema — nunca hardcodeado ni parseado de migraciones
// (el riesgo de drift queda cerrado por construcción). Cache por proceso,
// invalidado por schema_version (cualquier ALTER/TABLE nueva lo bumps).

const cache = new Map<string, string>();

export function buildSchemaDdl(db: Database.Database): string {
  const version = (db.pragma("schema_version", { simple: true }) as number) ?? 0;
  const key = `${db.name}#${version}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const rows = db
    .prepare(
      `select name, sql from sqlite_master
       where type = 'table' and name not like 'sqlite_%' and name != 'schema_migrations'
       order by name`
    )
    .all() as Array<{ name: string; sql: string | null }>;

  const ddl = rows
    .filter((r) => r.sql)
    .map((r) => `${r.sql};`)
    .join("\n\n");
  cache.set(key, ddl);
  return ddl;
}
