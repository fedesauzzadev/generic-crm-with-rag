-- 0002_contacts_list_idx.sql — índice del listado de contacts (NFR N7).
-- El listado ordena por created_at desc, id sobre filas activas; sin índice,
-- cada página re-ordena las 10k filas del dataset de volumen (~15 ms/query,
-- p95 medido 327 ms con 10 conexiones contra budget de 200 ms).
create index if not exists contacts_active_list_idx
  on contacts (created_at desc, id) where deleted_at is null;
