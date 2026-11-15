import { describe, expect, it } from "vitest";
import { DICT } from "./translations";
import { ensureGroups, mainLabel, subtitleFor, detailHref, type SearchGroup } from "./search";

// Búsqueda global (H-08 / S10): helpers puros de agrupación/formato + claves
// i18n completas (regla N-0005: TODO string nuevo por diccionario).

describe("ensureGroups — 3 grupos SIEMPRE presentes (AC5 defensivo)", () => {
  it("undefined → 3 grupos vacíos en orden fijo", () => {
    expect(ensureGroups(undefined)).toEqual([
      { entity: "contacts", items: [] },
      { entity: "companies", items: [] },
      { entity: "deals", items: [] },
    ]);
  });

  it("respuesta parcial se rellena y reordena al orden fijo", () => {
    const partial: SearchGroup[] = [
      { entity: "deals", items: [{ id: "d1", score: 3, title: "X" }] },
      { entity: "contacts", items: [{ id: "c1", score: 3, full_name: "Ana" }] },
    ];
    const groups = ensureGroups(partial);
    expect(groups.map((g) => g.entity)).toEqual(["contacts", "companies", "deals"]);
    expect(groups[0].items[0].id).toBe("c1");
    expect(groups[1].items).toEqual([]);
    expect(groups[2].items[0].id).toBe("d1");
  });
});

describe("mainLabel / subtitleFor — formato por entidad", () => {
  it("contacts: label = full_name; subtítulo junta puesto · empresa · email (lo que haya)", () => {
    const item = { id: "1", score: 5, full_name: "Elena Sokolov", title: "Clinical Ops Manager", company_name: "Brightpath Health" };
    expect(mainLabel("contacts", item)).toBe("Elena Sokolov");
    expect(subtitleFor("contacts", item, "es")).toBe("Clinical Ops Manager · Brightpath Health");
    expect(subtitleFor("contacts", { ...item, title: null, company_name: null, email: "x@y.z" }, "es")).toBe("x@y.z");
    expect(subtitleFor("contacts", { id: "1", score: 1, full_name: "A" }, "es")).toBe("");
  });

  it("companies: label = name; subtítulo = industria", () => {
    const item = { id: "2", score: 5, name: "Brightpath Health", industry: "Healthcare" };
    expect(mainLabel("companies", item)).toBe("Brightpath Health");
    expect(subtitleFor("companies", item, "en")).toBe("Healthcare");
    expect(subtitleFor("companies", { id: "2", score: 1, name: "X", industry: null }, "en")).toBe("");
  });

  it("deals: label = título; subtítulo = empresa · etapa LOCALIZADA", () => {
    const item = {
      id: "3", score: 3, title: "Analytics workspace pilot",
      company_name: "Brightpath Health", stage: "propuesta" as const,
    };
    expect(mainLabel("deals", item)).toBe("Analytics workspace pilot");
    expect(subtitleFor("deals", item, "es")).toBe("Brightpath Health · Propuesta");
    expect(subtitleFor("deals", item, "en")).toBe("Brightpath Health · Proposal");
  });
});

describe("detailHref — navegación al detalle (AC3)", () => {
  it("ruta por entidad: /contacts/:id · /companies/:id · /deals/:id", () => {
    expect(detailHref("contacts", "x1")).toBe("/contacts/x1");
    expect(detailHref("companies", "x2")).toBe("/companies/x2");
    expect(detailHref("deals", "x3")).toBe("/deals/x3");
  });
});

describe("i18n — claves de búsqueda y detalle presentes y simétricas", () => {
  const keys = [
    "search.placeholder", "search.hint", "search.searching", "search.empty", "search.groupEmpty",
    "contacts.backShort", "contacts.detailLoadError",
    "companies.backShort", "companies.detailLoadError",
    "detail.noDeals", "detail.noContacts",
  ];

  it("todas las claves nuevas existen con valor no vacío en ES y EN", () => {
    for (const key of keys) {
      expect(DICT.es[key], `es:${key}`).toBeTruthy();
      expect(DICT.en[key], `en:${key}`).toBeTruthy();
    }
  });

  it("search.empty lleva el placeholder {q} en ambos idiomas", () => {
    expect(DICT.es["search.empty"]).toContain("{q}");
    expect(DICT.en["search.empty"]).toContain("{q}");
  });
});
