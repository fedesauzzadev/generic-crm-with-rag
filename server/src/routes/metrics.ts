import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { SessionEnv } from "../auth.js";
import { STAGES, isFinal, type Stage } from "../domain/pipeline.js";

// GET /api/metrics (H-06 / S07): KPIs del dashboard en 4 agregados SQL
// prepared sobre datos existentes — el dashboard es una vista, no crea data
// (§12.2.1). Sin caché server: ≤1k deals activos hacen que los agregados
// cuesten ms e invalidar en cada mutación costaría más de lo que ahorra.

const ACTIVITY_TYPES = ["call", "email", "meeting", "task"] as const;
const WINDOW_WEEKS = 8;
const WEEK_MS = 7 * 86_400_000;

interface TopCompanyRow {
  company_id: string;
  name: string;
  open_count: number;
  open_cents: number;
}

export function createMetricsRoutes(db: Database.Database): Hono<SessionEnv> {
  // Stages abiertos (no terminales): únicos que cuentan como "valor abierto".
  const openStages = STAGES.filter((s) => !isFinal(s));

  const byStage = db.prepare(
    `select stage, count(*) as count, sum(amount_cents) as total_cents
     from deals where deleted_at is null group by stage`
  );
  const wonLost = db.prepare(
    `select stage, count(*) as count from deals
     where deleted_at is null and stage in ('ganado', 'perdido') group by stage`
  );
  const byType = db.prepare(
    `select type, count(*) as count from activities
     where deleted_at is null and created_at >= ? group by type`
  );
  const topCompanies = db.prepare(
    `select d.company_id as company_id, co.name as name,
            count(*) as open_count, sum(d.amount_cents) as open_cents
     from deals d
     join companies co on co.id = d.company_id
     where d.deleted_at is null and d.stage in (${openStages.map(() => "?").join(", ")})
     group by d.company_id
     order by open_cents desc, d.company_id
     limit 5`
  );

  return new Hono<SessionEnv>().get("/", (c) => {
    // Pipeline: espejo exacto de GET /api/deals/pipeline (invariante I8) —
    // mismos 5 stages siempre, 0 si vacío.
    const rows = byStage.all() as { stage: Stage; count: number; total_cents: number | null }[];
    const stageMap = new Map(rows.map((r) => [r.stage, r]));
    const stages = STAGES.map((stage) => ({
      stage,
      count: stageMap.get(stage)?.count ?? 0,
      total_cents: stageMap.get(stage)?.total_cents ?? 0,
    }));

    const closed = new Map(
      (wonLost.all() as { stage: Stage; count: number }[]).map((r) => [r.stage, r.count])
    );
    const won = closed.get("ganado") ?? 0;
    const lost = closed.get("perdido") ?? 0;

    const from = new Date(Date.now() - WINDOW_WEEKS * WEEK_MS).toISOString();
    const typeMap = new Map(
      (byType.all(from) as { type: string; count: number }[]).map((r) => [r.type, r.count])
    );

    return c.json({
      ok: true,
      pipeline: {
        stages,
        total_cents: stages.reduce((acc, s) => acc + s.total_cents, 0),
        total_count: stages.reduce((acc, s) => acc + s.count, 0),
      },
      win_rate: { won, lost, rate: won + lost > 0 ? won / (won + lost) : null },
      activities: {
        window_weeks: WINDOW_WEEKS,
        from,
        by_type: ACTIVITY_TYPES.map((type) => ({ type, count: typeMap.get(type) ?? 0 })),
      },
      top_companies: topCompanies.all(...openStages) as TopCompanyRow[],
    });
  });
}
