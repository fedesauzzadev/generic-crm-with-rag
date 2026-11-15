import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LangToggle, useI18n } from "../../app/i18n";
import { useSession } from "../../app/session";
import { BrandMark, PRODUCT_NAME } from "./Brand";
import GlobalSearch from "./GlobalSearch";

// Shell del backoffice: sidebar genérico con las secciones del CRM + usuario
// activo de la sesión (cookie firmada, D-006) + toggle de idioma (G2).

// Primero el Dashboard: es la pantalla "wow" del portafolio — el visitante
// debe verla como primera opción, no después de Inicio (H-06).
const sections = [
  { to: "/dashboard", key: "nav.dashboard", end: false },
  { to: "/", key: "nav.home", end: true },
  { to: "/contacts", key: "nav.contacts", end: false },
  { to: "/companies", key: "nav.companies", end: false },
  { to: "/deals", key: "nav.deals", end: false },
  { to: "/activities", key: "nav.activities", end: false },
  { to: "/chat", key: "nav.chat", end: false },
];

export default function Layout() {
  const { session, logout } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="flex items-center gap-2.5 border-b border-slate-700 px-4 py-4">
          <BrandMark className="h-7 w-7" />
          <span className="text-base font-semibold">{PRODUCT_NAME}</span>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-3">
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${
                  isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"
                }`
              }
            >
              {t(section.key)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-700 px-4 py-3">
          <LangToggle className="mb-2" />
          <div className="flex items-center justify-between text-sm">
            <span className="truncate text-slate-300" title={session?.name}>
              {session?.name}
            </span>
            <button
              type="button"
              className="ml-2 shrink-0 text-slate-400 hover:text-white"
              onClick={() => {
                void logout();
                navigate("/login", { replace: true });
              }}
            >
              {t("nav.signOut")}
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 p-6">
        {/* Búsqueda global (H-08): visible desde cualquier sección. */}
        <GlobalSearch />
        <Outlet />
      </main>
    </div>
  );
}
