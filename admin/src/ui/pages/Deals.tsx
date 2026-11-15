import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../app/i18n";
import { useDealMutations, useDeals, usePipeline, type Deal } from "../../app/crm";
import { useDebounced } from "../../app/useDebounced";
import { STAGES } from "../../domain/pipeline";
import { formatMoney } from "../../domain/format";
import DealFormModal from "../components/DealFormModal";
import Modal from "../components/Modal";
import { StageBadge } from "../components/StageBadge";

// Vista de deals = pipeline agrupado por stage (AC H-02): las sumas por stage
// y el total salen de /api/deals/pipeline (mismo dataset → suma = total, I8);
// las filas del listado se agrupan client-side para mostrarlas bajo cada stage.

const BOARD_PAGE_SIZE = 100; // el board muestra el pipeline completo, no pagina

export default function DealsPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const qd = useDebounced(q);
  const deals = useDeals(qd, 1, BOARD_PAGE_SIZE);
  const pipeline = usePipeline();
  const { remove } = useDealMutations();

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Deal | null>(null);

  const byStage = new Map<string, Deal[]>();
  for (const deal of deals.data?.items ?? []) {
    const list = byStage.get(deal.stage) ?? [];
    list.push(deal);
    byStage.set(deal.stage, list);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t("deals.title")}</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800"
        >
          {t("deals.new")}
        </button>
      </div>

      {/* Export CSV (H-07): <a> directo — GET same-origin lleva la cookie y
          Content-Disposition dispara la descarga; sin fetch/blobs ni state. */}
      <div className="mb-3 flex max-w-sm items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("deals.search")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
        />
        <a
          href="/api/export/deals"
          download
          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
        >
          {t("export.csv")}
        </a>
      </div>

      {pipeline.isError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {pipeline.error instanceof Error ? pipeline.error.message : t("deals.pipelineError")}
        </p>
      ) : null}

      {pipeline.data ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {pipeline.data.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-1 flex items-center justify-between">
                <StageBadge stage={s.stage} />
                <span className="text-xs text-slate-400">{s.count}</span>
              </div>
              <p className="text-sm font-semibold text-slate-900">{formatMoney(s.total_cents, "USD")}</p>
            </div>
          ))}
          <div className="rounded-lg border border-slate-300 bg-slate-900 p-3 text-white">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">{t("deals.total")}</span>
              <span className="text-xs text-slate-400">{pipeline.data.total_count}</span>
            </div>
            <p className="text-sm font-semibold">{formatMoney(pipeline.data.total_cents, "USD")}</p>
          </div>
        </div>
      ) : null}

      {deals.isLoading ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : deals.isError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
          {deals.error instanceof Error ? deals.error.message : t("deals.loadError")}
        </p>
      ) : (deals.data?.items ?? []).length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("deals.empty")}
        </p>
      ) : (
        <div className="space-y-5">
          {STAGES.filter((s) => (byStage.get(s)?.length ?? 0) > 0).map((stage) => (
            <div key={stage}>
              <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-1">
                <StageBadge stage={stage} />
                <span className="text-xs text-slate-500">
                  {t("deals.count", { count: byStage.get(stage)!.length })} ·{" "}
                  {formatMoney(
                    pipeline.data?.stages.find((s) => s.stage === stage)?.total_cents ?? 0,
                    "USD"
                  )}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {byStage.get(stage)!.map((deal, i) => (
                  <div
                    key={deal.id}
                    className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
                      i > 0 ? "border-t border-slate-100" : ""
                    } hover:bg-slate-50`}
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/deals/${deal.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-sky-700 hover:underline"
                      >
                        {deal.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {deal.company_name} · {deal.owner_name}
                        {deal.contact_name ? ` · ${deal.contact_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="whitespace-nowrap text-sm font-semibold text-slate-900">
                        {formatMoney(deal.amount_cents, deal.currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDeleting(deal)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
                      >
                        {t("common.delete")}
                      </button>
                      <Link
                        to={`/deals/${deal.id}`}
                        className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-slate-700"
                      >
                        {t("deals.open")}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <Modal title={t("deals.newTitle")} onClose={() => setCreating(false)}>
          <DealFormModal deal="new" onClose={() => setCreating(false)} />
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title={t("deals.deleteTitle")} onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-slate-600">
            {t("deals.deleteBody", { name: deleting.title })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {remove.isPending ? t("common.deleting") : t("common.delete")}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
