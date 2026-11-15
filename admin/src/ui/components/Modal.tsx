import type { ReactNode } from "react";
import { useI18n } from "../../app/i18n";

// Modal mínimo: overlay + caja. Cierra con Escape o clic afuera (los forms
// editables van adentro; la historia de stages es read-only y nunca acá).

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: ModalProps) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
