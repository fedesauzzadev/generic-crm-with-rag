import { describe, expect, it } from "vitest";
import { toCsv } from "../src/domain/csv.js";

// Unit: quoting RFC 4180 del serializador puro (§12.2.2). El round-trip
// completo contra un parser externo vive en export.test.ts (D-013).

describe("toCsv — RFC 4180", () => {
  it("BOM + header + filas, CRLF, separador coma", () => {
    const csv = toCsv([{ a: 1, b: "x" }], ["a", "b"]);
    expect(csv).toBe("\uFEFFa,b\r\n1,x\r\n");
  });

  it("valor plano viaja sin comillas; coma obliga a entrecomillar", () => {
    const csv = toCsv([{ n: "Silva, María" }], ["n"]);
    expect(csv).toBe("\uFEFFn\r\n\"Silva, María\"\r\n");
  });

  it('comilla doble interna → "" dentro de campo entrecomillado', () => {
    const csv = toCsv([{ t: 'Directora "Comercial"' }], ["t"]);
    expect(csv).toBe("\uFEFFt\r\n\"Directora \"\"Comercial\"\"\"\r\n");
  });

  it("CR/LF dentro del valor → campo entrecomillado", () => {
    const csv = toCsv([{ t: "línea 1\r\nlínea 2" }], ["t"]);
    expect(csv.includes('"línea 1\r\nlínea 2"')).toBe(true);
  });

  it("null/undefined → vacío SIN comillas", () => {
    const csv = toCsv([{ a: null, b: undefined }], ["a", "b"]);
    expect(csv).toBe("\uFEFFa,b\r\n,\r\n");
  });
});
