import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { TASK_STATE_LABEL, TASK_STATE_TONE, type StaffTaskState } from "../kinds";

/** 할 일 상태 칩 — 색은 의미색(처리 전 = 내 할 일 · 늦음·기한 지남 = 위험 · 처리됨 = 완료 · 취소 = 종료). */
export function TaskStateChip({ state }: { state: StaffTaskState }) {
  return <Pill color={toneColor(TASK_STATE_TONE[state])} soft className="shrink-0">{TASK_STATE_LABEL[state]}</Pill>;
}
