import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// H-09 (gate 4): traza inmutable de cambios de monto. Regla de oro: el
// evento nace SOLO si amount_cents cambia y viaja en la MISMA transacción
// que el update — o cambia todo o nada. AC1-AC6 del nodo N-0010.

interface AmountEvent {
  id: string;
  deal_id: string;
  old_cents: number;
  new_cents: number;
  actor: string;
  created_at: string;
}

interface DealResponse {
  deal: {
    id: string;
    title: string;
    amount_cents: number;
    stage_events: unknown[];
    amount_history: AmountEvent[];
  };
}

let app: Hono;
let db: Database.Database;
let tmpDir: string;
let dbFile: string;
let cookie: string;
const ACTOR = "Amount Tester";

let companyId: string;
let ownerId: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-amount-"));
  dbFile = path.join(tmpDir, "crm.db");
  db = bootstrapDatabase(dbFile);
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: ACTOR }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  companyId = (
    (await (await app.request("/api/companies", { headers: { cookie } })).json()) as {
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
    title: "Amount deal",
    company_id: companyId,
    owner_id: ownerId,
    amount_cents: 100000,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createDeal failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as DealResponse).deal;
}

function eventsInDb(dealId: string): AmountEvent[] {
  return db
    .prepare("select * from deal_amount_history where deal_id = ? order by created_at asc, rowid asc")
    .all(dealId) as AmountEvent[];
}

