// Adaptador LLM provider-agnostic (D-011): un POST a {BASE_URL}/chat/completions
// con fetch nativo, CERO SDK. Cualquier endpoint OpenAI-compatible con
// tool-calling estándar sirve. La key viaja SOLO en el header Authorization y
// jamás se loguea (N3). fetch inyectable → los tests simulan el HTTP del LLM
// sin key real ni red (§11.5).

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const LLM_MAX_TOKENS = 700;
export const LLM_TIMEOUT_MS = 15_000; // N13: abort por llamada

/** Config leída por request (los tests la controlan con process.env). Sin key → null. */
export function llmEnv(): LlmEnv | null {
  const apiKey = process.env.CRM_LLM_API_KEY?.trim();
  if (!apiKey) return null; // degradación honesta (§11.2) — el route NO llama al adaptador
  return {
    apiKey,
    baseUrl: (process.env.CRM_LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, ""),
    model: process.env.CRM_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
  };
}

/** Proveedor LLM falló (HTTP no-2xx o error de red) → el route lo mapea a 502 (§11.2). */
export class LlmProviderError extends Error {
  constructor(public readonly upstreamStatus: number) {
    super(`LLM provider failed (HTTP ${upstreamStatus})`);
  }
}

/** Abort por timeout (N13) o loop agotado sin respuesta → el route lo mapea a 504. */
export class LlmAbortedError extends Error {
  constructor(message = "LLM call timed out") {
    super(message);
  }
}

export interface ChatCompletionRequest {
  env: LlmEnv;
  messages: LlmMessage[];
  tools?: LlmToolSpec[]; // ausente → llamada final SIN tools (fuerza respuesta, N16)
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

/** Una llamada al proveedor. Sin retry (§11.6: costo + latencia). */
export async function chatCompletion(req: ChatCompletionRequest): Promise<{ message: LlmMessage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await req.fetchFn(`${req.env.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${req.env.apiKey}` },
      body: JSON.stringify({
        model: req.env.model,
        max_tokens: LLM_MAX_TOKENS,
        messages: req.messages,
        ...(req.tools ? { tools: req.tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted || (err as Error)?.name === "AbortError") {
      throw new LlmAbortedError();
    }
    throw new LlmProviderError(0); // error de red sin status → estado de proveedor, no de config
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Log sin headers ni key (N3): solo el status del proveedor.
    console.error(`[chat] LLM provider responded HTTP ${res.status}`);
    throw new LlmProviderError(res.status);
  }
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: LlmMessage }> };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("empty choices");
    return { message };
  } catch {
    throw new LlmProviderError(res.status);
  }
}
