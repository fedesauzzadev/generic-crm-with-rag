import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed.js";

// Resuelve la raíz del repo (la carpeta que contiene db/migrations) caminando
// hacia arriba desde un directorio inicial. Necesario porque el server corre
// desde server/ (dev con tsx) o server/dist/ (build) y la DB vive en <root>/db.
export function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "db", "migrations"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

// Abre la SQLite con los pragmas de D-005: WAL + foreign_keys ON.
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// Bootstrap completo (AC H-01): crea el archivo si no existe, migra y seedea
// si está vacía. Corre automáticamente en cada arranque del server.
export function bootstrapDatabase(dbPath?: string): Database.Database {
  const root = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const file = dbPath ?? path.join(root, "db", "data", "crm.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = openDatabase(file);
  const ran = migrate(db, path.join(root, "db", "migrations"));
  if (ran.length > 0) console.log(`[server] migrations applied: ${ran.join(", ")}`);
  if (seedIfEmpty(db)) console.log("[server] empty database: demo seed inserted");
  return db;
}