describe("amount history: evento transaccional (AC1)", () => {
  it("PATCH que cambia amount_cents escribe 1 evento con old/new exactos y actor de sesión", async () => {
    const deal = await createDeal({ title: "Raise" });
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 250000 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DealResponse;
    expect(body.deal.amount_cents).toBe(250000);
    expect(body.deal.amount_history).toHaveLength(1);
    expect(body.deal.amount_history[0].old_cents).toBe(100000);
    expect(body.deal.amount_history[0].new_cents).toBe(250000);
    expect(body.deal.amount_history[0].actor).toBe(ACTOR);
  });

  it("el actor del evento es el de la sesión activa (segundo login)", async () => {
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Amount Auditor" }),
    });
    const otherCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

    const deal = await createDeal();
    const res = await app.request(`/api/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ amount_cents: 150000 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DealResponse;
    expect(body.deal.amount_history[0].actor).toBe("Amount Auditor");
  });

  it("rollback: una constraint dentro de la transacción no deja evento ni update huérfano", async () => {
    // El handler corre UPDATE + INSERT dentro de db.transaction (guarda 4).
    // Provocamos el fallo con el mismo par de statements y un evento que
    // viola el CHECK old_cents > 0: si la transacción no envolviera ambos,
    // quedaría el monto actualizado sin evento (o el evento sin update).
    const deal = await createDeal({ title: "Rollback", amount_cents: 500000 });
    expect(() =>
      db
        .transaction(() => {
          db.prepare("update deals set amount_cents = 555555, updated_at = ? where id = ?").run(
            new Date().toISOString(),
            deal.id
          );
          db.prepare(
            `insert into deal_amount_history (id, deal_id, old_cents, new_cents, actor, created_at)
             values ('bad-event', ?, 0, 555555, 'x', ?)`
          ).run(deal.id, new Date().toISOString());
        })()
    ).toThrow();
    const amount = (db.prepare("select amount_cents from deals where id = ?").get(deal.id) as { amount_cents: number })
      .amount_cents;
    expect(amount).toBe(500000); // el update se revirtió
    expect(eventsInDb(deal.id)).toHaveLength(0); // sin evento huérfano
  });

  it("PATCH inválido (monto 0) NO deja evento ni cambia el monto — solo se auditan cambios aceptados", async () => {
    const deal = await createDeal({ title: "Reject zero", amount_cents: 200000 });
    for (const bad of [0, -1]) {
      const res = await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: bad });
      expect(res.status).toBe(422);
    }
    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.amount_cents).toBe(200000);
    expect(got.deal.amount_history).toHaveLength(0);
  });
});

describe("amount history: anti-ruido (AC3/AC4)", () => {
  it("PATCH de OTRO campo NO escribe evento de monto", async () => {
    const deal = await createDeal({ title: "Rename me" });
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { title: "Renamed" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DealResponse).deal.amount_history).toHaveLength(0);
  });

  it("PATCH con el MISMO monto NO escribe evento", async () => {
    const deal = await createDeal({ amount_cents: 123456 });
    const res = await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 123456 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DealResponse).deal.amount_history).toHaveLength(0);
  });

  it("deal recién creado → amount_history vacío (la traza nace con el primer cambio)", async () => {
    const deal = await createDeal();
    expect(deal.amount_history).toEqual([]);
    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.amount_history).toEqual([]);
  });
});

describe("amount history: lectura cronológica embebida (AC2)", () => {
  it("GET /:id incluye amount_history ascendente; PATCH /stage también lo embebe", async () => {
    const deal = await createDeal({ amount_cents: 100 });
    await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 200 });
    await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 300 });

    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.amount_history.map((e) => e.new_cents)).toEqual([200, 300]);

    // La respuesta de /stage devuelve deal con ambas trazas (§12.2.4).
    const stage = await req(`/api/deals/${deal.id}/stage`, "PATCH", { to_stage: "calificado" });
    expect(stage.status).toBe(200);
    const stageBody = (await stage.json()) as DealResponse;
    expect(stageBody.deal.amount_history).toHaveLength(2);
  });

  it("dos eventos con el mismo timestamp quedan en orden de inserción (rowid, L-04)", async () => {
    const deal = await createDeal({ amount_cents: 100 });
    await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 200 });
    const now = new Date().toISOString();
    const insert = db.prepare(
      `insert into deal_amount_history (id, deal_id, old_cents, new_cents, actor, created_at)
       values (?, ?, ?, ?, 'tester', ?)`
    );
    // Ids alfabéticamente invertidos: si ordenara por id (UUID aleatorio),
    // la historia se daría vuelta — igual flake que stage_events (L-04).
    insert.run("zzzz0000-same-ms", deal.id, 200, 300, now);
    insert.run("aaaa0000-same-ms", deal.id, 300, 400, now);

    const got = (await (await req(`/api/deals/${deal.id}`, "GET")).json()) as DealResponse;
    expect(got.deal.amount_history.map((e) => e.new_cents)).toEqual([200, 300, 400]);
  });

  it("persiste al reabrir el archivo de DB (N12)", async () => {
    const deal = await createDeal({ amount_cents: 777 });
    await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 888 });
    // Segunda conexión al MISMO archivo (la original sigue viva para los
    // tests siguientes): lo que se escribió tiene que estar en disco.
    const reopened = bootstrapDatabase(dbFile);
    const rows = reopened
      .prepare("select old_cents, new_cents, actor from deal_amount_history where deal_id = ?")
      .all(deal.id) as { old_cents: number; new_cents: number; actor: string }[];
    reopened.close();
    expect(rows).toEqual([{ old_cents: 777, new_cents: 888, actor: ACTOR }]);
  });
});

describe("amount history: inmutabilidad por ausencia de endpoints (AC6, gate 4)", () => {
  it("PUT/PATCH/DELETE sobre la traza → 404 (no existe ruta mutadora)", async () => {
    const deal = await createDeal({ amount_cents: 100 });
    await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 200 });
    const eventId = eventsInDb(deal.id)[0].id;

    expect((await req(`/api/deal-amount-history/${eventId}`, "PATCH", { new_cents: 1 })).status).toBe(404);
    expect((await req(`/api/deal-amount-history/${eventId}`, "PUT", { new_cents: 1 })).status).toBe(404);
    expect((await req(`/api/deal-amount-history/${eventId}`, "DELETE")).status).toBe(404);
    expect((await req(`/api/deal-amount-history`, "DELETE")).status).toBe(404);
    expect((await req(`/api/deals/${deal.id}/amount-history`, "DELETE")).status).toBe(404);
    expect((await req(`/api/deals/${deal.id}/amount-history`, "PATCH", { actor: "hacker" })).status).toBe(404);
    expect((await req(`/api/deals/${deal.id}/amount-history/${eventId}`, "DELETE")).status).toBe(404);

    // Y la traza sigue intacta.
    expect(eventsInDb(deal.id)).toHaveLength(1);
  });

  it("sin sesión → 401 (actor de trazas obligatorio)", async () => {
    const deal = await createDeal();
    expect((await req(`/api/deals/${deal.id}`, "PATCH", { amount_cents: 300 }, false)).status).toBe(401);
    expect(eventsInDb(deal.id)).toHaveLength(0);
  });
});
