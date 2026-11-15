import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useI18n } from "../../app/i18n";
import { useCompanies, useCompanyMutations, type Company } from "../../app/crm";
import { useDebounced } from "../../app/useDebounced";
import { formatDate } from "../../domain/format";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";

const PAGE_SIZE = 20;

interface FormState {
  name: string;
  industry: string;
  website: string;
}

const EMPTY_FORM: FormState = { name: "", industry: "", website: "" };

export default function CompaniesPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const qd = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useCompanies(qd, page, PAGE_SIZE);
  const { create, update, remove } = useCompanyMutations();

  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);

  const saving = create.isPending || update.isPending;

  function submit() {
    setFormError(null);
    const body: Record<string, unknown> = { name: form.name.trim() };
    if (form.industry.trim()) body.industry = form.industry.trim();
    if (form.website.trim()) body.website = form.website.trim();

    const mutation =
      editing === "new" ? create.mutate : (b: Record<string, unknown>) => update.mutate({ id: editing!.id, body: b });
    mutation(body, {
      onSuccess: () => setEditing(null),
      onError: (e) => setFormError(e instanceof Error ? e.message : t("form.couldNotSave")),
    });
  }

  const columns = useMemo<ColumnDef<Company, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("col.name"),
        cell: (info) => <span className="text-sm font-medium text-slate-900">{info.getValue() as string}</span>,
      },
      {
        accessorKey: "industry",
        header: t("col.industry"),
        cell: (info) => <span className="text-sm text-slate-600">{(info.getValue() as string) ?? "—"}</span>,
      },
      {
        accessorKey: "website",
        header: t("col.website"),
        cell: (info) =>
          info.getValue() ? (
            <a href={info.getValue() as string} target="_blank" rel="noreferrer" className="text-sm text-sky-700 hover:underline">
              {(info.getValue() as string).replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: t("common.created"),
        cell: (info) => (
          <span className="whitespace-nowrap text-sm text-slate-500">{formatDate(info.getValue() as string, lang)}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setForm({
                  name: info.row.original.name,
                  industry: info.row.original.industry ?? "",
                  website: info.row.original.website ?? "",
                });
                setFormError(null);
                setEditing(info.row.original);
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
            >
              {t("common.edit")}
            </button>
            <button
              type="button"
              onClick={() => setDeleting(info.row.original)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
            >
              {t("common.delete")}
            </button>
          </div>
        ),
      },
    ],
    [t, lang]
  );

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t("companies.title")}</h1>
        <button
          type="button"
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setEditing("new");
          }}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800"
        >
          {t("companies.new")}
        </button>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder={t("companies.search")}
        className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
      />

      <DataTable
        data={data?.items ?? []}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage={t("companies.empty")}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data?.total}
      />

      {editing ? (
        <Modal title={editing === "new" ? t("companies.newTitle") : t("companies.editTitle")} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <label className="block">
              <span className={labelCls}>{t("col.name")} *</span>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>{t("col.industry")}</span>
                <input className={inputCls} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>{t("col.website")}</span>
                <input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </label>
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving || !form.name.trim()}
                onClick={submit}
                className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title={t("companies.deleteTitle")} onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-slate-600">{t("companies.deleteBody", { name: deleting.name })}</p>
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
