import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useI18n } from "../../app/i18n";
import { useActivities, useActivityMutations, useContacts, useDeals, type Activity } from "../../app/crm";
import { useDebounced } from "../../app/useDebounced";
import { formatDateTime } from "../../domain/format";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";

const PAGE_SIZE = 20;
const TYPES = ["call", "email", "meeting", "task"] as const;

interface FormState {
  type: (typeof TYPES)[number];
  subject: string;
  notes: string;
  contact_id: string;
  deal_id: string;
  due_at: string; // datetime-local
  done: boolean;
}

const EMPTY_FORM: FormState = { type: "call", subject: "", notes: "", contact_id: "", deal_id: "", due_at: "", done: false };

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ActivitiesPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const qd = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useActivities(qd, page, PAGE_SIZE);
  const contacts = useContacts("", 1, 100);
  const deals = useDeals("", 1, 100);
  const { create, update, remove } = useActivityMutations();

  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);

  const saving = create.isPending || update.isPending;

  function submit() {
    setFormError(null);
    if (!form.contact_id && !form.deal_id) {
      setFormError(t("activities.linkError")); // I6 en la UI
      return;
    }
    const body: Record<string, unknown> = {
      type: form.type,
      subject: form.subject.trim(),
      contact_id: form.contact_id || null,
      deal_id: form.deal_id || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      done_at: form.done ? new Date().toISOString() : null,
    };
    if (form.notes.trim()) body.notes = form.notes.trim();

    const mutation =
      editing === "new" ? create.mutate : (b: Record<string, unknown>) => update.mutate({ id: editing!.id, body: b });
    mutation(body, {
      onSuccess: () => setEditing(null),
      onError: (e) => setFormError(e instanceof Error ? e.message : t("form.couldNotSave")),
    });
  }

  const columns = useMemo<ColumnDef<Activity, unknown>[]>(
    () => [
      {
        accessorKey: "subject",
        header: t("col.activity"),
        cell: (info) => (
          <div>
            <p className="text-sm font-medium text-slate-900">{info.getValue() as string}</p>
            {info.row.original.notes ? (
              <p className="max-w-md truncate text-xs text-slate-500">{info.row.original.notes}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: t("col.type"),
        cell: (info) => (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {info.getValue() as string}
          </span>
        ),
      },
      {
        id: "linked",
        header: t("col.linkedTo"),
        cell: (info) => (
          <span className="text-sm text-slate-600">
            {info.row.original.contact_name ? `👤 ${info.row.original.contact_name}` : ""}
            {info.row.original.contact_name && info.row.original.deal_title ? " · " : ""}
            {info.row.original.deal_title ? `💼 ${info.row.original.deal_title}` : ""}
          </span>
        ),
      },
      {
        accessorKey: "due_at",
        header: t("col.due"),
        cell: (info) => (
          <span className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(info.getValue() as string | null, lang)}</span>
        ),
      },
      {
        accessorKey: "done_at",
        header: t("col.status"),
        cell: (info) =>
          info.getValue() ? (
            <span className="text-xs font-semibold text-emerald-700">{t("activities.done")}</span>
          ) : (
            <span className="text-xs font-semibold text-amber-600">{t("activities.pending")}</span>
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
                const a = info.row.original;
                setForm({
                  type: a.type,
                  subject: a.subject,
                  notes: a.notes ?? "",
                  contact_id: a.contact_id ?? "",
                  deal_id: a.deal_id ?? "",
                  due_at: toLocalInput(a.due_at),
                  done: Boolean(a.done_at),
                });
                setFormError(null);
                setEditing(a);
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
        <h1 className="text-xl font-bold text-slate-900">{t("activities.title")}</h1>
        <button
          type="button"
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setEditing("new");
          }}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-800"
        >
          {t("activities.new")}
        </button>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder={t("activities.search")}
        className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
      />

      <DataTable
        data={data?.items ?? []}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage={t("activities.empty")}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data?.total}
      />

      {editing ? (
        <Modal title={editing === "new" ? t("activities.newTitle") : t("activities.editTitle")} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>{t("col.type")} *</span>
                <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FormState["type"] })}>
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {ty}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>{t("form.dueAt")}</span>
                <input className={inputCls} type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>{t("form.subject")} *</span>
              <input className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelCls}>{t("form.notes")}</span>
              <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>{t("col.contact")}</span>
                <select className={inputCls} value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
                  <option value="">{t("form.none")}</option>
                  {(contacts.data?.items ?? []).map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>{t("col.deal")}</span>
                <select className={inputCls} value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })}>
                  <option value="">{t("form.none")}</option>
                  {(deals.data?.items ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.done} onChange={(e) => setForm({ ...form, done: e.target.checked })} />
              <span className="text-sm text-slate-700">{t("form.markDone")}</span>
            </label>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving || !form.subject.trim()}
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
        <Modal title={t("activities.deleteTitle")} onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-slate-600">{t("activities.deleteBody", { name: deleting.subject })}</p>
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
