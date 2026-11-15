// Formateo de UI: dinero NUNCA float — llega en centavos y se formatea acá
// (domain-model: "Formateo a moneda solo en UI"). Fechas localizadas ES/EN
// (review G2); dinero en formato en-US (convención de moneda, no idioma).

import type { Lang } from "./translations";

const DATE_LOCALE: Record<Lang, string> = { es: "es", en: "en-US" };

export function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
  } catch {
    // Código de moneda no soportado por Intl: mostrar crudo pero explícito.
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }
}

export function formatDate(iso: string | null | undefined, lang: Lang = "es"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(DATE_LOCALE[lang], { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined, lang: Lang = "es"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(DATE_LOCALE[lang], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Dashboard (H-06): KPIs puros para testear — win rate null = "—" (nunca
// NaN, AC3) y ancho de barras % contra el máximo del bloque.
export function winRateLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 100);
}
