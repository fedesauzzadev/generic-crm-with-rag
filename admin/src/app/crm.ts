import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Stage } from "../domain/pipeline";

// Server state: fetch a /api/* (mismo origen via proxy de Vite) + React Query.
// Patrón: repo plano por entidad + hooks delgados que invalidan la cache.

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & T;
  if (!res.ok || data.ok === false) {
    throw new Error(data.message ?? `Request failed with status ${res.status}`);
  }
  return data;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// ---- Tipos (espejo de las filas del server) --------------------------------

export interface Contact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface StageEvent {
  id: string;
  deal_id: string;
  from_stage: Stage | null;
  to_stage: Stage;
  actor: string;
  created_at: string;
}

// H-09: evento de la traza de monto (moneda no viaja: la UI rotula con la
// actual del deal — residual documentado plan §12.3).
export interface AmountEvent {
  id: string;
  deal_id: string;
  old_cents: number;
  new_cents: number;
  actor: string;
  created_at: string;
}

export interface Deal {
  id: string;
  title: string;
  company_id: string;
  contact_id: string | null;
  owner_id: string;
  amount_cents: number;
  currency: string;
  stage: Stage;
  expected_close_at: string | null;
  created_at: string;
  updated_at: string;
  company_name?: string;
  contact_name?: string | null;
  owner_name?: string;
}

export interface DealDetail extends Deal {
  stage_events: StageEvent[];
  amount_history: AmountEvent[];
}

export interface Activity {
  id: string;
  type: "call" | "email" | "meeting" | "task";
  subject: string;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  contact_id: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
  deal_title?: string | null;
}

interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Búsqueda global (H-08 / S10): grupos siempre presentes, top 5 por grupo.
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

export interface SearchResults {
  q: string;
  total: number;
  groups: { entity: "contacts" | "companies" | "deals"; items: SearchItem[] }[];
}

// Detalles extendidos (S10): deal resumido embebido en contact/company.
export interface DealSummary {
  id: string;
  title: string;
  stage: Stage;
  amount_cents: number;
  currency: string;
  expected_close_at: string | null;
  company_name: string;
  owner_name: string;
}

export interface ContactDetail extends Contact {
  company_name: string | null;
  deals: DealSummary[];
}

export interface CompanyContact {
  id: string;
  full_name: string;
  title: string | null;
  email: string | null;
}

export interface CompanyDetail {
  company: Company;
  contacts: CompanyContact[];
  deals: DealSummary[];
}

// GET /api/metrics (§12.2.1): KPIs del dashboard — vista sobre deals/activities.
export interface Metrics {
  pipeline: {
    stages: { stage: Stage; count: number; total_cents: number }[];
    total_cents: number;
    total_count: number;
  };
  win_rate: { won: number; lost: number; rate: number | null };
  activities: {
    window_weeks: number;
    from: string;
    by_type: { type: Activity["type"]; count: number }[];
  };
  top_companies: {
    company_id: string;
    name: string;
    open_count: number;
    open_cents: number;
  }[];
}

function listParams(query: string, page: number, pageSize: number): string {
  return `?query=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`;
}

// ---- Repos ------------------------------------------------------------------

export const crmRepo = {
  listContacts: (q: string, page: number, pageSize = 20) =>
    api<ListResult<Contact>>(`/api/contacts${listParams(q, page, pageSize)}`),
  getContact: (id: string) => api<{ contact: ContactDetail }>(`/api/contacts/${id}`),
  createContact: (body: Record<string, unknown>) =>
    api<{ contact: Contact }>("/api/contacts", jsonInit("POST", body)),
  updateContact: (id: string, body: Record<string, unknown>) =>
    api<{ contact: Contact }>(`/api/contacts/${id}`, jsonInit("PATCH", body)),
  deleteContact: (id: string) => api<{ ok: true }>(`/api/contacts/${id}`, { method: "DELETE" }),

  listCompanies: (q: string, page: number, pageSize = 20) =>
    api<ListResult<Company>>(`/api/companies${listParams(q, page, pageSize)}`),
  getCompany: (id: string) => api<CompanyDetail>(`/api/companies/${id}`),
  createCompany: (body: Record<string, unknown>) =>
    api<{ company: Company }>("/api/companies", jsonInit("POST", body)),
  updateCompany: (id: string, body: Record<string, unknown>) =>
    api<{ company: Company }>(`/api/companies/${id}`, jsonInit("PATCH", body)),
  deleteCompany: (id: string) => api<{ ok: true }>(`/api/companies/${id}`, { method: "DELETE" }),

  listDeals: (q: string, page: number, pageSize = 20) =>
    api<ListResult<Deal>>(`/api/deals${listParams(q, page, pageSize)}`),
  getDeal: (id: string) => api<{ deal: DealDetail }>(`/api/deals/${id}`),
  createDeal: (body: Record<string, unknown>) => api<{ deal: DealDetail }>("/api/deals", jsonInit("POST", body)),
  updateDeal: (id: string, body: Record<string, unknown>) =>
    api<{ deal: DealDetail }>(`/api/deals/${id}`, jsonInit("PATCH", body)),
  deleteDeal: (id: string) => api<{ ok: true }>(`/api/deals/${id}`, { method: "DELETE" }),
  changeStage: (id: string, to_stage: string) =>
    api<{ deal: DealDetail }>(`/api/deals/${id}/stage`, jsonInit("PATCH", { to_stage })),
  pipeline: () =>
    api<{ stages: { stage: Stage; count: number; total_cents: number }[]; total_cents: number; total_count: number }>(
      "/api/deals/pipeline"
    ),
  metrics: () => api<Metrics>("/api/metrics"),
  search: (q: string) => api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),

  listActivities: (q: string, page: number, pageSize = 20) =>
    api<ListResult<Activity>>(`/api/activities${listParams(q, page, pageSize)}`),
  createActivity: (body: Record<string, unknown>) =>
    api<{ activity: Activity }>("/api/activities", jsonInit("POST", body)),
  updateActivity: (id: string, body: Record<string, unknown>) =>
    api<{ activity: Activity }>(`/api/activities/${id}`, jsonInit("PATCH", body)),
  deleteActivity: (id: string) => api<{ ok: true }>(`/api/activities/${id}`, { method: "DELETE" }),

  listOwners: () => api<{ items: Owner[] }>("/api/users"),
};

