import { Link } from "react-router-dom";
import { useI18n } from "../../app/i18n";
import { usePing } from "../../app/ping";

// Home del shell: confirma que la SPA habla con el server local via /api/ping
// y da acceso visible al dashboard (AC1 de H-06).
export default function HomePage() {
  const { t } = useI18n();
  const ping = usePing();

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("home.title")}</h1>
      <div className="max-w-md space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {ping.isPending && <p className="text-sm text-slate-500">{t("home.checking")}</p>}
          {ping.isError && <p className="text-sm text-red-600">{t("home.unreachable")}</p>}
          {ping.data && (
            <p className="text-sm text-slate-700">
              <span className="font-medium text-emerald-600">{t("home.online")}</span> — {ping.data.service}{" "}
              {t("home.respondedAt", { time: ping.data.time })}
            </p>
          )}
        </div>
        <Link
          to="/dashboard"
          className="block rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-800 shadow-sm transition hover:border-sky-400 hover:bg-sky-100"
        >
          {t("home.dashboardLink")}
        </Link>
      </div>
    </div>
  );
}
