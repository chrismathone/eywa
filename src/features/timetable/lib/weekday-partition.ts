// 평일(월~금)을 묶음으로 나누는 규칙. 설정 스키마와 시간표가 같이 쓴다.
// 설정 타입을 여기서 import하면 순환이 된다 — 이 파일은 의존이 없다.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const KO: Record<Weekday, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };

function isWeekday(day: unknown): day is Weekday {
  return typeof day === "string" && (WEEKDAYS as readonly string[]).includes(day);
}

/** 화면·드롭다운에 적는 이름. 하루짜리는 그 요일만 적혀 혼자 남는 것이 보인다. */
export function formatWeekdayGroups(groups: readonly (readonly Weekday[])[]): string {
  return groups.map((group) => group.map((day) => KO[day]).join("·")).join(" / ");
}

/**
 * 저장본이 월~금을 빠짐·중복 없이 나눴으면 요일 순으로 정리해 돌려준다.
 * 하루만 있는 묶음도 그대로 남긴다(침산 수요일처럼 혼자 서는 열).
 */
export function parseWeekdayPartition(groups: unknown): Weekday[][] | null {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > WEEKDAYS.length) return null;
  const seen = new Set<Weekday>();
  const cleaned: Weekday[][] = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) return null;
    const days: Weekday[] = [];
    for (const day of group) {
      if (!isWeekday(day) || seen.has(day)) return null;
      seen.add(day);
      days.push(day);
    }
    days.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    cleaned.push(days);
  }
  if (seen.size !== WEEKDAYS.length) return null;
  cleaned.sort((a, b) => WEEKDAYS.indexOf(a[0]) - WEEKDAYS.indexOf(b[0]));
  return cleaned;
}

/** 아직 안 넣은 요일은 하루짜리로 채운다. 같은 요일이 두 묶음에 있으면 null. */
export function completeWeekdayPartition(partial: readonly (readonly Weekday[])[]): Weekday[][] | null {
  const seen = new Set<Weekday>();
  const groups: Weekday[][] = [];
  for (const group of partial) {
    const days = WEEKDAYS.filter((day) => group.includes(day));
    if (days.length === 0) continue;
    if (days.some((day) => seen.has(day))) return null;
    for (const day of days) seen.add(day);
    groups.push([...days]);
  }
  for (const day of WEEKDAYS) if (!seen.has(day)) groups.push([day]);
  return parseWeekdayPartition(groups);
}

export function weekdayPartitionKey(groups: readonly (readonly Weekday[])[]): string {
  return groups.map((group) => group.join(",")).join("|");
}
