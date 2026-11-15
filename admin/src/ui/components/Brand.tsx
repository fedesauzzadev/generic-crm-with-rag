// Token único de branding (plan S02): marca + nombre del producto en un solo
// lugar. Placeholder genérico — nada heredado de otro producto (AC H-03, N11).

export const PRODUCT_NAME = "Generic CRM";

export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-slate-900" />
      <circle cx="10" cy="22" r="3" className="fill-sky-400" />
      <circle cx="16" cy="14" r="3" className="fill-sky-300" />
      <circle cx="22" cy="7" r="3" className="fill-emerald-400" />
    </svg>
  );
}
