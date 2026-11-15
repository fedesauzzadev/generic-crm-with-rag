import { describe, expect, it } from "vitest";
import { DICT, translate } from "./translations";
import { STAGES, stageLabel, STAGE_LABELS_BY_LANG } from "./pipeline";
import { formatDate, formatMoney } from "./format";

// Review G2: la UI no puede mezclar idiomas. El diccionario ES/EN debe ser
// completo y simétrico; los stages y el historial se traducen en un punto.

describe("diccionario ES/EN", () => {
  it("mismas claves exactas en ambos idiomas (completitud)", () => {
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.es).sort());
  });

  it("sin valores vacíos; mismos placeholders {x} en ES y EN", () => {
    for (const key of Object.keys(DICT.es)) {
      const es = DICT.es[key];
      const en = DICT.en[key];
      expect(es.length, `es:${key}`).toBeGreaterThan(0);
      expect(en.length, `en:${key}`).toBeGreaterThan(0);
      const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      expect(params(es), key).toBe(params(en));
    }
  });

  it("translate resuelve placeholders y cae a la clave si falta", () => {
    expect(translate("es", "common.pageOf", { page: 2, totalPages: 5 })).toBe("Página 2 de 5");
    expect(translate("en", "common.pageOf", { page: 2, totalPages: 5 })).toBe("Page 2 of 5");
    expect(translate("es", "no.existe")).toBe("no.existe");
  });
});

describe("stage labels por idioma (punto único: pipeline.ts)", () => {
  it("los 5 stages tienen label no vacío en ES y EN", () => {
    for (const s of STAGES) {
      for (const lang of ["es", "en"] as const) {
        expect(stageLabel(s, lang).length).toBeGreaterThan(0);
      }
    }
  });

  it("mapeo pedido por Negocio: nuevo→Nuevo/New, calificado→Calificado/Qualified, propuesta→Propuesta/Proposal, ganado→Ganado/Won, perdido→Perdido/Lost", () => {
    expect(stageLabel("nuevo", "es")).toBe("Nuevo");
    expect(stageLabel("nuevo", "en")).toBe("New");
    expect(stageLabel("calificado", "es")).toBe("Calificado");
    expect(stageLabel("calificado", "en")).toBe("Qualified");
    expect(stageLabel("propuesta", "es")).toBe("Propuesta");
    expect(stageLabel("propuesta", "en")).toBe("Proposal");
    expect(stageLabel("ganado", "es")).toBe("Ganado");
    expect(stageLabel("ganado", "en")).toBe("Won");
    expect(stageLabel("perdido", "es")).toBe("Perdido");
    expect(stageLabel("perdido", "en")).toBe("Lost");
  });

  it("ES y EN nunca colisionan en todos los stages (traducción real)", () => {
    for (const s of STAGES) {
      expect(STAGE_LABELS_BY_LANG.es[s]).not.toBe(STAGE_LABELS_BY_LANG.en[s]);
    }
  });
});

describe("smoke del texto de evento de historial en ambos idiomas", () => {
  it("creación: 'Negocio creado en …' / 'Deal created in …' con stage traducido", () => {
    expect(translate("es", "history.created", { stage: stageLabel("nuevo", "es") })).toBe(
      "Negocio creado en Nuevo"
    );
    expect(translate("en", "history.created", { stage: stageLabel("nuevo", "en") })).toBe(
      "Deal created in New"
    );
  });

  it("actor: 'por X' / 'by X'", () => {
    expect(translate("es", "history.by", { actor: "Fede" })).toBe("por Fede");
    expect(translate("en", "history.by", { actor: "Fede" })).toBe("by Fede");
  });

  it("transición compuesta from → to en ambos idiomas (formato del detalle)", () => {
    expect(`${stageLabel("nuevo", "es")} → ${stageLabel("calificado", "es")}`).toBe("Nuevo → Calificado");
    expect(`${stageLabel("nuevo", "en")} → ${stageLabel("calificado", "en")}`).toBe("New → Qualified");
  });
});

describe("historial de montos (H-09)", () => {
  it("claves nuevas presentes y no vacías en ES y EN", () => {
    for (const key of ["deals.amountHistory", "deals.amountChange", "deals.amountEmpty"]) {
      expect(DICT.es[key], `es:${key}`).toBeTruthy();
      expect(DICT.en[key], `en:${key}`).toBeTruthy();
    }
  });

  it("formato del evento: 'de $X a $Y' / 'from $X to $Y' con montos formateados", () => {
    const from = formatMoney(100000, "USD"); // $1,000.00
    const to = formatMoney(250000, "USD"); // $2,500.00
    expect(translate("es", "deals.amountChange", { from, to })).toBe("de $1,000.00 a $2,500.00");
    expect(translate("en", "deals.amountChange", { from, to })).toBe("from $1,000.00 to $2,500.00");
  });

  it("estado vacío traducido en ambos idiomas", () => {
    expect(translate("es", "deals.amountEmpty")).toBe("Aún sin cambios de monto.");
    expect(translate("en", "deals.amountEmpty")).toBe("No amount changes yet.");
  });
});

describe("fechas por idioma", () => {
  it("ES usa meses españoles; EN formato en-US", () => {
    // mediodía local: independiente de la TZ de la máquina que corre los tests
    expect(formatDate("2026-01-05T12:00:00", "es")).toBe("5 ene 2026");
    expect(formatDate("2026-01-05T12:00:00", "en")).toBe("Jan 5, 2026");
  });
});
