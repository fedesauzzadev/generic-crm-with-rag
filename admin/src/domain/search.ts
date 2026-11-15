// Búsqueda global (H-08 / S10): helpers puros de presentación de resultados.
// El server ya devuelve los grupos; acá solo normalizamos (los 3 grupos
// SIEMPRE presentes, orden fijo) y derivamos label/subtítulo por entidad.

import type { Lang } from "./translations";
import { stageLabel, type Stage } from "./pipeline";

export type SearchEntity = "contacts" | "companies" | "deals";

export interface SearchItem {
  id: string;
  score: number;
  full_name?: string;
  title?: string | null;
  email?: string | null;
  company_name?: string | null;
  name?: string;
  industry?: string | null;
  stage?: Stage;
  amount_cents?: number;
  currency?: string;
}

export interface SearchGroup {
  entity: SearchEntity;
  items: SearchItem[];
}

export const SEARCH_ENTITIES: readonly SearchEntity[] = ["contacts", "companies", "deals"];

/** Normaliza la respuesta: 3 grupos en orden fijo, items [] si falta alguno. */
export function ensureGroups(groups: SearchGroup[] | undefined): SearchGroup[] {
  const byEntity = new Map((groups ?? []).map((g) => [g.entity, g]));
  return SEARCH_ENTITIES.map((entity) => ({ entity, items: byEntity.get(entity)?.items ?? [] }));
}

/** Título principal del item (label clickeable). */
export function mainLabel(entity: SearchEntity, item: SearchItem): string {
  if (entity === "contacts") return item.full_name ?? item.id;
  if (entity === "companies") return item.name ?? item.id;
  return item.title ?? item.id;
}

/** Subtítulo: contacts → puesto · empresa · email (lo que haya) · companies → industria · deals → empresa · etapa. */
export function subtitleFor(entity: SearchEntity, item: SearchItem, lang: Lang): string {
  const join = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");
  if (entity === "contacts") return join([item.title, item.company_name, item.email]);
  if (entity === "companies") return item.industry ?? "";
  return join([item.company_name, item.stage ? stageLabel(item.stage, lang) : null]);
}

/** Ruta de detalle por entidad (AC3: el resultado navega al detalle). */
export function detailHref(entity: SearchEntity, id: string): string {
  return `/${entity}/${id}`;
}
