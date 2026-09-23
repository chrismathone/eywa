// 요일 묶음 규칙. 월~금은 빠짐없이, 토·일은 넣은 것만. 설정 스키마와 시간표가 같이 쓴다.
// 설정 타입을 여기서 import하면 순환이 된다 — 이 파일은 의존이 없다.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export const WEEKEND_DAYS = ["sat", "sun"] as const;
export const GROUPING_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type GroupingDay = (typeof GROUPING_DAYS)[number];

const KO: Record<GroupingDay, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

function isGroupingDay(day: unknown): day is GroupingDay {
  return typeof day === "string" && (GROUPING_DAYS as readonly string[]).includes(day);
}

export function isWeekendDay(day: GroupingDay): boolean {
  return day === "sat" || day === "sun";
}

/** 화면·드롭다운에 적는 이름. 하루짜리는 그 요일만 적혀 혼자 남는 것이 보인다. */
export function formatWeekdayGroups(groups: readonly (readonly GroupingDay[])[]): string {
  return groups.map((group) => group.map((day) => KO[day]).join("·")).join(" / ");
}

/**
 * 저장본이 월~금을 빠짐·중복 없이 나눴으면 요일 순으로 정리해 돌려준다.
 * 하루만 있는 묶음도 그대로 남긴다(침산 수요일처럼 혼자 서는 열).
 */
export function parseWeekdayPartition(groups: unknown): GroupingDay[][] | null {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > GROUPING_DAYS.length) return null;
  const seen = new Set<GroupingDay>();
  const cleaned: GroupingDay[][] = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) return null;
    const days: GroupingDay[] = [];
    for (const day of group) {
      if (!isGroupingDay(day) || seen.has(day)) return null;
      seen.add(day);
      days.push(day);
    }
    days.sort((a, b) => GROUPING_DAYS.indexOf(a) - GROUPING_DAYS.indexOf(b));
    cleaned.push(days);
  }
  for (const day of WEEKDAYS) if (!seen.has(day)) return null;
  cleaned.sort((a, b) => GROUPING_DAYS.indexOf(a[0]) - GROUPING_DAYS.indexOf(b[0]));
  return cleaned;
}

/**
 * 아직 안 넣은 평일은 하루짜리로 채운다. 토·일은 넣은 것만 남긴다.
 * 같은 요일이 두 묶음에 있으면 null.
 */
export function completeWeekdayPartition(partial: readonly (readonly GroupingDay[])[]): GroupingDay[][] | null {
  const seen = new Set<GroupingDay>();
  const groups: GroupingDay[][] = [];
  for (const group of partial) {
    const days = GROUPING_DAYS.filter((day) => group.includes(day));
    if (days.length === 0) continue;
    if (days.some((day) => seen.has(day))) return null;
    for (const day of days) seen.add(day);
    groups.push([...days]);
  }
  for (const day of WEEKDAYS) if (!seen.has(day)) groups.push([day]);
  return parseWeekdayPartition(groups);
}

export function weekdayPartitionKey(groups: readonly (readonly GroupingDay[])[]): string {
  return groups.map((group) => group.join(",")).join("|");
}
