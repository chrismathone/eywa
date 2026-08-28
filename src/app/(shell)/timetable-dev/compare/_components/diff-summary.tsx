import { BigStat, type BigStatTone } from "@/components/atoms/big-stat";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
  PLAN_DIFF_KINDS,
  PLAN_DIFF_KIND_LABEL,
  PLAN_DIFF_TONE,
  type PlanDiff,
  type PlanDiffKind,
} from "@/features/timetable-dev/lib/compare";

/**
 * 비교 요약 4칸 — 추가·삭제·변경·동일.
 *
 * 🔑 숫자는 **`comparePlans`가 센 값**이지 화면이 자른 목록의 길이가 아니다([[#89]]: 상한 걸린
 * 미리보기의 배열 길이를 건수로 쓰면 34명이 영원히 "30"이 된다). 아래 목록은 상한을 걸어도 이 칸은
 * 진짜 전체 건수를 말한다.
 *
 * 색은 고르지 않는다 — `PLAN_DIFF_TONE`(뜻) → `TONE_COLOR`(의미색 캐논)만 거친다.
 */
const KIND_ICON: Record<PlanDiffKind, EywaIconName> = {
  added: "plus",
  removed: "trash",
  changed: "edit",
  same: "dot",
};

export function DiffSummary({
  diff,
  beforeLabel,
  afterLabel,
}: {
  diff: PlanDiff;
  beforeLabel: string;
  afterLabel: string;
}) {
  const count: Record<PlanDiffKind, number> = {
    added: diff.addedCount,
    removed: diff.removedCount,
    changed: diff.changedCount,
    same: diff.sameCount,
  };
  // 방향을 말로 못박는다 — "추가"가 어느 달 기준인지 헷갈리면 요약을 거꾸로 읽는다.
  const sub: Record<PlanDiffKind, string> = {
    added: `${afterLabel}에만 있음`,
    removed: `${beforeLabel}에만 있음`,
    changed: "같은 칸의 내용이 다름",
    same: "두 달이 같음",
  };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PLAN_DIFF_KINDS.map((kind) => (
        <BigStat
          key={kind}
          label={PLAN_DIFF_KIND_LABEL[kind]}
          value={count[kind]}
          unit="칸"
          sub={sub[kind]}
          tone={TONE_COLOR[PLAN_DIFF_TONE[kind]] as BigStatTone}
          icon={<EyIcon name={KIND_ICON[kind]} size={16} />}
        />
      ))}
    </div>
  );
}
