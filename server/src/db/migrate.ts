import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

// Migrador mínimo (D-005): tabla schema_migrations + un archivo SQL numerado
// por migración, aplicado en orden y cada uno dentro de una transacción.

export function migrate(db: Database.Database, migrationsDir: string): string[] {
  db.exec(`create table if not exists schema_migrations (
    name text primary key,
    applied_at text not null
  )`);

  const appliedRows = db.prepare("select name from schema_migrations").all() as { name: string }[];
  const applied = new Set(appliedRows.map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(
        file,
        new Date().toISOString()
      );
    })();
    ran.push(file);
  }
  return ran;
}
