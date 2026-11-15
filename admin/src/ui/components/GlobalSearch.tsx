import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../app/i18n";
import { useSearch } from "../../app/crm";
import { useDebounced } from "../../app/useDebounced";
import { ensureGroups, mainLabel, subtitleFor, detailHref } from "../../domain/search";

// Búsqueda global (H-08 / S10, plan §12.4): barra sobre el <Outlet/> del
// Layout, visible desde cualquier sección. Panel absoluto bajo el input con
// los 3 grupos (≤5 items c/u); click navega al detalle y cierra; ESC o
// click-fuera cierran. JSX texto plano → React escapa (N20, 0 XSS).

const GROUP_LABEL_KEYS = { contacts: "nav.contacts", companies: "nav.companies", deals: "nav.deals" } as const;

export default function GlobalSearch() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q);
  const { data, isLoading, isError } = useSearch(debounced);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const trimmed = debounced.trim();
  const showPanel = open && q.trim().length > 0;
  const groups = ensureGroups(data?.groups);

  function go(entity: "contacts" | "companies" | "deals", id: string) {
    setQ("");
    setOpen(false);
    void navigate(detailHref(entity, id));
  }

  return (
    <div ref={boxRef} className="relative mb-4 max-w-xl">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
      />
      {showPanel ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {trimmed.length < 2 ? (
            <p className="px-3 py-2.5 text-sm text-slate-500">{t("search.hint")}</p>
          ) : isLoading ? (
            <p className="px-3 py-2.5 text-sm text-slate-500">{t("search.searching")}</p>
          ) : isError ? (
            <p className="px-3 py-2.5 text-sm text-rose-600">{t("common.error")}</p>
          ) : (data?.total ?? 0) === 0 ? (
            <p className="px-3 py-2.5 text-sm text-slate-500">{t("search.empty", { q: debounced })}</p>
          ) : (
            groups.map((group) => (
              <div key={group.entity} className="border-b border-slate-100 last:border-b-0">
                <p className="bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t(GROUP_LABEL_KEYS[group.entity])}
                </p>
                {group.items.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-slate-400">{t("search.groupEmpty")}</p>
                ) : (
                  group.items.map((item) => {
                    const subtitle = subtitleFor(group.entity, item, lang);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => go(group.entity, item.id)}
                        className="block w-full px-3 py-2 text-left transition hover:bg-sky-50"
                      >
                        <span className="block text-sm font-medium text-slate-900">
                          {mainLabel(group.entity, item)}
                        </span>
                        {subtitle ? <span className="block text-xs text-slate-500">{subtitle}</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
