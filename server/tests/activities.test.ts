import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { bootstrapDatabase } from "../src/db.js";

// Activities: CRUD + invariante I6 (nunca huérfana) + validaciones de enum/FK.

let app: Hono;
let db: ReturnType<typeof bootstrapDatabase>;
let tmpDir: string;
let cookie: string;
let contactId: string;
let dealId: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "crm-activities-"));
  db = bootstrapDatabase(path.join(tmpDir, "crm.db"));
  app = createApp(db);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Activity Tester" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  contactId = (
    (await (await app.request("/api/contacts", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
  const companyId = (
    (await (await app.request("/api/companies", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
  const ownerId = (
    (await (await app.request("/api/users", { headers: { cookie } })).json()) as {
      items: { id: string }[];
    }
  ).items[0].id;
  const dealRes = await app.request("/api/deals", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "Activity host", company_id: companyId, owner_id: ownerId, amount_cents: 1000 }),
  });
  dealId = ((await dealRes.json()) as { deal: { id: string } }).deal.id;
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function req(url: string, method: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("activities CRUD", () => {
  it("sin sesión → 401", async () => {
    expect((await app.request("/api/activities")).status).toBe(401);
  });

  it("crea una activity vinculada a contact (I6 satisfecha)", async () => {
    const res = await req("/api/activities", "POST", {
      type: "call",
      subject: "Intro call zebra-unique",
      contact_id: contactId,
      due_at: "2026-02-01T10:00:00.000Z",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { activity: { id: string; done_at: string | null } };
    expect(body.activity.done_at).toBeNull(); // pendiente por defecto
  });

  it("crea una activity vinculada a deal", async () => {
    const res = await req("/api/activities", "POST", {
      type: "task",
      subject: "Send quote",
      deal_id: dealId,
    });
    expect(res.status).toBe(201);
  });

  it("rechaza huérfana (sin contact_id NI deal_id) con 422 legible (I6)", async () => {
    const res = await req("/api/activities", "POST", { type: "email", subject: "To nobody" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("contact_id or a deal_id");
  });

  it("rechaza tipo fuera del enum con 422", async () => {
    const res = await req("/api/activities", "POST", {
      type: "smoke-signal",
      subject: "Weird",
      contact_id: contactId,
    });
    expect(res.status).toBe(422);
  });

  it("rechaza FK inexistente con 422", async () => {
    const res = await req("/api/activities", "POST", {
      type: "call",
      subject: "Ghost",
      deal_id: "no-such-deal",
    });
    expect(res.status).toBe(422);
  });

  it("rechaza fecha no-ISO con 422", async () => {
    const res = await req("/api/activities", "POST", {
      type: "call",
      subject: "Bad date",
      contact_id: contactId,
      due_at: "tomorrow",
    });
    expect(res.status).toBe(422);
  });

  it("lista con nombres join y paginación", async () => {
    const res = await req("/api/activities?page=1&pageSize=10", "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { subject: string; contact_name: string | null; deal_title: string | null }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(2); // seed (2) + las creadas
    expect(body.items.some((i) => i.contact_name || i.deal_title)).toBe(true);
  });

  it("busca por subject", async () => {
    const body = (await (await req("/api/activities?query=zebra-unique", "GET")).json()) as {
      items: { subject: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].subject).toBe("Intro call zebra-unique");
  });

  it("edita con PATCH (marcar hecha) y valida tipo en update", async () => {
    const created = (await (await req("/api/activities", "POST", { type: "task", subject: "Finish me", contact_id: contactId })).json()) as {
      activity: { id: string };
    };
    const done_at = "2026-01-15T12:00:00.000Z";
    const res = await req(`/api/activities/${created.activity.id}`, "PATCH", { done_at });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: { done_at: string | null; subject: string } };
    expect(body.activity.done_at).toBe(done_at);

    const badType = await req(`/api/activities/${created.activity.id}`, "PATCH", { type: "nope" });
    expect(badType.status).toBe(422);
  });

  it("PATCH no puede dejarla huérfana (guarda I6 sobre el merge)", async () => {
    const created = (await (await req("/api/activities", "POST", { type: "call", subject: "Unlink", contact_id: contactId })).json()) as {
      activity: { id: string; contact_id: string | null; deal_id: string | null };
    };
    const res = await req(`/api/activities/${created.activity.id}`, "PATCH", { contact_id: null });
    expect(res.status).toBe(422);
  });

  it("soft delete: desaparece del listado, GET por id 404", async () => {
    const created = (await (await req("/api/activities", "POST", { type: "email", subject: "Delete me", deal_id: dealId })).json()) as {
      activity: { id: string };
    };
    expect((await req(`/api/activities/${created.activity.id}`, "DELETE")).status).toBe(200);
    const list = (await (await req("/api/activities?pageSize=100", "GET")).json()) as { items: { id: string }[] };
    expect(list.items.find((i) => i.id === created.activity.id)).toBeUndefined();
    expect((await req(`/api/activities/${created.activity.id}`, "GET")).status).toBe(404);
  });

  it("GET de id inexistente → 404", async () => {
    expect((await req("/api/activities/00000000-0000-4000-8000-ffffffffffff", "GET")).status).toBe(404);
  });
});
