import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";
import { STAGES } from "../src/domain/pipeline.js";

// GET /api/metrics (H-06): shape del contrato §12.2.1 + números cuadrados
// contra el seed real (determinista) + 401 sin sesión. El pipeline debe ser
// espejo exacto de /api/deals/pipeline (invariante I8) sobre el MISMO dataset.

interface MetricsBody {
  ok: boolean;
  pipeline: {
    stages: { stage: string; count: number; total_cents: number }[];
    total_cents: number;
    total_count: number;
  };
  win_rate: { won: number; lost: number; rate: number | null };
  activities: {
    window_weeks: number;
    from: string;
    by_type: { type: string; count: number }[];
  };
  top_companies: {
    company_id: string;
    name: string;
    open_count: number;
    open_cents: number;
  }[];
}

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-metrics-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test User" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function getMetrics(): Promise<{ res: Response; body: MetricsBody }> {
  const res = await app.request("/api/metrics", { headers: { cookie } });
  return { res, body: (await res.json()) as MetricsBody };
}

const seedTop = [
  { company_id: "00000000-0000-4000-8000-000000000011", name: "Northwind Logistics", open_count: 4, open_cents: 38_100_000 },
  { company_id: "00000000-0000-4000-8000-000000000012", name: "Acme Software", open_count: 2, open_cents: 26_100_000 },
  { company_id: "00000000-0000-4000-8000-000000000013", name: "Blueharbor Retail", open_count: 1, open_cents: 15_600_000 },
  { company_id: "00000000-0000-4000-8000-000000000014", name: "Meridian Consulting", open_count: 2, open_cents: 13_200_000 },
  { company_id: "00000000-0000-4000-8000-000000000015", name: "Ironclad Manufacturing", open_count: 1, open_cents: 6_750_000 },
];

