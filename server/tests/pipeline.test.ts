import { describe, expect, it } from "vitest";
import {
  CREATION_STAGES,
  STAGES,
  allowedTargets,
  canTransition,
  isFinal,
  isStage,
  transitionError,
} from "../src/domain/pipeline.js";

// Tabla de transiciones del domain-model §2 — tests primero (riesgo #4 del
// plan): si esta tabla está mal, la AC de trazas de H-02 se rompe.

describe("pipeline: tabla de transiciones", () => {
  it("nuevo → solo calificado o perdido (sin saltos hacia adelante)", () => {
    expect(canTransition("nuevo", "calificado")).toBe(true);
    expect(canTransition("nuevo", "perdido")).toBe(true);
    expect(canTransition("nuevo", "propuesta")).toBe(false);
    expect(canTransition("nuevo", "ganado")).toBe(false);
    expect(canTransition("nuevo", "nuevo")).toBe(false); // no es transición
  });

  it("calificado → atrás a nuevo, adelante a propuesta, o perdido", () => {
    expect(canTransition("calificado", "nuevo")).toBe(true); // 1 paso atrás
    expect(canTransition("calificado", "propuesta")).toBe(true);
    expect(canTransition("calificado", "perdido")).toBe(true);
    expect(canTransition("calificado", "ganado")).toBe(false); // no se gana sin proponer
  });

  it("propuesta → atrás a calificado, adelante a ganado, o perdido", () => {
    expect(canTransition("propuesta", "calificado")).toBe(true);
    expect(canTransition("propuesta", "ganado")).toBe(true);
    expect(canTransition("propuesta", "perdido")).toBe(true);
    expect(canTransition("propuesta", "nuevo")).toBe(false); // atrás de a 1 solo
  });

  it("ganado y perdido son terminales: sin salidas", () => {
    expect(isFinal("ganado")).toBe(true);
    expect(isFinal("perdido")).toBe(true);
    for (const to of STAGES) {
      expect(canTransition("ganado", to)).toBe(false);
      expect(canTransition("perdido", to)).toBe(false);
    }
    expect(allowedTargets("ganado")).toEqual([]);
    expect(allowedTargets("perdido")).toEqual([]);
  });

  it("allowedTargets coincide con canTransition para todo par de stages", () => {
    for (const from of STAGES) {
      for (const to of STAGES) {
        expect(allowedTargets(from).includes(to)).toBe(canTransition(from, to));
      }
    }
  });
});

describe("pipeline: creación", () => {
  it("se puede nacer en cualquier stage abierto o perdido, nunca ganado", () => {
    expect(CREATION_STAGES).toEqual(["nuevo", "calificado", "propuesta", "perdido"]);
    expect(CREATION_STAGES.includes("ganado")).toBe(false);
  });
});

describe("pipeline: helpers", () => {
  it("isStage acepta los 5 stages y rechaza cualquier otra cosa", () => {
    for (const s of STAGES) expect(isStage(s)).toBe(true);
    expect(isStage("Ganado")).toBe(false); // case-sensitive
    expect(isStage("won")).toBe(false);
    expect(isStage("")).toBe(false);
    expect(isStage(null)).toBe(false);
    expect(isStage(42)).toBe(false);
  });

  it("transitionError da mensaje legible para terminal y para par inválido", () => {
    expect(transitionError("ganado", "nuevo")).toBe(
      "Cannot move deal from `ganado`; it is a final stage"
    );
    expect(transitionError("nuevo", "propuesta")).toBe("Cannot move deal from `nuevo` to `propuesta`");
  });
});
