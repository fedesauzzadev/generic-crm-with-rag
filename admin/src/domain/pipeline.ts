// Pipeline de deals — espejo de server/src/domain/pipeline.ts (domain-model
// §2: "misma tabla vive en admin y en el server"). La UI muestra SOLO las
// transiciones permitidas: refleja las guardas del back, no las inventa.

import type { Lang } from "./translations";

export const STAGES = ["nuevo", "calificado", "propuesta", "ganado", "perdido"] as const;
export type Stage = (typeof STAGES)[number];

// Los valores de DB son español (son datos); SOLO el display se traduce.
// Punto único de traducción de stages (review G2).
export const STAGE_LABELS_BY_LANG: Record<Lang, Record<Stage, string>> = {
  es: { nuevo: "Nuevo", calificado: "Calificado", propuesta: "Propuesta", ganado: "Ganado", perdido: "Perdido" },
  en: { nuevo: "New", calificado: "Qualified", propuesta: "Proposal", ganado: "Won", perdido: "Lost" },
};

export function stageLabel(stage: Stage, lang: Lang): string {
  return STAGE_LABELS_BY_LANG[lang][stage];
}

// Colores del badge por stage (tono semántico, paleta slate/emerald/rose).
export const STAGE_BADGE_CLASSES: Record<Stage, string> = {
  nuevo: "bg-slate-100 text-slate-700",
  calificado: "bg-sky-100 text-sky-700",
  propuesta: "bg-amber-100 text-amber-700",
  ganado: "bg-emerald-100 text-emerald-700",
  perdido: "bg-rose-100 text-rose-700",
};

export function isFinal(stage: Stage): boolean {
  return stage === "ganado" || stage === "perdido";
}

const TRANSITIONS: Record<Stage, readonly Stage[]> = {
  nuevo: ["calificado", "perdido"],
  calificado: ["nuevo", "propuesta", "perdido"],
  propuesta: ["calificado", "ganado", "perdido"],
  ganado: [],
  perdido: [],
};

export const CREATION_STAGES: readonly Stage[] = ["nuevo", "calificado", "propuesta", "perdido"];

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function allowedTargets(from: Stage): readonly Stage[] {
  return TRANSITIONS[from];
}

export function canTransition(from: Stage, to: Stage): boolean {
  return (TRANSITIONS[from] as readonly string[]).includes(to);
}
