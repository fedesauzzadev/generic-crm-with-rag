import { describe, expect, it } from "vitest";
import { STAGES, allowedTargets, canTransition, isFinal, isStage } from "./pipeline";
import { DICT } from "./translations";
import { barPercent, formatDate, formatMoney, winRateLabel } from "./format";

// El espejo de la tabla de transiciones DEBE coincidir con el server
// (domain-model §2). Si alguien edita una copia sola, este test lo delata.

describe("admin pipeline: espejo del server", () => {
  it("transiciones idénticas a la tabla del domain-model", () => {
    expect(allowedTargets("nuevo")).toEqual(["calificado", "perdido"]);
    expect(allowedTargets("calificado")).toEqual(["nuevo", "propuesta", "perdido"]);
    expect(allowedTargets("propuesta")).toEqual(["calificado", "ganado", "perdido"]);
    expect(allowedTargets("ganado")).toEqual([]);
    expect(allowedTargets("perdido")).toEqual([]);
  });

  it("terminales sin salidas; pares prohibidos clásicos", () => {
    expect(isFinal("ganado") && isFinal("perdido")).toBe(true);
    expect(canTransition("nuevo", "propuesta")).toBe(false);
    expect(canTransition("calificado", "ganado")).toBe(false);
    expect(canTransition("propuesta", "ganado")).toBe(true);
  });

  it("isStage rechaza basura", () => {
    expect(isStage("nuevo")).toBe(true);
    expect(isStage("NUevo")).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });

  it("todo stage no terminal tiene al menos una salida", () => {
    for (const s of STAGES) {
      if (!isFinal(s)) expect(allowedTargets(s).length).toBeGreaterThan(0);
    }
  });
});

describe("format", () => {
  it("formatMoney: centavos → moneda explícita", () => {
    expect(formatMoney(4500000, "USD")).toBe("$45,000.00");
    expect(formatMoney(12000000, "EUR")).toContain("120,000.00"); // símbolo según locale
  });

  it("formatMoney: moneda desconocida cae sin tirar", () => {
    // Intl acepta códigos de 3 letras desconocidos (usa el código como símbolo,
    // con espacio no rompible); los inválidos caen al fallback crudo.
    expect(formatMoney(1234, "XYZ").replace(/\u00A0/g, " ")).toBe("XYZ 12.34");
    expect(formatMoney(1234, "TOOLONG")).toBe("TOOLONG 12.34");
  });

  it("formatDate: null → guion; ISO válido → fecha", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("2026-03-01")).toContain("2026");
  });
});

describe("dashboard KPIs (H-06)", () => {
  it("winRateLabel: null → '—' (nunca NaN con 0 ganados + 0 perdidos)", () => {
    expect(winRateLabel(null)).toBe("—");
  });

  it("winRateLabel: rate a porcentaje entero", () => {
    expect(winRateLabel(0.6)).toBe("60%");
    expect(winRateLabel(0)).toBe("0%");
    expect(winRateLabel(1)).toBe("100%");
    expect(winRateLabel(3 / 8)).toBe("38%"); // redondeo
  });

  it("barPercent: proporción contra el máximo; máximos degenerados → 0", () => {
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(200, 200)).toBe(100);
    expect(barPercent(70, 0)).toBe(0); // bloque vacío: sin división por cero
    expect(barPercent(0, 100)).toBe(0);
  });

  it("claves dashboard.* + nav.dashboard + home.dashboardLink existen en ES y EN", () => {
    const keys = [
      "nav.dashboard",
      "home.dashboardLink",
      "dashboard.title",
      "dashboard.kpiPipeline",
      "dashboard.kpiWinRate",
      "dashboard.kpiOpenDeals",
      "dashboard.kpiActivities",
      "dashboard.winRateSub",
      "dashboard.valueByStage",
      "dashboard.dealCount",
      "dashboard.activitiesByType",
      "dashboard.activitiesWindow",
      "dashboard.topCompanies",
      "dashboard.openCount",
      "dashboard.emptyCompanies",
      "dashboard.error",
    ];
    for (const key of keys) {
      expect(DICT.es[key], key).toBeTruthy();
      expect(DICT.en[key], key).toBeTruthy();
    }
  });
});
