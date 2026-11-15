// Lógica pura del chat (S06, contrato POST /api/chat §11.2): armado del
// request, parseo del response y labels del trace. Sin React — testeable
// unit, patrón del resto de domain/.

import type { Lang } from "./translations";

export const MAX_QUESTION_CHARS = 500; // igual que el server (§11.2)
export const HISTORY_LIMIT = 10; // el server toma slice(-10): multi-turno en página (§11.0)

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TraceEntry {
  tool: "sql_query" | "search_records";
  ok: boolean;
  sql?: string;
  q?: string;
  rows: number;
  ms: number;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  lang: Lang;
}

// Turno que la página renderiza: el assistant lleva trace + flag degraded.
export interface ChatTurn extends ChatMessage {
  degraded?: boolean;
  trace?: TraceEntry[];
}

export interface ChatOk {
  degraded: boolean;
  reply: string;
  trace: TraceEntry[];
}

/** Historial + pregunta nueva → body del contrato. Pregunta vacía → null. */
export function buildChatRequest(history: ChatMessage[], question: string, lang: Lang): ChatRequestBody | null {
  const content = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (!content) return null;
  return { messages: [...history, { role: "user" as const, content }].slice(-HISTORY_LIMIT), lang };
}

/**
 * Normaliza el body 200 ({ok,degraded,reply,trace}) a lo que la página usa.
 * Defensivo en el trace: no-array o entradas con tool desconocida → fuera.
 */
export function parseChatOk(body: unknown): ChatOk {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawTrace = Array.isArray(b.trace) ? b.trace : [];
  const trace = rawTrace.filter(
    (e): e is TraceEntry =>
      typeof e === "object" && e !== null && ((e as TraceEntry).tool === "sql_query" || (e as TraceEntry).tool === "search_records")
  );
  return {
    degraded: b.degraded === true,
    reply: typeof b.reply === "string" ? b.reply : "",
    trace,
  };
}

const TOOL_LABELS: Record<Lang, Record<"sql_query" | "search_records", string>> = {
  es: { sql_query: "Consulta SQL", search_records: "Búsqueda" },
  en: { sql_query: "SQL query", search_records: "Search" },
};

export function traceToolLabel(tool: string, lang: Lang): string {
  if (tool === "sql_query" || tool === "search_records") return TOOL_LABELS[lang][tool];
  return tool; // tool futura/desconocida: nombre crudo, nunca crash
}

/**
 * Mensaje humano para el estado de error: el server ya manda mensajes honestos
 * (429/502/504, §11.2); solo el fallo de red (fetch TypeError) usa el fallback.
 */
export function chatErrorMessage(err: unknown, networkText: string): string {
  if (err instanceof TypeError) return networkText;
  return err instanceof Error && err.message ? err.message : networkText;
}
