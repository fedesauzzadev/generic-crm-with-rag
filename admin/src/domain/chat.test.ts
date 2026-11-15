import { describe, expect, it } from "vitest";
import { buildChatRequest, chatErrorMessage, parseChatOk, traceToolLabel, MAX_QUESTION_CHARS } from "./chat";

const t_network = "No se pudo conectar con el server.";


// Unit de las funciones puras del chat (S06 §11.5 "Unit UI": request, parseo
// degraded/normal/error, formato del trace). La simetría ES/EN de las claves
// nuevas la cubre i18n.test.ts (mismas claves + placeholders).

describe("buildChatRequest", () => {
  it("agrega la pregunta recortada y manda el idioma activo", () => {
    const history: { role: "assistant"; content: string }[] = [{ role: "assistant", content: "hola" }];
    const body = buildChatRequest(history, "  ¿cuántos negocios?  ", "en");
    expect(body?.messages.at(-1)).toEqual({ role: "user", content: "¿cuántos negocios?" });
    expect(body?.lang).toBe("en");
  });

  it("pregunta vacía → null (no hay request; la UI además deshabilita submit)", () => {
    expect(buildChatRequest([], "   ", "es")).toBeNull();
  });

  it("cap 500 chars y últimos 10 mensajes (contrato §11.2)", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const body = buildChatRequest(history, "a".repeat(600), "es");
    expect(body).not.toBeNull();
    expect(body!.messages).toHaveLength(10); // 12 + pregunta = 13 → slice(-10)
    expect(body!.messages[0]?.content).toBe("m3");
    expect(body!.messages.at(-1)?.content).toHaveLength(MAX_QUESTION_CHARS);
  });
});

describe("parseChatOk (degraded vs normal vs malformado)", () => {
  it("normal: conserva reply, degraded false y el trace con sql", () => {
    const ok = parseChatOk({
      ok: true,
      degraded: false,
      reply: "Hay 3 negocios en propuesta.",
      trace: [{ tool: "sql_query", ok: true, sql: "SELECT count(*) FROM deals", rows: 3, ms: 12 }],
    });
    expect(ok).toEqual({
      degraded: false,
      reply: "Hay 3 negocios en propuesta.",
      trace: [{ tool: "sql_query", ok: true, sql: "SELECT count(*) FROM deals", rows: 3, ms: 12 }],
    });
  });

  it("degraded (sin key): degraded true, trace vacío (§11.2)", () => {
    const ok = parseChatOk({ ok: true, degraded: true, reason: "missing_key", reply: "Falta la key…", trace: [] });
    expect(ok.degraded).toBe(true);
    expect(ok.reply).toBe("Falta la key…");
    expect(ok.trace).toEqual([]);
  });

  it("search_records entra con q en lugar de sql", () => {
    const ok = parseChatOk({ ok: true, degraded: false, reply: "r", trace: [{ tool: "search_records", ok: true, q: "brightpath", rows: 5, ms: 3 }] });
    expect(ok.trace[0]?.q).toBe("brightpath");
    expect(ok.trace[0]?.sql).toBeUndefined();
  });

  it("defensivo: trace ausente → []; entradas con tool desconocida → filtradas; reply no-string → ''", () => {
    const ok = parseChatOk({ ok: true, degraded: false, trace: [{ tool: "drop_table", rows: 1, ms: 1 }, null] });
    expect(ok.trace).toEqual([]);
    expect(parseChatOk({ ok: true, degraded: false }).reply).toBe("");
  });
});

describe("traceToolLabel (formato del trace, ES/EN)", () => {
  it("sql_query y search_records con label por idioma", () => {
    expect(traceToolLabel("sql_query", "es")).toBe("Consulta SQL");
    expect(traceToolLabel("sql_query", "en")).toBe("SQL query");
    expect(traceToolLabel("search_records", "es")).toBe("Búsqueda");
    expect(traceToolLabel("search_records", "en")).toBe("Search");
  });

  it("tool desconocida → nombre crudo (nunca crash)", () => {
    expect(traceToolLabel("future_tool", "es")).toBe("future_tool");
  });
});

describe("chatErrorMessage (429/502/504 pasan; fallo de red usa fallback)", () => {
  it("Error del server (mensaje honesto del §11.2) pasa tal cual", () => {
    expect(chatErrorMessage(new Error("Too many requests — try again in a minute."), "net")).toBe(
      "Too many requests — try again in a minute."
    );
    expect(chatErrorMessage(new Error("El asistente no está disponible ahora (proveedor LLM). Reintentá en un momento."), "net")).toContain(
      "proveedor LLM"
    );
  });

  it("TypeError (fetch no llegó al server) → texto de red traducido", () => {
    expect(chatErrorMessage(new TypeError("Failed to fetch"), t_network)).toBe(t_network);
  });

  it("no-Error o Error sin mensaje → fallback", () => {
    expect(chatErrorMessage("boom", t_network)).toBe(t_network);
    expect(chatErrorMessage(new Error(""), t_network)).toBe(t_network);
  });
});
