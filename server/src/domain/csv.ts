// Serializador CSV RFC 4180 (H-07 / S09). Cero deps runtime: el round-trip
// de gate 3 lo valida en tests un parser estándar independiente (D-013).

const BOM = "\uFEFF"; // EF BB BF en UTF-8: Excel muestra acentos sin wizard

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return ""; // NULL → vacío sin comillas
  const s = String(value);
  // RFC 4180 §2.6: entrecomillar solo si trae ", coma, CR o LF; " interna → ""
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** BOM + header + filas; separador ",", fin de línea CRLF. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((col) => escapeField(row[col])).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
