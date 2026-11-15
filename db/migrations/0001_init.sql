-- 0001_init.sql — esquema inicial del CRM (S01).
-- Modelo autoritativo: factory/domain-model.md (si difiere, gana ese documento).
-- Estilo: una migración grande por hito, secciones comentadas, CHECKs en la DB
-- (no solo en zod) y soft delete vía deleted_at.

-- Empresas (cuentas).
create table if not exists companies (
  id text primary key,
  name text not null,
  industry text,
  website text,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);
-- Nombre único solo entre empresas no borradas (compatible con soft delete).
create unique index if not exists companies_name_active_idx
  on companies (name) where deleted_at is null;

-- Usuarios demo: owners de deals. La columna role es dato de realismo del seed,
-- NO autoriza nada (D-006: sin RBAC).
create table if not exists users (
  id text primary key,
  name text not null,
  email text not null,
  role text not null default 'owner',
  created_at text not null,
  updated_at text not null
);

-- Contactos (personas).
create table if not exists contacts (
  id text primary key,
  full_name text not null,
  email text,
  phone text,
  title text,
  company_id text references companies (id),
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

-- Deals: montos en centavos (nunca float), moneda explícita, stage del pipeline.
create table if not exists deals (
  id text primary key,
  title text not null,
  company_id text not null references companies (id),
  contact_id text references contacts (id),
  owner_id text not null references users (id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD',
  stage text not null default 'nuevo'
    check (stage in ('nuevo', 'calificado', 'propuesta', 'ganado', 'perdido')),
  expected_close_at text,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

-- Traza inmutable de cambios de stage (append-only; no existe endpoint de edición).
create table if not exists stage_events (
  id text primary key,
  deal_id text not null references deals (id),
  from_stage text, -- null = creación del deal
  to_stage text not null
    check (to_stage in ('nuevo', 'calificado', 'propuesta', 'ganado', 'perdido')),
  actor text not null,
  created_at text not null
);

-- Actividades: siempre vinculadas a un contacto o un deal (invariante I6).
create table if not exists activities (
  id text primary key,
  type text not null check (type in ('call', 'email', 'meeting', 'task')),
  subject text not null,
  notes text,
  due_at text,
  done_at text, -- null = pendiente
  contact_id text references contacts (id),
  deal_id text references deals (id),
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  check (contact_id is not null or deal_id is not null)
);
