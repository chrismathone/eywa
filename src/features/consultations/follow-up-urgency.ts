import { kstToday } from "@/lib/date-kst";

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type FollowUpUrgency = "done" | "overdue" | "today" | "soon" | "later" | "none";

/** YYYY-MM-DD에 달력 일수를 더한다. UTC 자정 산술이라 실행 환경의 타임존 영향을 받지 않는다. */
export function addIsoDateDays(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!ISO_DATE_RE.test(date) || Number.isNaN(timestamp)) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

/** KST 달력 날짜 기준 follow-up 긴급도. todayKst를 주입하면 결정적으로 테스트할 수 있다. */
export function followUpUrgency(
  date: string | null,
  done: boolean,
  todayKst: string = kstToday(),
): FollowUpUrgency {
  if (done) return "done";
  if (!date) return "none";

  const target = date.slice(0, 10);
  if (!ISO_DATE_RE.test(target)) return "later";
  if (target < todayKst) return "overdue";
  if (target === todayKst) return "today";
  if (target <= addIsoDateDays(todayKst, 3)) return "soon";
  return "later";
}
