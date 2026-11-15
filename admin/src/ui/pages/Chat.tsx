import { useEffect, useRef, useState } from "react";
import { useChatSend } from "../../app/chat";
import { useI18n } from "../../app/i18n";
import type { Lang } from "../../domain/translations";
import {
  MAX_QUESTION_CHARS,
  buildChatRequest,
  chatErrorMessage,
  traceToolLabel,
  type ChatRequestBody,
  type ChatTurn,
  type TraceEntry,
} from "../../domain/chat";

// Página /chat (S06, AC1): conversación en memoria de página — al recargar
// arranca limpia (§11.0). Trace colapsable bajo cada respuesta (anti-alucinación
// §11.6), degradación honesta sin key (AC5) y lang activa en cada envío (AC6).

const SUGGESTIONS = ["chat.suggestion1", "chat.suggestion2", "chat.suggestion3"] as const;

type Translate = (key: string, params?: Record<string, string | number>) => string;

export default function ChatPage() {
  const { t, lang } = useI18n();
  const send = useChatSend();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, send.isPending]);

  function run(body: ChatRequestBody) {
    send.mutate(body, {
      onSuccess: (ok) =>
        setTurns((prev) => [...prev, { role: "assistant", content: ok.reply, degraded: ok.degraded, trace: ok.trace }]),
    });
  }

  function ask(text: string) {
    const body = buildChatRequest(turns, text, lang);
    if (!body || send.isPending) return;
    setTurns((prev) => [...prev, { role: "user", content: body.messages[body.messages.length - 1].content }]);
    setQuestion("");
    run(body);
  }

  function retry() {
    // Reenvía con el historial actual (ya incluye la pregunta sin respuesta).
    if (send.isPending || turns.length === 0 || turns[turns.length - 1].role !== "user") return;
    run({ messages: turns.slice(-10), lang });
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">{t("chat.title")}</h1>

      <div className="flex flex-col gap-3">
        {turns.length === 0 && !send.isPending && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">{t("chat.subtitle")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => ask(t(key))}
                  className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-800"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-700 px-3 py-2 text-sm text-white">
              {turn.content}
            </div>
          ) : (
            <div
              key={i}
              className={`max-w-[90%] rounded-lg border px-3 py-2 text-sm shadow-sm ${
                turn.degraded
                  ? "border-amber-300 bg-amber-50 text-amber-900" // info accionable, no error (AC5)
                  : "border-slate-200 bg-white text-slate-800"
              }`}
            >
              {turn.degraded && (
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide">{t("chat.degradedTitle")}</p>
              )}
              <p className="whitespace-pre-wrap">{turn.content}</p>
              {turn.trace && turn.trace.length > 0 && <TraceDetails trace={turn.trace} lang={lang} t={t} />}
            </div>
          )
        )}

        {send.isPending && (
          <div className="max-w-[90%] animate-pulse rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
            {t("chat.thinking")}
          </div>
        )}

        {send.isError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {chatErrorMessage(send.error, t("chat.errorNetwork"))}{" "}
            <button type="button" onClick={retry} className="font-semibold underline">
              {t("chat.retry")}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              ask(question);
            }
          }}
          maxLength={MAX_QUESTION_CHARS}
          disabled={send.isPending}
          placeholder={t("chat.placeholder")}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
        />
        <button
          type="button"
          onClick={() => ask(question)}
          disabled={send.isPending || !question.trim()}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {t("chat.send")}
        </button>
      </div>
    </div>
  );
}

// Transparencia anti-alucinación: qué ejecutó el agente (tool, sql/q, rows, ms).
function TraceDetails({ trace, lang, t }: { trace: TraceEntry[]; lang: Lang; t: Translate }) {
  return (
    <details className="mt-2 border-t border-slate-200 pt-1">
      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
        {t("chat.traceToggle")}
      </summary>
      <ul className="mt-2 space-y-2">
        {trace.map((entry, i) => (
          <li key={i} className="text-xs text-slate-600">
            <span className="font-medium">{traceToolLabel(entry.tool, lang)}</span>
            {" — "}
            {t("chat.traceRows", { count: entry.rows })} · {entry.ms} ms
            <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-[11px] text-slate-700">
              {entry.tool === "sql_query" ? entry.sql : entry.q}
            </pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
