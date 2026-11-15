import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useI18n } from "../../app/i18n";
import { useCompanies, useContactMutations, useContacts, type Contact } from "../../app/crm";
import { useDebounced } from "../../app/useDebounced";
import { formatDate } from "../../domain/format";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";

const PAGE_SIZE = 20;

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string;
}

const EMPTY_FORM: FormState = { full_name: "", email: "", phone: "", title: "", company_id: "" };

export default function ContactsPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const qd = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useContacts(qd, page, PAGE_SIZE);
  const companies = useCompanies("", 1, 100);
  const { create, update, remove } = useContactMutations();

  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  function openNew() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing("new");
  }
  function openEdit(contact: Contact) {
    setForm({
      full_name: contact.full_name,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      title: contact.title ?? "",
      company_id: contact.company_id ?? "",
    });
    setFormError(null);
    setEditing(contact);
  }

  const saving = create.isPending || update.isPending;

  function submit() {
    setFormError(null);
    const body: Record<string, unknown> = { full_name: form.full_name.trim() };
    if (form.email.trim()) body.email = form.email.trim();
    if (form.phone.trim()) body.phone = form.phone.trim();
    if (form.title.trim()) body.title = form.title.trim();
    body.company_id = form.company_id || null;

    const mutation =
      editing === "new" ? create.mutate : (b: Record<string, unknown>) => update.mutate({ id: editing!.id, body: b });
    mutation(body, {
      onSuccess: () => setEditing(null),
      onError: (e) => setFormError(e instanceof Error ? e.message : t("form.couldNotSave")),
    });
  }

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: t("col.name"),
        cell: (info) => (
          <div>
            <p className="text-sm font-medium text-slate-900">{info.getValue() as string}</p>
            {info.row.original.title ? (
              <p className="text-xs text-slate-500">{info.row.original.title}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: t("col.email"),
        cell: (info) => <span className="text-sm text-slate-600">{(info.getValue() as string) ?? "—"}</span>,
      },
      {
        id: "company",
        header: t("col.company"),
        cell: (info) => {
          const company = companies.data?.items.find((c) => c.id === info.row.original.company_id);
          return <span className="text-sm text-slate-600">{company?.name ?? "—"}</span>;
        },
      },
      {
        accessorKey: "phone",
        header: t("col.phone"),
        cell: (info) => <span className="text-sm text-slate-600">{(info.getValue() as string) ?? "—"}</span>,
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
              onClick={() => openEdit(info.row.original)}
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
    [companies.data, t, lang]
  );

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t("contacts.title")}</h1>
        <button
          type="button"
          onClick={openNew}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800"
        >
          {t("contacts.new")}
        </button>
      </div>

      {/* Export CSV (H-07): <a> directo — GET same-origin lleva la cookie y
          Content-Disposition dispara la descarga; sin fetch/blobs ni state. */}
      <div className="mb-3 flex max-w-sm items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t("contacts.search")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
        />
        <a
          href="/api/export/contacts"
          download
          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
        >
          {t("export.csv")}
        </a>
      </div>

      <DataTable
        data={data?.items ?? []}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage={t("contacts.empty")}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data?.total}
      />

      {editing ? (
        <Modal title={editing === "new" ? t("contacts.newTitle") : t("contacts.editTitle")} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <label className="block">
              <span className={labelCls}>{t("form.fullName")} *</span>
              <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelCls}>{t("col.email")}</span>
              <input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>{t("col.phone")}</span>
                <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>{t("form.jobTitle")}</span>
                <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>{t("col.company")}</span>
              <select className={inputCls} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
                <option value="">{t("form.noCompany")}</option>
                {(companies.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving || !form.full_name.trim()}
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
        <Modal title={t("contacts.deleteTitle")} onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-slate-600">{t("contacts.deleteBody", { name: deleting.full_name })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(deleting.id, {
                  onSuccess: () => setDeleting(null),
                })
              }
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
