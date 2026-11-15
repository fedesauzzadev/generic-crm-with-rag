import { useMutation } from "@tanstack/react-query";
import { parseChatOk, type ChatRequestBody, type ChatOk } from "../domain/chat";

// Server state del chat (S06): POST /api/chat. Sin cache ni invalidación —
// cada turno es una mutación; el historial vive en la página (§11.0, sin
// persistencia). Mismo patrón fetch que crm.ts, aislado por vertical.

async function postChat(body: ChatRequestBody): Promise<ChatOk> {
  const res = await fetch("/api/chat", {
    credentials: "same-origin",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  const okFlag = typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;
  if (!res.ok || !okFlag) {
    // 400/401/422/429/502/504 → {ok:false,message} honesto del server (§11.2)
    const message = typeof data === "object" && data !== null ? (data as { message?: unknown }).message : undefined;
    throw new Error(typeof message === "string" && message ? message : `Request failed with status ${res.status}`);
  }
  return parseChatOk(data);
}

export function useChatSend() {
  return useMutation({ mutationFn: postChat });
}
