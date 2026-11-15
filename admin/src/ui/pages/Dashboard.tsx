import { useI18n } from "../../app/i18n";
import { useMetrics, type Metrics } from "../../app/crm";
import type { Stage } from "../../domain/pipeline";
import { barPercent, formatDate, formatMoney, winRateLabel } from "../../domain/format";
import { StageBadge } from "../components/StageBadge";

// Dashboard (H-06 / S07): KPIs fijos sobre /api/metrics (§12.2.1). Gráficos
// = divs CSS propio, CERO deps nuevas (valor del proyecto). Toda cifra es
// derivable de Deals/Activities (AC7) — el server agrega, la UI solo formatea.

// Barra sólida por stage (los badges del pipeline son claros; acá hace falta
// relleno). Mismo tono semántico que STAGE_BADGE_CLASSES.
const STAGE_BAR_CLASSES: Record<Stage, string> = {
  nuevo: "bg-slate-400",
  calificado: "bg-sky-500",
  propuesta: "bg-amber-500",
  ganado: "bg-emerald-500",
  perdido: "bg-rose-500",
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function BarRow({
  label,
  right,
  percent,
  barClass,
}: {
  label: React.ReactNode;
  right: string;
  percent: number;
  barClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="whitespace-nowrap text-slate-600">{right}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {/* Barra CSS propia: ancho % = valor / máximo del bloque. */}
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-slate-400">{note}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const metrics = useMetrics();

  if (metrics.isPending) {
    return <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (metrics.isError) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        {metrics.error instanceof Error ? metrics.error.message : t("dashboard.error")}
      </p>
    );
  }

  const m: Metrics = metrics.data;
  // Deals abiertos = totales − cerrados (ganado/perdido son terminales).
  const openDeals = m.pipeline.total_count - m.win_rate.won - m.win_rate.lost;
  const activitiesTotal = m.activities.by_type.reduce((acc, x) => acc + x.count, 0);
  const maxStage = Math.max(...m.pipeline.stages.map((s) => s.total_cents));
  const maxType = Math.max(...m.activities.by_type.map((x) => x.count));
  const maxCompany = Math.max(0, ...m.top_companies.map((x) => x.open_cents));
  // Mismo criterio de moneda que la vista pipeline de Deals (residual §12.7).
  const money = (cents: number) => formatMoney(cents, "USD");

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">{t("dashboard.title")}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("dashboard.kpiPipeline")} value={money(m.pipeline.total_cents)} sub={t("dashboard.dealCount", { count: m.pipeline.total_count })} />
        <Kpi
          label={t("dashboard.kpiWinRate")}
          value={winRateLabel(m.win_rate.rate)}
          sub={t("dashboard.winRateSub", { won: m.win_rate.won, lost: m.win_rate.lost })}
        />
        <Kpi label={t("dashboard.kpiOpenDeals")} value={String(openDeals)} />
        <Kpi label={t("dashboard.kpiActivities", { weeks: m.activities.window_weeks })} value={String(activitiesTotal)} />
      </div>

      <Card title={t("dashboard.valueByStage")}>
        {m.pipeline.stages.map((s) => (
          <BarRow
            key={s.stage}
            label={<StageBadge stage={s.stage} />}
            right={`${t("dashboard.dealCount", { count: s.count })} · ${money(s.total_cents)}`}
            percent={barPercent(s.total_cents, maxStage)}
            barClass={STAGE_BAR_CLASSES[s.stage]}
          />
        ))}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={t("dashboard.activitiesByType")}
          note={t("dashboard.activitiesWindow", {
            weeks: m.activities.window_weeks,
            from: formatDate(m.activities.from, lang),
          })}
        >
          {m.activities.by_type.map((x) => (
            <BarRow
              key={x.type}
              label={x.type}
              right={String(x.count)}
              percent={barPercent(x.count, maxType)}
              barClass="bg-sky-600"
            />
          ))}
        </Card>

        <Card title={t("dashboard.topCompanies")}>
          {m.top_companies.length === 0 ? (
            <p className="text-sm text-slate-500">{t("dashboard.emptyCompanies")}</p>
          ) : (
            m.top_companies.map((c) => (
              <BarRow
                key={c.company_id}
                label={c.name}
                right={`${t("dashboard.openCount", { count: c.open_count })} · ${money(c.open_cents)}`}
                percent={barPercent(c.open_cents, maxCompany)}
                barClass="bg-emerald-600"
              />
            ))
          )}
        </Card>
      </div>
    </section>
  );
}
