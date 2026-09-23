import { WEEKDAY_GROUPINGS, type WeekdayGrouping } from "@/features/owner/settings-types";
import type { DayOfWeek } from "./periods";
import {
  formatWeekdayGroups,
  parseWeekdayPartition,
  weekdayPartitionKey,
  type GroupingDay,
} from "./weekday-partition";

export { formatWeekdayGroups };

// 과목별 시간표 요일 병합 — 프리셋(WeekdayGrouping)을 실제 평일 요일 분할로. 같은 그룹의 요일은
// (같은 반·내용이면) 한 칸으로 병합 표시, 단독 그룹은 풀너비. 단일 소스(시간표 렌더 + 과목 편집기 공용).
export type { WeekdayGrouping };
export { WEEKDAY_GROUPINGS };

export const WEEKDAY_GROUPING_LABEL: Record<WeekdayGrouping, string> = {
  "mon-thu": "월·목 / 화·금 (주2회)",
  "mon-tue": "월·화 / 목·금 (주2회)",
  "mon-wed-fri": "월·수·금 / 화·목",
  "mon-tue-seq": "월·화 / 수·목 (주2회)",
  none: "병합 없음 (요일별 개별)",
};

export const WEEKDAY_GROUPING_OPTIONS: { value: WeekdayGrouping; label: string }[] =
  WEEKDAY_GROUPINGS.map((v) => ({ value: v, label: WEEKDAY_GROUPING_LABEL[v] }));

// 프리셋 → 평일(월~금) 분할. 각 내부 배열 = 한 그룹(묶이는 요일). 길이 1 = 단독(풀너비).
const PARTITIONS: Record<WeekdayGrouping, DayOfWeek[][]> = {
  "mon-thu": [["mon", "thu"], ["tue", "fri"], ["wed"]],
  "mon-tue": [["mon", "tue"], ["thu", "fri"], ["wed"]],
  "mon-wed-fri": [["mon", "wed", "fri"], ["tue", "thu"]],
  "mon-tue-seq": [["mon", "tue"], ["wed", "thu"], ["fri"]],
  none: [["mon"], ["tue"], ["wed"], ["thu"], ["fri"]],
};

export function weekdayPartition(g: WeekdayGrouping): DayOfWeek[][] {
  return PARTITIONS[g];
}

/** 한 묶음 안의 요일을 그 프리셋이 적은 순서로. 수업 없는 요일은 호출부가 이미 빼 둔다. */
export function sortDaysInGroup(days: readonly DayOfWeek[], group: readonly DayOfWeek[]): DayOfWeek[] {
  const rank = new Map(group.map((day, index) => [day, index]));
  return [...days].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
}

/** 저장값(미설정·불량 포함)을 안전한 프리셋으로 — resolve가 스키마를 안 거치므로 읽는 쪽에서 폴백. */
export function normalizeWeekdayGrouping(v: unknown): WeekdayGrouping {
  return (WEEKDAY_GROUPINGS as readonly string[]).includes(v as string)
    ? (v as WeekdayGrouping)
    : "mon-thu";
}

function isBuiltin(value: string): value is WeekdayGrouping {
  return (WEEKDAY_GROUPINGS as readonly string[]).includes(value);
}

/** 만든 묶음이 기본 목록과 같으면 그 프리셋. 없으면 null. 토·일이 있으면 기본 목록과 다르다. */
export function builtinIdForGroups(groups: readonly (readonly GroupingDay[])[]): WeekdayGrouping | null {
  const parsed = parseWeekdayPartition(groups);
  if (!parsed) return null;
  const key = weekdayPartitionKey(parsed);
  for (const id of WEEKDAY_GROUPINGS) {
    const part = parseWeekdayPartition(weekdayPartition(id));
    if (part && weekdayPartitionKey(part) === key) return id;
  }
  return null;
}

/**
 * 과목에 저장된 병합 → 기본뷰가 그릴 요일 묶음.
 * 기본 프리셋이면 그 분할, 학원이 만든 id면 그 분할, 없거나 깨졌으면 월·목 / 화·금.
 */
export function resolveWeekdayGroups(
  value: unknown,
  customs?: readonly { id: string; groups: readonly (readonly DayOfWeek[])[] }[],
): DayOfWeek[][] {
  if (typeof value === "string" && isBuiltin(value)) return weekdayPartition(value);
  const custom = typeof value === "string" ? customs?.find((row) => row.id === value) : undefined;
  const parsed = custom ? parseWeekdayPartition(custom.groups) : null;
  return parsed ?? weekdayPartition("mon-thu");
}

/** 과목 드롭다운. 목록에서 뺀 기본 묶음은 숨기고, 학원이 만든 묶음은 뒤에 붙인다. */
export function weekdayGroupingChoices(
  customs?: readonly { id: string; groups: readonly (readonly DayOfWeek[])[] }[],
  hiddenBuiltins: readonly WeekdayGrouping[] = [],
): { value: string; label: string }[] {
  const extra: { value: string; label: string }[] = [];
  for (const custom of customs ?? []) {
    const parsed = parseWeekdayPartition(custom.groups);
    if (!parsed) continue;
    extra.push({ value: custom.id, label: formatWeekdayGroups(parsed) });
  }
  return [...WEEKDAY_GROUPING_OPTIONS.filter((option) => !hiddenBuiltins.includes(option.value)), ...extra];
}

/** 기본뷰는 평일 판과 주말 판이 따로다. 토·일을 안 적으면 주말은 예전처럼 토·일 각각이다. */
export function timetableBoards(groups: readonly (readonly DayOfWeek[])[]): {
  weekdays: DayOfWeek[][];
  weekend: DayOfWeek[][] | null;
} {
  const weekdays: DayOfWeek[][] = [];
  const weekend: DayOfWeek[][] = [];
  for (const group of groups) {
    const days = group.filter((day) => day !== "sat" && day !== "sun");
    const ends = group.filter((day) => day === "sat" || day === "sun");
    if (days.length > 0) weekdays.push(days);
    if (ends.length > 0) weekend.push(ends);
  }
  return { weekdays, weekend: weekend.length > 0 ? weekend : null };
}

const WEEKEND_ORDER: DayOfWeek[] = ["sat", "sun"];

/**
 * 주말 판에 그릴 묶음. null이면 호출부가 예전처럼 토·일을 각각(병합 없음) 그린다.
 * 한쪽만 적혀 있으면 나머지 요일은 혼자 남겨 그 날 수업이 사라지지 않게 한다.
 */
export function weekendBoardDays(groups: readonly (readonly DayOfWeek[])[]): DayOfWeek[][] | null {
  const weekend = timetableBoards(groups).weekend;
  if (!weekend) return null;
  const seen = new Set(weekend.flat());
  const filled = weekend.map((group) => [...group]);
  for (const day of WEEKEND_ORDER) if (!seen.has(day)) filled.push([day]);
  return filled.sort((a, b) => WEEKEND_ORDER.indexOf(a[0]!) - WEEKEND_ORDER.indexOf(b[0]!));
}
