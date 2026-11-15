import { Hono } from "hono";
import type Database from "better-sqlite3";

// Users (owners de deals): SOLO lectura. No está en plan §4 pero el form de
// deals necesita los owners para el select obligatorio (I1). Sin create/update
// ni delete: los users son dato de seed.

export function createUsersRoutes(db: Database.Database): Hono {
  return new Hono().get("/", (c) => {
    const items = db
      .prepare("select id, name, email, role from users order by name asc")
      .all() as { id: string; name: string; email: string; role: string }[];
    return c.json({ ok: true, items });
  });
}
