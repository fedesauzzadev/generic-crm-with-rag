import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../app/i18n";
import { useContactDetail } from "../../app/crm";
import { formatDate, formatDateTime, formatMoney } from "../../domain/format";
import { StageBadge } from "../components/StageBadge";

// Detalle mínimo de contacto (S10 / H-08): destino de navegación desde la
// búsqueda global — datos read-only + sus deals. Sin historiales ni edición
// (eso vive en el listado, corte del slice).

export default function ContactDetailPage() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const { data, isLoading, isError, error } = useContactDetail(id);

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
        <p>{error instanceof Error ? error.message : t("contacts.detailLoadError")}</p>
        <Link to="/contacts" className="mt-2 inline-block font-medium underline">
          {t("contacts.backShort")}
        </Link>
      </div>
    );
  }

  const contact = data.contact;

  return (
    <section>
      <div className="mb-4">
        <Link to="/contacts" className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline">
          {t("contacts.backShort")}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{contact.full_name}</h1>
        <p className="text-sm text-slate-500">
          {[contact.title, contact.company_name].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("deals.details")}</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("col.email")}</dt>
              <dd className="text-slate-900">{contact.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("col.phone")}</dt>
              <dd className="text-slate-900">{contact.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("form.jobTitle")}</dt>
              <dd className="text-slate-900">{contact.title ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("col.company")}</dt>
              <dd className="text-slate-900">{contact.company_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t("common.created")}</dt>
              <dd className="text-slate-900">{formatDateTime(contact.created_at, lang)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("deals.title")}</h2>
          {contact.deals.length === 0 ? (
            <p className="text-sm text-slate-500">{t("detail.noDeals")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {contact.deals.map((deal) => (
                <li key={deal.id}>
                  <Link to={`/deals/${deal.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-sky-50">
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{deal.title}</span>
                      <span className="block text-xs text-slate-500">
                        {deal.company_name} · {formatDate(deal.expected_close_at, lang)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {formatMoney(deal.amount_cents, deal.currency)}
                      </span>
                      <StageBadge stage={deal.stage} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
