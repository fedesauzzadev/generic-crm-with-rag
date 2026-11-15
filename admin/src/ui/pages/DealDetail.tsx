import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../app/i18n";
import { useDeal, useDealMutations } from "../../app/crm";
import { allowedTargets, isFinal, stageLabel } from "../../domain/pipeline";
import { formatDate, formatDateTime, formatMoney } from "../../domain/format";
import DealFormModal from "../components/DealFormModal";
import Modal from "../components/Modal";
import { StageBadge } from "../components/StageBadge";

// Detalle de deal: el stage se mueve SOLO por transición válida (botones =
// allowedTargets del stage actual, espejo de la tabla del server) y la
// historia de stages es read-only (I4: no existe forma de editarla).

export default function DealDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n(); // antes de los early returns (regla de hooks)
  const { data, isLoading, isError, error } = useDeal(id);
  const { changeStage, update, remove } = useDealMutations();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        {t("common.loading")}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        <p>{error instanceof Error ? error.message : t("deals.detailLoadError")}</p>
        <Link to="/deals" className="mt-2 inline-block font-medium underline">
          {t("deals.back")}
        </Link>
      </div>
    );
  }

  const deal = data.deal;
  const targets = isFinal(deal.stage) ? [] : allowedTargets(deal.stage);

  function move(to: string) {
    setStageError(null);
    changeStage.mutate(
      { id: deal.id, to },
      {
        onError: (e) => setStageError(e instanceof Error ? e.message : t("deals.moveError")),
      }
    );
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/deals" className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline">
            {t("deals.backShort")}
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{deal.title}</h1>
          <p className="text-sm text-slate-500">
            {deal.company_name} · {t("deals.owner", { name: deal.owner_name ?? "" })}
            {deal.contact_name ? ` · ${t("deals.contact", { name: deal.contact_name })}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
          >
            {t("common.edit")}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("deals.details")}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t("deals.amount")}</dt>
                <dd className="font-semibold text-slate-900">{formatMoney(deal.amount_cents, deal.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t("deals.stage")}</dt>
                <dd>
                  <StageBadge stage={deal.stage} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t("deals.expectedClose")}</dt>
                <dd className="text-slate-900">{formatDate(deal.expected_close_at, lang)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t("common.created")}</dt>
                <dd className="text-slate-900">{formatDateTime(deal.created_at, lang)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("deals.moveStage")}</h2>
            {isFinal(deal.stage) ? (
              <p className="text-sm text-slate-500">{t("deals.finalStage", { stage: stageLabel(deal.stage, lang) })}</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-500">{t("deals.onlyValid")}</p>
                <div className="flex flex-wrap gap-2">
                  {targets.map((to) => (
                    <button
                      key={to}
                      type="button"
                      disabled={changeStage.isPending}
                      onClick={() => move(to)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
                        to === "ganado"
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : to === "perdido"
                            ? "bg-rose-600 text-white hover:bg-rose-700"
                            : "border border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700"
                      }`}
                    >
                      → {stageLabel(to, lang)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {stageError ? <p className="mt-2 text-sm text-red-600">{stageError}</p> : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("deals.stageHistory")} <span className="font-normal normal-case text-slate-400">{t("deals.readOnly")}</span>
            </h2>
            <ol className="space-y-3">
              {deal.stage_events.map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
                  <div>
                    <p className="text-sm text-slate-900">
                      {ev.from_stage ? (
                        <>
                          {stageLabel(ev.from_stage, lang)} → <span className="font-semibold">{stageLabel(ev.to_stage, lang)}</span>
                        </>
                      ) : (
                        t("history.created", { stage: stageLabel(ev.to_stage, lang) })
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t("history.by", { actor: ev.actor })} · {formatDateTime(ev.created_at, lang)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* H-09: traza de monto junto al de stages — read-only (sin endpoint mutador). */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("deals.amountHistory")} <span className="font-normal normal-case text-slate-400">{t("deals.readOnly")}</span>
            </h2>
            {deal.amount_history.length === 0 ? (
              <p className="text-sm text-slate-500">{t("deals.amountEmpty")}</p>
            ) : (
              <ol className="space-y-3">
                {deal.amount_history.map((ev) => (
                  <li key={ev.id} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <div>
                      <p className="text-sm text-slate-900">
                        {t("deals.amountChange", {
                          from: formatMoney(ev.old_cents, deal.currency),
                          to: formatMoney(ev.new_cents, deal.currency),
                        })}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t("history.by", { actor: ev.actor })} · {formatDateTime(ev.created_at, lang)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <Modal title={t("deals.editTitle")} onClose={() => setEditing(false)}>
          <DealFormModal deal={deal} onClose={() => setEditing(false)} />
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title={t("deals.deleteTitle")} onClose={() => setDeleting(false)}>
          <p className="mb-4 text-sm text-slate-600">
            {t("deals.deleteBodyDetail", { name: deal.title })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deal.id, { onSuccess: () => navigate("/deals", { replace: true }) })}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {remove.isPending ? t("common.deleting") : t("common.delete")}
            </button>
          </div>
        </Modal>
      ) : null}

      {update.isError ? (
        <p className="mt-3 text-sm text-red-600">
          {update.error instanceof Error ? update.error.message : t("deals.updateFailed")}
        </p>
      ) : null}
    </section>
  );
}
