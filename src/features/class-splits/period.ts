/**
 * 수업 나누기 **기간** 규칙(일별·월별·영구) + 활성 판정 + 표시 문구 — 순수.
 * ⚠️ 클라(팝업)도 import한다 — `server-only` 금지([[#61]]).
 */
import { toMin, type ClassSplit, type SplitDay, type SplitPeriodKind } from "./rules";


const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → 요일 키. 형식이 아니면 null. */
export function dowOf(ymd: string): SplitDay | null {
  if (!YMD.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const idx = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[idx] ?? null;
}

/** 그날 이 나눔이 살아 있나(요일 + 기간, 양 끝 포함). */
export function splitActiveOn(s: Pick<ClassSplit, "dayOfWeek" | "validFrom" | "validTo">, date: string): boolean {
  if (dowOf(date) !== s.dayOfWeek) return false;
  if (date < s.validFrom) return false;
  return s.validTo === null || date <= s.validTo;
}

/** 기간이 [from, to] 범위와 하루라도 겹치나(주 단위 조회용). */
export function splitOverlapsRange(s: Pick<ClassSplit, "validFrom" | "validTo">, from: string, to: string): boolean {
  if (s.validFrom > to) return false;
  return s.validTo === null || s.validTo >= from;
}

export type PeriodInput =
  | { kind: "day"; date: string }
  /** 월별 — 날짜 범위는 호출부가 세션(operating_periods)으로 풀어 넘긴다(미정의면 달력월). */
  | { kind: "month"; start: string; end: string }
  | { kind: "forever"; from: string };

export type ResolvedPeriod = { kind: SplitPeriodKind; validFrom: string; validTo: string | null };

/**
 * 고른 기간 → 저장할 날짜 범위. 🔴 **과거로 소급하지 않는다** — 시작은 오늘보다 앞일 수 없다
 * (이미 찍힌 출결이 다른 반 몫으로 바뀐다). 월별은 이번 달이면 오늘부터로 당긴다.
 */
export function resolvePeriod(input: PeriodInput, today: string): ResolvedPeriod | { error: string } {
  if (input.kind === "day") {
    if (!YMD.test(input.date)) return { error: "날짜를 골라 주세요." };
    if (input.date < today) return { error: "지난 날짜에는 나눌 수 없습니다." };
    return { kind: "day", validFrom: input.date, validTo: input.date };
  }
  if (input.kind === "month") {
    if (!YMD.test(input.start) || !YMD.test(input.end)) return { error: "달을 골라 주세요." };
    if (input.end < today) return { error: "이미 끝난 달에는 나눌 수 없습니다." };
    const from = input.start < today ? today : input.start;
    return { kind: "month", validFrom: from, validTo: input.end };
  }
  if (!YMD.test(input.from)) return { error: "시작 날짜를 골라 주세요." };
  if (input.from < today) return { error: "시작 날짜는 오늘 이후여야 합니다." };
  return { kind: "forever", validFrom: input.from, validTo: null };
}

/** 기간 범위 안에 그 요일이 하루라도 있나(일별·짧은 세션 꼬리에서 빈 나눔을 막는다). */
export function hasDayInRange(day: SplitDay, from: string, to: string | null): boolean {
  if (to === null) return true;
  let cur = from;
  for (let i = 0; i < 7 && cur <= to; i++) {
    if (dowOf(cur) === day) return true;
    cur = addDays(cur, 1);
  }
  return false;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

/** "M/D" */
export function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 기간 한 줄 — `10/7 하루` · `10/7~10/31` · `10/7부터 계속`. */
export function periodText(s: Pick<ClassSplit, "validFrom" | "validTo">): string {
  if (s.validTo === null) return `${md(s.validFrom)}부터 계속`;
  if (s.validTo === s.validFrom) return `${md(s.validFrom)} 하루`;
  return `${md(s.validFrom)}~${md(s.validTo)}`;
}

/** 두 나눔이 같은 학생·요일에서 시간과 기간이 겹치나(같은 시간을 두 번 나누는 것을 막는다). */
export function splitsCollide(
  a: Pick<ClassSplit, "studentId" | "dayOfWeek" | "startTime" | "endTime" | "validFrom" | "validTo">,
  b: Pick<ClassSplit, "studentId" | "dayOfWeek" | "startTime" | "endTime" | "validFrom" | "validTo">,
): boolean {
  if (a.studentId !== b.studentId || a.dayOfWeek !== b.dayOfWeek) return false;
  if (!(toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime))) return false;
  const aTo = a.validTo ?? "9999-12-31";
  const bTo = b.validTo ?? "9999-12-31";
  return a.validFrom <= bTo && b.validFrom <= aTo;
}
