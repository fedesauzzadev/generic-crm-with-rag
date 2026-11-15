import { serve } from "@hono/node-server";
import autocannon from "autocannon";
// shortcut: autocannon no expone p95 por defecto (solo p90/p97_5/p99); la
// lista de percentiles es un array mutable de su dependencia de agregación.
// Si autocannon cambia de API interna, este import falla al arrancar el bench.
import { percentiles } from "hdr-histogram-percentiles-obj";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

percentiles.push(95);

// Bench de listados (NFR N7): p95 < 200 ms en GET /api/contacts?pageSize=50
// y GET /api/deals/pipeline con el dataset de volumen (10k contacts / 1k
// deals). Flujo: `npm run seed:volume && npm run bench`. El server corre
// IN-PROCESS sobre la DB real (mismo camino de producción, puerto aparte).

const P95_BUDGET_MS = 200;
const REQUESTS = 200;
const CONNECTIONS = 10;
const port = Number(process.env.BENCH_PORT) || 8790;
const base = `http://127.0.0.1:${port}`;

const db = bootstrapDatabase();
const app = createApp(db);
const server = serve({ fetch: app.fetch, port });

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "bench" }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const counts = {
  contacts: (db.prepare("select count(*) as n from contacts").get() as { n: number }).n,
  deals: (db.prepare("select count(*) as n from deals").get() as { n: number }).n,
};
console.log(`[bench] dataset: ${counts.contacts} contacts, ${counts.deals} deals — ${REQUESTS} req / ${CONNECTIONS} connections`);

const targets = ["/api/contacts?pageSize=50", "/api/deals/pipeline"];
let failed = false;
for (const target of targets) {
  const result = await autocannon({ url: base + target, connections: CONNECTIONS, amount: REQUESTS, headers: { cookie } });
  const p95 = result.latency.p95;
  const ok = p95 < P95_BUDGET_MS;
  failed ||= !ok;
  console.log(`[bench] ${target} → p95 ${p95} ms (${ok ? "PASS" : "FAIL"}, budget ${P95_BUDGET_MS} ms; errors ${result.errors}, non2xx ${result.non2xx})`);
}

server.close();
db.close();
process.exit(failed ? 1 : 0);
