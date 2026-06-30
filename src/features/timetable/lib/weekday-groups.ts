import { WEEKDAY_GROUPINGS, type WeekdayGrouping } from "@/features/owner/settings-types";
import type { DayOfWeek } from "./periods";

// 과목별 시간표 요일 병합 — 프리셋(WeekdayGrouping)을 실제 평일 요일 분할로. 같은 그룹의 요일은
// (같은 반·내용이면) 한 칸으로 병합 표시, 단독 그룹은 풀너비. 단일 소스(시간표 렌더 + 과목 편집기 공용).
export type { WeekdayGrouping };
export { WEEKDAY_GROUPINGS };

export const WEEKDAY_GROUPING_LABEL: Record<WeekdayGrouping, string> = {
  "mon-thu": "월·목 / 화·금 (주2회)",
  "mon-tue": "월·화 / 목·금 (주2회)",
  "mon-wed-fri": "월·수·금 / 화·목",
  none: "병합 없음 (요일별 개별)",
};

export const WEEKDAY_GROUPING_OPTIONS: { value: WeekdayGrouping; label: string }[] =
  WEEKDAY_GROUPINGS.map((v) => ({ value: v, label: WEEKDAY_GROUPING_LABEL[v] }));

// 프리셋 → 평일(월~금) 분할. 각 내부 배열 = 한 그룹(묶이는 요일). 길이 1 = 단독(풀너비).
const PARTITIONS: Record<WeekdayGrouping, DayOfWeek[][]> = {
  "mon-thu": [["mon", "thu"], ["tue", "fri"], ["wed"]],
  "mon-tue": [["mon", "tue"], ["thu", "fri"], ["wed"]],
  "mon-wed-fri": [["mon", "wed", "fri"], ["tue", "thu"]],
  none: [["mon"], ["tue"], ["wed"], ["thu"], ["fri"]],
};

export function weekdayPartition(g: WeekdayGrouping): DayOfWeek[][] {
  return PARTITIONS[g];
}

/** 저장값(미설정·불량 포함)을 안전한 프리셋으로 — resolve가 스키마를 안 거치므로 읽는 쪽에서 폴백. */
export function normalizeWeekdayGrouping(v: unknown): WeekdayGrouping {
  return (WEEKDAY_GROUPINGS as readonly string[]).includes(v as string)
    ? (v as WeekdayGrouping)
    : "mon-thu";
}
