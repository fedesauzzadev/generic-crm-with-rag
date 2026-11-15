import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// Deals: reglas de oro H-02. Owner obligatorio (I1), monto > 0 (I2), stage
// solo por /stage (I3), traza inmutable con actor (I4), soft delete (I5),
// pipeline suma = total (I8). DB real en archivo temp.

interface StageEvent {
  id: string;
  from_stage: string | null;
  to_stage: string;
  actor: string;
  created_at: string;
}

interface DealResponse {
  deal: {
    id: string;
    title: string;
    stage: string;
    amount_cents: number;
    currency: string;
    owner_id: string;
    company_name: string;
    contact_name: string | null;
    owner_name: string;
    stage_events: StageEvent[];
  };
}

let app: Hono;
let db: Database.Database;
let tmpDir: string;
let cookie: string;
const ACTOR = "Deal Tester";

let companyId: string;
let contactId: string;
let ownerId: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-deals-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: ACTOR }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  // Fixture: company/contact/user del seed de humo.
  companyId = (
    (await (await app.request("/api/companies", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
  contactId = (
    (await (await app.request("/api/contacts", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
  ownerId = (
    (await (await app.request("/api/users", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function req(url: string, method: string, body?: unknown, withCookie = true): Promise<Response> {
  return app.request(url, {
    method,
    headers: withCookie ? { "content-type": "application/json", cookie } : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createDeal(overrides: Record<string, unknown> = {}): Promise<DealResponse["deal"]> {
  const res = await req("/api/deals", "POST", {
    title: "Test deal",
    company_id: companyId,
    owner_id: ownerId,
    amount_cents: 100000,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createDeal failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as DealResponse).deal;
}

describe("deals: creación validada (I1/I2, fila creación §2)", () => {
  it("sin sesión → 401 (actor de trazas obligatorio, guarda 3)", async () => {
    const res = await req("/api/deals", "POST", { title: "x" }, false);
    expect(res.status).toBe(401);
  });

  it("crea deal válido con evento inicial from_stage=null y actor = sesión", async () => {
    const deal = await createDeal({ contact_id: contactId });
    expect(deal.stage).toBe("nuevo"); // default
    expect(deal.currency).toBe("USD"); // default
    expect(deal.stage_events).toHaveLength(1);
    expect(deal.stage_events[0].from_stage).toBeNull();
    expect(deal.stage_events[0].to_stage).toBe("nuevo");
    expect(deal.stage_events[0].actor).toBe(ACTOR);
  });

  it("rechaza deal sin owner con 422 (I1)", async () => {
    const res = await req("/api/deals", "POST", {
      title: "No owner",
      company_id: companyId,
      amount_cents: 100,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("owner_id");
  });

  it("rechaza owner inexistente con 422", async () => {
    const res = await req("/api/deals", "POST", {
      title: "Ghost owner",
      company_id: companyId,
      owner_id: "no-such-user",
      amount_cents: 100,
    });
    expect(res.status).toBe(422);
  });

  it("rechaza monto 0 y negativo con 422 (I2)", async () => {
    for (const amount_cents of [0, -1]) {
      const res = await req("/api/deals", "POST", {
        title: "Zero",
        company_id: companyId,
        owner_id: ownerId,
        amount_cents,
      });
      expect(res.status).toBe(422);
    }
  });

  it("sin company_id (obligatoria, I7) → 422", async () => {
    const res = await req("/api/deals", "POST", { title: "No company", owner_id: ownerId, amount_cents: 100 });
    expect(res.status).toBe(422);
  });

  it("no se puede nacer ganado → 422", async () => {
    const res = await req("/api/deals", "POST", {
      title: "Born won",
      company_id: companyId,
      owner_id: ownerId,
      amount_cents: 100,
      stage: "ganado",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("ganado");
  });

  it("nacer perdido está permitido (tabla §2)", async () => {
    const deal = await createDeal({ stage: "perdido" });
    expect(deal.stage).toBe("perdido");
  });
});

describe("deals: cambio de stage con transiciones + traza (I3/I4)", () => {
  it("transición válida (nuevo→calificado) actualiza y escribe traza con actor", async () => {
    const deal = await createDeal({ title: "Move me" });
    const res = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "calificado" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DealResponse;
    expect(body.deal.stage).toBe("calificado");
    expect(body.deal.stage_events).toHaveLength(2);

    const ev = body.deal.stage_events[1];
    expect(ev.from_stage).toBe("nuevo");
    expect(ev.to_stage).toBe("calificado");
    expect(ev.actor).toBe(ACTOR);
  });

  it("transición prohibida (nuevo→propuesta) → 422 con razón legible", async () => {
    const deal = await createDeal({ title: "Skip stages" });
    const res = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "propuesta" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Cannot move deal from `nuevo` to `propuesta`");
  });

  it("terminal ganado: sin salidas → 422 con mensaje de final stage", async () => {
    const deal = await createDeal({ title: "Won deal", stage: "propuesta" });
    await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "ganado" });

    const res = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "nuevo" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Cannot move deal from `ganado`; it is a final stage");
  });

  it("calificado→ganado prohibido (no se gana sin proponer)", async () => {
    const deal = await createDeal({ title: "Eager", stage: "calificado" });
    const res = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "ganado" });
    expect(res.status).toBe(422);
  });

  it("propuesta→calificado permitido (1 paso atrás)", async () => {
    const deal = await createDeal({ title: "Back one", stage: "propuesta" });
    const res = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "calificado" });
    expect(res.status).toBe(200);
  });

  it("stage desconocido → 422; deal inexistente → 404", async () => {
    const deal = await createDeal();
    expect((await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "won" })).status).toBe(422);
    expect(
      (await req("/api/deals/00000000-0000-4000-8000-ffffffffffff/stage", "PATCH", { to_stage: "nuevo" })).status
    ).toBe(404);
  });

  it("PATCH /api/deals/:id rechaza stage en el body (única vía = /stage)", async () => {
    const deal = await createDeal({ title: "Sneaky" });
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { stage: "ganado" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("stage");

    // El stage NO cambió.
    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.stage).toBe("nuevo");
  });

  it("no existe endpoint mutador de stage_events (I4: append-only)", async () => {
    const deal = await createDeal();
    const eventId = deal.stage_events[0].id;
    expect((await req(`/api/stage-events/${eventId}`, "PATCH", { actor: "hacker" })).status).toBe(404);
    expect((await req(`/api/stage-events/${eventId}`, "DELETE")).status).toBe(404);
    expect((await req(`/api/deals/${deal.id}/stage-events/${eventId}`, "DELETE")).status).toBe(404);
  });

  it("GET /api/deals/:id incluye el historial completo ordenado", async () => {
    const deal = await createDeal({ title: "History" });
    await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "calificado" });
    await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "propuesta" });

    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.stage_events.map((e) => e.to_stage)).toEqual(["nuevo", "calificado", "propuesta"]);
  });

  it("dos eventos con el mismo timestamp quedan en orden de inserción (rowid)", async () => {
    // Caso destapado por flake: la resolución de ISO-8601 es 1ms y dos
    // transiciones seguidas empatan. El desempate por id (UUID aleatorio)
    // invertía la historia; el orden real es el de inserción.
    const deal = await createDeal({ title: "Same ms" });
    const now = new Date().toISOString();
    const insert = db.prepare(
      `insert into stage_events (id, deal_id, from_stage, to_stage, actor, created_at)
       values (?, ?, ?, ?, 'tester', ?)`
    );
    // id del 2do evento ALFABÉTICAMENTE MENOR: si ordenara por id, invertiría.
    insert.run("zzzz0000-same-ms", deal.id, "nuevo", "calificado", now);
    insert.run("aaaa0000-same-ms", deal.id, "calificado", "propuesta", now);

    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    const tail = got.deal.stage_events.slice(-2).map((e) => e.to_stage);
    expect(tail).toEqual(["calificado", "propuesta"]);
  });
});

describe("deals: edición y listado", () => {
  it("PATCH edita campos de negocio sin tocar stage", async () => {
    const deal = await createDeal({ title: "Before" });
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { title: "After", amount_cents: 555 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DealResponse;
    expect(body.deal.title).toBe("After");
    expect(body.deal.amount_cents).toBe(555);
    expect(body.deal.stage).toBe("nuevo");
  });

  it("PATCH con amount_cents 0 → 422", async () => {
    const deal = await createDeal();
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 0 });
    expect(res.status).toBe(422);
  });

  it("lista con nombres join y búsqueda por título", async () => {
    const deal = await createDeal({ title: "Searchable ZZQ" });
    const list = (await (await req(`/api/deals?query=ZZQ`, "GET")).json()) as {
      items: { id: string; company_name: string; owner_name: string }[];
    };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(deal.id);
    expect(list.items[0].company_name).toBeTruthy();
    expect(list.items[0].owner_name).toBeTruthy();
  });

  it("GET /api/deals/:id devuelve company/owner/contact con nombre real (QA F-01)", async () => {
    const deal = await createDeal({ title: "Detail names", contact_id: contactId });
    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.company_name).toBeTruthy();
    expect(got.deal.owner_name).toBeTruthy();
    expect(got.deal.contact_name).toBeTruthy();
  });

  it("GET de id inexistente → 404", async () => {
    expect((await req("/api/deals/00000000-0000-4000-8000-ffffffffffff", "GET")).status).toBe(404);
  });
});

describe("deals: pipeline agregado (I8)", () => {
  it("suma de montos por stage = total del pipeline (mismo dataset)", async () => {
    const body = (await (await req("/api/deals/pipeline", "GET")).json()) as {
      stages: { stage: string; count: number; total_cents: number }[];
      total_cents: number;
      total_count: number;
    };
    // Los 5 stages siempre presentes (vacíos con 0).
    expect(body.stages.map((s) => s.stage)).toEqual([
      "nuevo",
      "calificado",
      "propuesta",
      "ganado",
      "perdido",
    ]);
    expect(body.stages.reduce((acc, s) => acc + s.total_cents, 0)).toBe(body.total_cents);
    expect(body.stages.reduce((acc, s) => acc + s.count, 0)).toBe(body.total_count);
    expect(body.total_count).toBeGreaterThanOrEqual(2); // seed de humo
  });

  it("el pipeline no cuenta deals soft-deleted (I5)", async () => {
    const before = (await (await req("/api/deals/pipeline", "GET")).json()) as { total_count: number };
    const deal = await createDeal({ title: "Delete from pipeline" });
    await req(`/api/deals/${deal.id}`, "DELETE");
    const after = (await (await req("/api/deals/pipeline", "GET")).json()) as { total_count: number };
    expect(after.total_count).toBe(before.total_count);
  });
});

describe("deals: soft delete (I5)", () => {
  it("DELETE marca; GET no lo lista ni lo trae por id; sus trazas quedan", async () => {
    const deal = await createDeal({ title: "Delete me", contact_id: contactId });
    await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "calificado" });

    const del = await req(`/api/deals/${deal.id}`, "DELETE");
    expect(del.status).toBe(200);

    const list = (await (await req("/api/deals?pageSize=100", "GET")).json()) as { items: { id: string }[] };
    expect(list.items.find((i) => i.id === deal.id)).toBeUndefined();
    expect((await req(`/api/deals/${deal.id}`, "GET")).status).toBe(404);

    // La traza NO se toca: sigue en la tabla aunque el deal esté borrado.
    const events = db
      .prepare("select * from stage_events where deal_id = ? order by created_at")
      .all(deal.id) as StageEvent[];
    expect(events).toHaveLength(2);
  });

  it("borrar un contacto NO toca sus deals (borrado lógico referencial)", async () => {
    const deal = await createDeal({ title: "Contact gone", contact_id: contactId });
    await req(`/api/contacts/${contactId}`, "DELETE");
    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.contact_id).toBe(contactId); // FK intacta (I5)
  });
});
