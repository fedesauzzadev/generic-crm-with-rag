import { useI18n } from "../../app/i18n";
import { STAGE_BADGE_CLASSES, stageLabel, type Stage } from "../../domain/pipeline";

export function StageBadge({ stage }: { stage: Stage }) {
  const { lang } = useI18n();
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[stage]}`}
    >
      {stageLabel(stage, lang)}
    </span>
  );
}
