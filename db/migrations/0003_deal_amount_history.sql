-- 0003_deal_amount_history.sql — traza inmutable de cambios de monto (H-09,
-- gate 4 de la división). Igual que stage_events: append-only, sin endpoint
-- mutador (inmutabilidad por ausencia de rutas). El seed NO genera eventos:
-- la traza nace con el primer cambio real de monto (AC4, plan §12.3).
create table if not exists deal_amount_history (
  id text primary key,
  deal_id text not null references deals (id),
  old_cents integer not null check (old_cents > 0),
  new_cents integer not null check (new_cents > 0),
  actor text not null,
  created_at text not null
);

-- Índice por (deal_id, created_at): el detalle del deal ordena por esa dupla
-- (+rowid, L-04). Delta consciente sobre el "sin índice" del plan §12.3,
-- pedido explícito por el dispatcher del sprint; costo trivial en tabla chica.
create index if not exists deal_amount_history_deal_idx
  on deal_amount_history (deal_id, created_at);
