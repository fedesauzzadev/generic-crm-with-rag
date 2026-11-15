// Pipeline de deals (domain-model §2): stages, tabla de transiciones y
// guardas. Fuente de verdad del server — la UI refleja esta tabla, no la
// inventa. Misma tabla vive espejada en admin/src/domain/pipeline.ts.

export const STAGES = ["nuevo", "calificado", "propuesta", "ganado", "perdido"] as const;
export type Stage = (typeof STAGES)[number];

// Stages terminales: sin salidas (reabrir deals = V2+).
export function isFinal(stage: Stage): boolean {
  return stage === "ganado" || stage === "perdido";
}

// Tabla de transiciones (domain-model §2): sin saltos hacia adelante, 1 paso
// atrás solo entre etapas abiertas, perdible desde cualquier etapa abierta,
// ganado solo desde propuesta.
const TRANSITIONS: Record<Stage, readonly Stage[]> = {
  nuevo: ["calificado", "perdido"],
  calificado: ["nuevo", "propuesta", "perdido"],
  propuesta: ["calificado", "ganado", "perdido"],
  ganado: [],
  perdido: [],
};

// Stages permitidos al CREAR un deal (fila "(creación)" de la tabla §2):
// no se puede nacer ganado.
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

/** Mensaje legible del rechazo (422) — igual estilo que el domain-model. */
export function transitionError(from: Stage, to: Stage): string {
  if (isFinal(from)) {
    return `Cannot move deal from \`${from}\`; it is a final stage`;
  }
  return `Cannot move deal from \`${from}\` to \`${to}\``;
}
