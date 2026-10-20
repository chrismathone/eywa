import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { TASK_STATE_LABEL, TASK_STATE_TONE, type StaffTaskState } from "../kinds";

/**
 * 할 일 상태 칩 — 색은 의미색(처리 전 = 내 할 일 · 늦음·기한 지남 = 위험 · 처리됨 = 완료 · 취소 = 종료).
 * 묶음 알림(여러 할 일)이면 남은 건수를 붙인다("처리 전 · 남은 2/3").
 */
export function TaskStateChip({ state, total, remaining }: { state: StaffTaskState; total?: number; remaining?: number }) {
  const count = total && total > 1 && remaining ? ` · 남은 ${remaining}/${total}` : "";
  return <Pill color={toneColor(TASK_STATE_TONE[state])} soft className="shrink-0">{TASK_STATE_LABEL[state]}{count}</Pill>;
}
