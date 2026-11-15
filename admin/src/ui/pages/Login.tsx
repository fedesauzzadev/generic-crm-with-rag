import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LangToggle, useI18n } from "../../app/i18n";
import { useSession } from "../../app/session";
import { BrandMark, PRODUCT_NAME } from "../components/Brand";

// Login demo (H-03): un solo campo, sin contraseña, siempre entra. El nombre
// (o "Guest") queda en la cookie firmada y es el actor de trazas de S03.
export default function LoginPage() {
  const { login, status } = useSession();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(name); // vacío → "Guest"
      navigate("/", { replace: true });
    } catch {
      setError(t("login.serverError"));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <LangToggle className="absolute right-4 top-4 rounded-lg bg-white px-1.5 py-1 shadow" />
      <form onSubmit={onSubmit} className="w-80 rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-3">
          <BrandMark />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{PRODUCT_NAME}</h1>
            <p className="text-sm text-slate-500">{t("login.subtitle")}</p>
          </div>
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("login.namePlaceholder")}
          maxLength={60}
          autoFocus
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {t("login.enter")}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