// ---- Hooks ------------------------------------------------------------------
// Regla: toda mutación invalida las listas de su entidad (y las vistas
// derivadas: pipeline al tocar deals).

function useInvalidatingMutation<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  keys: readonly (readonly string[])[]
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export const dealKeys = {
  all: ["deals"] as const,
  pipeline: ["deals", "pipeline"] as const,
  detail: (id: string) => ["deals", "detail", id] as const,
};

// Métricas derivadas de deals/activities/companies: toda mutación de esas
// entidades las invalida para que el dashboard nunca contradiga las vistas.
const metricsKey = ["metrics"] as const;

export function useContacts(q: string, page: number, pageSize = 20) {
  return useQuery({
    queryKey: ["contacts", q, page, pageSize],
    queryFn: () => crmRepo.listContacts(q, page, pageSize),
  });
}
export function useContactMutations() {
  return {
    create: useInvalidatingMutation((b: Record<string, unknown>) => crmRepo.createContact(b), [["contacts"]]),
    update: useInvalidatingMutation(
      (v: { id: string; body: Record<string, unknown> }) => crmRepo.updateContact(v.id, v.body),
      [["contacts"]]
    ),
    remove: useInvalidatingMutation((id: string) => crmRepo.deleteContact(id), [["contacts"], ["deals"]]),
  };
}

export function useCompanies(q: string, page: number, pageSize = 20) {
  return useQuery({
    queryKey: ["companies", q, page, pageSize],
    queryFn: () => crmRepo.listCompanies(q, page, pageSize),
  });
}
export function useCompanyMutations() {
  return {
    create: useInvalidatingMutation((b: Record<string, unknown>) => crmRepo.createCompany(b), [["companies"], metricsKey]),
    update: useInvalidatingMutation(
      (v: { id: string; body: Record<string, unknown> }) => crmRepo.updateCompany(v.id, v.body),
      [["companies"], metricsKey]
    ),
    remove: useInvalidatingMutation((id: string) => crmRepo.deleteCompany(id), [["companies"], ["contacts"], ["deals"], metricsKey]),
  };
}

export function useOwners() {
  return useQuery({ queryKey: ["users"], queryFn: crmRepo.listOwners, staleTime: 5 * 60_000 });
}

export function useDeals(q: string, page: number, pageSize = 20) {
  return useQuery({
    queryKey: ["deals", "list", q, page, pageSize],
    queryFn: () => crmRepo.listDeals(q, page, pageSize),
  });
}
export function useDeal(id: string) {
  return useQuery({ queryKey: dealKeys.detail(id), queryFn: () => crmRepo.getDeal(id) });
}
export function usePipeline() {
  return useQuery({ queryKey: dealKeys.pipeline, queryFn: crmRepo.pipeline });
}
export function useMetrics() {
  return useQuery({ queryKey: ["metrics"], queryFn: crmRepo.metrics });
}

// Búsqueda global (H-08): solo dispara con ≥2 chars (el server valida 2..100).
export function useSearch(q: string) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => crmRepo.search(q),
    enabled: q.trim().length >= 2,
  });
}

export function useContactDetail(id: string) {
  return useQuery({ queryKey: ["contacts", "detail", id], queryFn: () => crmRepo.getContact(id) });
}

export function useCompanyDetail(id: string) {
  return useQuery({ queryKey: ["companies", "detail", id], queryFn: () => crmRepo.getCompany(id) });
}
export function useDealMutations() {
  return {
    create: useInvalidatingMutation((b: Record<string, unknown>) => crmRepo.createDeal(b), [dealKeys.all, metricsKey]),
    update: useInvalidatingMutation(
      (v: { id: string; body: Record<string, unknown> }) => crmRepo.updateDeal(v.id, v.body),
      [dealKeys.all, metricsKey]
    ),
    remove: useInvalidatingMutation((id: string) => crmRepo.deleteDeal(id), [dealKeys.all, metricsKey]),
    changeStage: useInvalidatingMutation(
      (v: { id: string; to: string }) => crmRepo.changeStage(v.id, v.to),
      [dealKeys.all, metricsKey]
    ),
  };
}

export function useActivities(q: string, page: number, pageSize = 20) {
  return useQuery({
    queryKey: ["activities", q, page, pageSize],
    queryFn: () => crmRepo.listActivities(q, page, pageSize),
  });
}
export function useActivityMutations() {
  return {
    create: useInvalidatingMutation((b: Record<string, unknown>) => crmRepo.createActivity(b), [["activities"], metricsKey]),
    update: useInvalidatingMutation(
      (v: { id: string; body: Record<string, unknown> }) => crmRepo.updateActivity(v.id, v.body),
      [["activities"], metricsKey]
    ),
    remove: useInvalidatingMutation((id: string) => crmRepo.deleteActivity(id), [["activities"], metricsKey]),
  };
}
