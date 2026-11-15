import { useState } from "react";
import { useI18n } from "../../app/i18n";
import { useCompanies, useContacts, useDealMutations, useOwners, type Deal } from "../../app/crm";
import { CREATION_STAGES, stageLabel } from "../../domain/pipeline";

// Form de deal (create/edit). Stage NO se edita acá: nace con el deal y luego
// solo cambia por transición válida (I3) — en el detalle con traza.

interface FormState {
  title: string;
  company_id: string;
  contact_id: string;
  owner_id: string;
  amount: string; // decimal en la UI → centavos al server
  currency: string;
  stage: string; // solo al crear
  expected_close_at: string;
}

export default function DealFormModal({
  deal,
  onClose,
}: {
  deal: Deal | "new";
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const companies = useCompanies("", 1, 100);
  const contacts = useContacts("", 1, 100);
  const owners = useOwners();
  const { create, update } = useDealMutations();
  const isNew = deal === "new";

  const [form, setForm] = useState<FormState>({
    title: isNew ? "" : deal.title,
    company_id: isNew ? "" : deal.company_id,
    contact_id: isNew ? "" : (deal.contact_id ?? ""),
    owner_id: isNew ? "" : deal.owner_id,
    amount: isNew ? "" : (deal.amount_cents / 100).toFixed(2),
    currency: isNew ? "USD" : deal.currency,
    stage: "nuevo",
    expected_close_at: isNew ? "" : (deal.expected_close_at ?? ""),
  });
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const saving = create.isPending || update.isPending;

  function submit() {
    setFormError(null);
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setFormError(t("form.amountError"));
      return;
    }
    if (!form.company_id || !form.owner_id) {
      setFormError(t("form.requiredError")); // I1/I7: nunca llegan al server vacíos
      return;
    }

    const body: Record<string, unknown> = {
      title: form.title.trim(),
      company_id: form.company_id,
      owner_id: form.owner_id,
      amount_cents: cents,
      currency: form.currency.trim().toUpperCase() || "USD",
      contact_id: form.contact_id || undefined,
      expected_close_at: form.expected_close_at || undefined,
    };
    if (isNew) body.stage = form.stage;

    const mutation = isNew ? create.mutate : (b: Record<string, unknown>) => update.mutate({ id: (deal as Deal).id, body: b });
    mutation(body, {
      onSuccess: onClose,
      onError: (e) => setFormError(e instanceof Error ? e.message : t("form.couldNotSave")),
    });
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={labelCls}>{t("form.title")} *</span>
        <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>{t("col.company")} *</span>
          <select className={inputCls} value={form.company_id} onChange={(e) => set("company_id", e.target.value)}>
            <option value="">{t("form.select")}</option>
            {(companies.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>{t("col.owner")} *</span>
          <select className={inputCls} value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
            <option value="">{t("form.select")}</option>
            {(owners.data?.items ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>{t("col.contact")}</span>
        <select className={inputCls} value={form.contact_id} onChange={(e) => set("contact_id", e.target.value)}>
          <option value="">{t("form.noContact")}</option>
          {(contacts.data?.items ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.full_name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block">
            <span className={labelCls}>{t("deals.amount")} *</span>
            <input
              className={inputCls}
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>{t("form.currency")}</span>
          <input
            className={`${inputCls} uppercase`}
            maxLength={3}
            value={form.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isNew ? (
          <label className="block">
            <span className={labelCls}>{t("form.initialStage")}</span>
            <select className={inputCls} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
              {CREATION_STAGES.map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s, lang)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className={labelCls}>{t("deals.expectedClose")}</span>
          <input
            className={inputCls}
            type="date"
            value={form.expected_close_at}
            onChange={(e) => set("expected_close_at", e.target.value)}
          />
        </label>
      </div>

      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={saving || !form.title.trim()}
          onClick={submit}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
        >
          {saving ? t("common.saving") : t("form.saveDeal")}
        </button>
      </div>
    </div>
  );
}
