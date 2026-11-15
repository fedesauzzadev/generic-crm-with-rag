import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANG, translate, type Lang } from "../domain/translations";

// Idioma de la UI (review G2): default ES, persistencia en localStorage,
// sin detección de locale del SO. El toggle ES|EN vive en el sidebar y en
// el login (única pantalla fuera del Layout).

const LANG_KEY = "crm_lang";

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return stored === "en" ? "en" : "es";
  } catch {
    return DEFAULT_LANG; // localStorage inaccesible (modo privado, etc.)
  }
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // sin persistencia, solo dura la sesión — aceptable en demo
    }
    document.documentElement.lang = lang === "en" ? "en" : "es";
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const t = useCallback<TFn>((key, params) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

// Toggle ES|EN: los nombres de idioma son propios, no se traducen.
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`flex items-center gap-1 ${className}`} role="group" aria-label="Language / Idioma">
      {(["es", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          className={`rounded px-2 py-1 text-xs font-semibold uppercase transition ${
            lang === code ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {code === "es" ? "ES" : "EN"}
        </button>
      ))}
    </div>
  );
}
