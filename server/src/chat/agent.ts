import type Database from "better-sqlite3";
import { chatCompletion, LlmAbortedError, type LlmEnv, type LlmMessage } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";
import { createTools, type TraceEntry } from "./tools.js";

// Loop de tool-calling acotado (§11.3 / N16): máx 3 rondas de tools + 1
// llamada FINAL SIN tools (fuerza respuesta con lo que hay), máx 3 ejecuciones
// de tools por turno, máx 4 llamadas LLM totales. Sin retry.

const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_RUNS = 3;

export interface AgentDeps {
  env: LlmEnv;
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

export interface AgentTurn {
  reply: string;
  trace: TraceEntry[];
}

export async function runAgent(
  db: Database.Database,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  lang: "es" | "en",
  deps: AgentDeps
): Promise<AgentTurn> {
  const tools = createTools(db);
  const convo: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(db, lang) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const trace: TraceEntry[] = [];
  let toolRuns = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await chatCompletion({
      env: deps.env,
      messages: convo,
      tools: [...tools.specs],
      fetchFn: deps.fetchFn,
      timeoutMs: deps.timeoutMs,
    });
    convo.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const reply = message.content?.trim();
      if (reply) return { reply, trace };
      break; // sin contenido ni tools → llamada final forzada
    }

    for (const call of calls) {
      let output: string;
      if (toolRuns >= MAX_TOOL_RUNS) {
        output = "error: tool execution budget for this turn is exhausted";
      } else {
        toolRuns++;
        const result = tools.run(call.function.name, call.function.arguments);
        trace.push(result.trace);
        output = result.output;
      }
      // Tool inválida o agotada → error COMO tool-result y el loop sigue (§11.3).
      convo.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  // Llamada final SIN tools (N16): el modelo ya no puede postergar la respuesta.
  const { message } = await chatCompletion({
    env: deps.env,
    messages: convo,
    fetchFn: deps.fetchFn,
    timeoutMs: deps.timeoutMs,
  });
  const reply = message.content?.trim();
  if (!reply) throw new LlmAbortedError("assistant produced no answer");
  return { reply, trace };
}
