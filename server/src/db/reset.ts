import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapDatabase, findRepoRoot } from "../db.js";
import { seedCounts } from "./seed.js";

// CLI (`npm run reset`): borra la DB → re-migra → re-seedea (demo seed
// determinista). Plan de recuperación documentado en el README (D-005).

const root = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = path.join(root, "db", "data", "crm.db");
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(dbFile + suffix, { force: true });
}
const db = bootstrapDatabase(dbFile);
console.log(`[reset] database recreated at ${dbFile}`);
console.log(`[reset] seed counts: ${JSON.stringify(seedCounts(db))}`);
db.close();