describe("GET /api/metrics — sesión y shape (§12.2.1)", () => {
  it("sin cookie → 401", async () => {
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("payload con las 4 secciones exactas; 5 stages y 4 tipos SIEMPRE, en orden", async () => {
    const { res, body } = await getMetrics();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["activities", "ok", "pipeline", "top_companies", "win_rate"]);
    expect(body.pipeline.stages.map((s) => s.stage)).toEqual([...STAGES]);
    expect(body.activities.by_type.map((t) => t.type)).toEqual(["call", "email", "meeting", "task"]);
    expect(body.activities.window_weeks).toBe(8);
  });

  it("from = now − 8 semanas (ISO, tolerancia de reloj de test)", async () => {
    const { body } = await getMetrics();
    const expected = Date.now() - 8 * 7 * 86_400_000;
    expect(Math.abs(Date.parse(body.activities.from) - expected)).toBeLessThan(5_000);
  });

  it("pipeline = espejo exacto de GET /api/deals/pipeline (I8, mismo dataset)", async () => {
    const pipelineRes = await app.request("/api/deals/pipeline", { headers: { cookie } });
    const { ok: _ok, ...pipeline } = (await pipelineRes.json()) as MetricsBody["pipeline"] & { ok: boolean };
    const { body } = await getMetrics();
    expect(body.pipeline).toEqual(pipeline);
  });
});

describe("GET /api/metrics — números cuadrados contra el seed", () => {
  it("pipeline: 16 deals, $1,939,500 totales; propuesta 3/$498,000; ganado 3/$608,000", async () => {
    const { body } = await getMetrics();
    expect(body.pipeline.total_count).toBe(16);
    expect(body.pipeline.total_cents).toBe(193_950_000);
    // Suma por stage = total (I8 recomputada del payload mismo).
    expect(body.pipeline.stages.reduce((acc, s) => acc + s.total_cents, 0)).toBe(body.pipeline.total_cents);
    expect(body.pipeline.stages.find((s) => s.stage === "propuesta")).toEqual({ stage: "propuesta", count: 3, total_cents: 49_800_000 });
    expect(body.pipeline.stages.find((s) => s.stage === "ganado")).toEqual({ stage: "ganado", count: 3, total_cents: 60_800_000 });
  });

  it("win_rate: 3 ganados / 2 perdidos = 0.6", async () => {
    const { body } = await getMetrics();
    expect(body.win_rate).toEqual({ won: 3, lost: 2, rate: 0.6 });
  });

  it("top_companies: orden por valor abierto, ≤5, terminales excluidos (Brightpath 6ª queda fuera)", async () => {
    const { body } = await getMetrics();
    expect(body.top_companies).toEqual(seedTop);
  });

  it("actividades: by_type cuadra con las actividades visibles dentro de la ventana (AC7)", async () => {
    const listRes = await app.request("/api/activities?query=&page=1&pageSize=100", { headers: { cookie } });
    const list = (await listRes.json()) as {
      items: { created_at: string; type: string; deleted_at: string | null }[];
    };
    const { body } = await getMetrics();
    const inWindow = list.items.filter((a) => a.created_at >= body.activities.from);
    const expectedByType = new Map<string, number>();
    for (const a of inWindow) expectedByType.set(a.type, (expectedByType.get(a.type) ?? 0) + 1);
    for (const t of body.activities.by_type) {
      expect(t.count, t.type).toBe(expectedByType.get(t.type) ?? 0);
    }
  });

  it("una actividad creada fuera de la ventana NO cuenta; una nueva (ahora) SÍ", async () => {
    const before = (await getMetrics()).body;
    const seedContact = db.prepare("select id from contacts limit 1").get() as { id: string };

    // Fuera de ventana: insert directo con created_at viejo (2019).
    db.prepare(
      `insert into activities (id, type, subject, notes, due_at, done_at, contact_id, deal_id, created_at, updated_at)
       values ('old-window-test', 'call', 'muy vieja', null, null, null, ?, null, '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z')`
    ).run(seedContact.id);

    const afterOld = (await getMetrics()).body;
    expect(afterOld.activities.by_type).toEqual(before.activities.by_type);

    // Dentro de ventana: POST normal (created_at = ahora) → su tipo +1.
    const post = await app.request("/api/activities", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "task", subject: "window check", contact_id: seedContact.id }),
    });
    expect(post.status).toBe(201);
    const afterNew = (await getMetrics()).body;
    const taskBefore = afterOld.activities.by_type.find((t) => t.type === "task")!.count;
    expect(afterNew.activities.by_type.find((t) => t.type === "task")!.count).toBe(taskBefore + 1);
  });
});

describe("GET /api/metrics — estado sin deals ni activities (AC3/AC4: nunca NaN, 0 si vacío)", () => {
  let emptyApp: Hono;
  let emptyDb: ReturnType<typeof bootstrapDatabase>;
  let emptyDir: string;
  let emptyCookie: string;

  beforeAll(async () => {
    emptyDir = mkdtempSync(path.join(tmpdir(), "crm-metrics-empty-"));
    emptyDb = bootstrapDatabase(path.join(emptyDir, "crm.db"));
    emptyApp = createApp(emptyDb);
    // Soft-delete de TODO: deals y activities fuera, resto intacto.
    emptyDb.prepare("update deals set deleted_at = '2026-01-01T00:00:00.000Z'").run();
    emptyDb.prepare("update activities set deleted_at = '2026-01-01T00:00:00.000Z'").run();
    const login = await emptyApp.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Empty User" }),
    });
    emptyCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  });

  afterAll(() => {
    emptyDb.close();
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("win_rate.rate = null (0 ganados + 0 perdidos), stages 5×0, tipos 4×0, top vacío", async () => {
    const res = await emptyApp.request("/api/metrics", { headers: { cookie: emptyCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsBody;
    expect(body.win_rate).toEqual({ won: 0, lost: 0, rate: null });
    expect(body.pipeline.stages).toHaveLength(5);
    for (const s of body.pipeline.stages) expect(s).toEqual({ stage: s.stage, count: 0, total_cents: 0 });
    expect(body.pipeline.total_cents).toBe(0);
    expect(body.pipeline.total_count).toBe(0);
    expect(body.activities.by_type).toHaveLength(4);
    for (const t of body.activities.by_type) expect(t.count).toBe(0);
    expect(body.top_companies).toEqual([]);
  });
});
