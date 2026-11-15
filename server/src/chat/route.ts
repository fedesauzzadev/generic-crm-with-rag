import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { SessionEnv } from "../auth.js";
import { parseWith, readJsonBody } from "../http.js";
import { llmEnv, LlmAbortedError, LlmProviderError } from "./llm.js";
import { runAgent } from "./agent.js";

// POST /api/chat (§11.2): cookie de sesión (401 via middleware) → rate limit
// → zod → sin key? degradación honesta SIN llamar al adaptador (0 fetch).

export interface ChatDeps {
  /** fetch inyectable: tests simulan el HTTP del LLM sin red (D-011). */
  fetch?: typeof fetch;
  /** Timeout por llamada LLM; default 15 s (N13). Tests lo acortan. */
  timeoutMs?: number;
}

const chatSchema = z.object({
  // role system/tool desde el cliente → 422: el system prompt es solo del server.
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(20),
  lang: z.enum(["es", "en"]).default("es"),
});

const HISTORY_LIMIT = 10; // multi-turno = memoria de página: últimos 10 (§11.0)

// Rate limit demo (§11.2/N17): ventana deslizante 60 s por sesión, 10 req/min,
// Map en memoria con limpieza lazy. Sin deps; se pierde al reiniciar (demo).
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const rateHits = new Map<string, number[]>();

function overRateLimit(session: string): boolean {
  const now = Date.now();
  const recent = (rateHits.get(session) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateHits.set(session, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(session, recent);
  return false;
}

// Mensajes de error honestos, sin internals del proveedor (N5). Idioma del turno.
const PROVIDER_DOWN = {
  es: "El asistente no está disponible ahora (proveedor LLM). Reintentá en un momento.",
  en: "The assistant is unavailable right now (LLM provider). Try again in a moment.",
};
const NO_ANSWER = {
  es: "El asistente no pudo completar la respuesta. Reintentá, por favor.",
  en: "The assistant could not complete the answer. Please try again.",
};

// Degradación sin key (AC5 / §11.2): accionable, en el idioma del turno,
// sin mocks ni respuestas falsas. El CRM sigue 100% operativo.
const DEGRADED_REPLY = {
  es: "El asistente no está activo porque falta la clave del proveedor LLM. Para activarlo: 1) copiá .env.example a .env en la raíz del proyecto; 2) definí CRM_LLM_API_KEY con tu clave de un endpoint OpenAI-compatible (opcional: CRM_LLM_BASE_URL y CRM_LLM_MODEL); 3) reiniciá el server con npm run dev. Los detalles están en el README, sección «Assistant». Mientras tanto, el resto del CRM funciona con normalidad.",
  en: "The assistant is offline because the LLM provider key is missing. To enable it: 1) copy .env.example to .env at the project root; 2) set CRM_LLM_API_KEY to your OpenAI-compatible endpoint key (optional: CRM_LLM_BASE_URL and CRM_LLM_MODEL); 3) restart the server with npm run dev. Details live in the README, “Assistant” section. Meanwhile, the rest of the CRM keeps working normally.",
};

export function createChatRoutes(db: Database.Database, deps: ChatDeps = {}): Hono<SessionEnv> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  return new Hono<SessionEnv>().post("/", async (c) => {
    if (overRateLimit(c.get("session").name)) {
      throw new HTTPException(429, { message: "Too many requests — try again in a minute." });
    }

    const { messages, lang } = parseWith(chatSchema, await readJsonBody(c.req.raw));

    const env = llmEnv();
    if (!env) {
      return c.json({ ok: true, degraded: true, reason: "missing_key", reply: DEGRADED_REPLY[lang], trace: [] });
    }

    try {
      const turn = await runAgent(db, messages.slice(-HISTORY_LIMIT), lang, { env, fetchFn, timeoutMs: deps.timeoutMs });
      return c.json({ ok: true, degraded: false, reply: turn.reply, trace: turn.trace });
    } catch (err) {
      if (err instanceof LlmProviderError) throw new HTTPException(502, { message: PROVIDER_DOWN[lang] });
      if (err instanceof LlmAbortedError) throw new HTTPException(504, { message: NO_ANSWER[lang] });
      throw err; // 500 global vía onError, sin internals (N5)
    }
  });
}
