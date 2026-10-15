import { buildMonthGrid } from "@/lib/month-grid";
import { holidayShortName } from "@/features/calendar/holidays";
import { dayCodeOf } from "../roster";
import type { DayCode, Direction } from "../types";

/**
 * 학부모 '월별' 달력 — 한 달의 등하원을 **평일 칸**에 접는 순수 함수(사용자 2026-10-01).
 *
 * 🔑 평일(월~금)만 그린다 — 셔틀은 주말에 운영하지 않는다.
 * 🔑 지난 날·오늘 = **사실**(탑승 기록): 탔음 / 미탑승. 기록이 없으면 그날의 변경(안 탐·결석·변경)을 보인다.
 * 🔑 앞으로의 날 = **바뀐 날만**(사용자 결정) — 평소대로인 날은 비워 둔다. 미래 날짜에 남은 탑승 기록은 믿지 않는다
 *    (아직 안 일어난 일 — 시험 데이터가 그렇게 들어가 "완료"로 보였다, 2026-10-01).
 * 🔑 쉬는 날 = 학원 휴원일(학원설정 `operations.holidays`) ∪ **법정공휴일**(내장 표 `features/calendar/holidays.ts`).
 *    둘 다 칸을 회색으로 두고 이름만 적는다 — 등하원 표시 없음 · 수정 불가(사용자 2026-10-01 *"공휴일은 대체로 학원도
 *    쉬거든? 공휴일엔 학원도 쉬어요라고 수정할 수 없게"*). 이름은 학원설정이 먼저(학원이 붙인 이름이 더 구체적이다).
 *    🔴 서버도 같은 판정으로 막는다(`parentDayGate`, [[#77]]). ⚠️ 학부모 셔틀 화면 한정 결정이다 — 출석부·시수는
 *    법정공휴일 ≠ 학원 휴원일 규약 그대로(공휴일에 수업한 날이 실제로 있다).
 */

/** 한 방향의 표시 — 탔음 · 미탑승 · 안 탐 · 변경(다른 자리). 없으면 null(평소대로·기록 없음). */
export type DirMark = "rode" | "missed" | "skip" | "changed" | null;

export type MonthDay = {
  date: string;
  day: number;
  /** 이번 달 날짜인가(앞뒤 달은 빈 칸). */
  inMonth: boolean;
  /** 쉬는 날 이름 — 학원 휴원일 또는 법정공휴일(없으면 null). 셔틀 없음 · 수정 불가. */
  holiday: string | null;
  isToday: boolean;
  /** 결석(등원·하원 둘 다 결석으로 안 탐) — 칸에 '결석' 한 번만 적는다. */
  absent: boolean;
  in: DirMark;
  out: DirMark;
};

export type MonthRegular = { direction: Direction; weekdays: readonly DayCode[]; runStopId: string };
export type MonthException = {
  onDate: string;
  direction: Direction;
  kind: "add" | "skip";
  runStopId: string | null;
  memo: string | null;
  /** 바뀐 자리 글자("1호차 2회차 · 칠성초 정문 18:20") — 변경 목록용. */
  label?: string | null;
};
export type MonthBoarding = { date: string; direction: Direction; status: "boarded" | "extra" | "missed" };

/** 결석으로 건 '타지 않기'의 사유 머리(서버 `ABSENT_PREFIX`와 같은 글자). */
export const ABSENT_MEMO_PREFIX = "결석 · ";

export type MonthInput = {
  month: string;
  today: string;
  holidays: Readonly<Record<string, string>>;
  regular: readonly MonthRegular[];
  exceptions: readonly MonthException[];
  boardings: readonly MonthBoarding[];
};

/** 그 날짜·방향의 표시 한 칸. */
function markOf(input: MonthInput, date: string, dir: Direction): DirMark {
  // 사실 먼저 — 지난 날·오늘의 탑승 기록. 미래 날짜의 기록은 아직 안 일어난 일이라 안 본다.
  if (date <= input.today) {
    const recs = input.boardings.filter((b) => b.date === date && b.direction === dir);
    if (recs.some((b) => b.status === "boarded" || b.status === "extra")) return "rode";
    if (recs.some((b) => b.status === "missed")) return "missed";
  }
  const ex = input.exceptions.filter((e) => e.onDate === date && e.direction === dir);
  if (ex.some((e) => e.kind === "skip")) return "skip";
  const add = ex.find((e) => e.kind === "add");
  if (add) {
    // 평소 자리와 같은 칸을 가리키면 바뀐 게 아니다(roster의 '중복 줄 금지' 규칙과 같다).
    const day = dayCodeOf(date);
    const regularHere = input.regular.some(
      (r) => r.direction === dir && r.weekdays.includes(day) && r.runStopId === add.runStopId,
    );
    if (!regularHere) return "changed";
  }
  return null;
}

/** 그날 결석인가 — 두 방향 모두 '결석 · ' 사유로 안 탄다(한 방향만 남았어도 결석이면 결석으로 본다). */
function absentOn(input: MonthInput, date: string): boolean {
  const skips = input.exceptions.filter((e) => e.onDate === date && e.kind === "skip");
  return skips.length > 0 && skips.every((e) => (e.memo ?? "").startsWith(ABSENT_MEMO_PREFIX));
}

/** 월 달력 — 주마다 월~금 5칸. 이번 달 평일이 하나도 없는 주는 뺀다. */
export function buildParentMonth(input: MonthInput): MonthDay[][] {
  return buildMonthGrid(input.month, { weekStartsOn: 1 })
    .map((week) => week.slice(0, 5)) // 월~금
    .filter((week) => week.some((c) => c.inMonth))
    .map((week) =>
      week.map((c): MonthDay => {
        const holiday = c.inMonth ? input.holidays[c.date] ?? holidayShortName(c.date) : null;
        const live = c.inMonth && !holiday;
        const absent = live && absentOn(input, c.date);
        return {
          date: c.date,
          day: c.day,
          inMonth: c.inMonth,
          holiday,
          isToday: c.date === input.today,
          absent,
          in: live ? markOf(input, c.date, "in") : null,
          out: live ? markOf(input, c.date, "out") : null,
        };
      }),
    );
}

export type MonthSummary = { rodeDays: number; missed: number; skipDays: number; absentDays: number; changedDays: number };

/** 이 달 요약 한 줄 — 탄 날 · 미탑승(방향 수) · 안 탐(결석 빼고) · 결석 · 변경된 날. */
export function summarizeParentMonth(weeks: readonly MonthDay[][]): MonthSummary {
  const s: MonthSummary = { rodeDays: 0, missed: 0, skipDays: 0, absentDays: 0, changedDays: 0 };
  for (const d of weeks.flat()) {
    if (!d.inMonth) continue;
    const marks = [d.in, d.out];
    if (marks.includes("rode")) s.rodeDays++;
    s.missed += marks.filter((m) => m === "missed").length;
    if (d.absent) s.absentDays++;
    else if (marks.includes("skip")) s.skipDays++;
    if (marks.includes("changed")) s.changedDays++;
  }
  return s;
}

export type MonthChange = { date: string; direction: Direction; kind: "changed" | "skip" | "absent"; label: string | null };

/**
 * '이번 달 변경' 목록 — 날짜 순. 결석은 하루에 한 줄로 접는다.
 * 🔴 사유(memo)는 싣지 않는다 — 직원이 적은 사유일 수 있다(학부모 화면은 직원 메모를 내보내지 않는다).
 */
export function listParentMonthChanges(input: MonthInput, weeks: readonly MonthDay[][]): MonthChange[] {
  const days = new Map(weeks.flat().filter((d) => d.inMonth).map((d) => [d.date, d]));
  const out: MonthChange[] = [];
  const seenAbsent = new Set<string>();
  for (const e of [...input.exceptions].sort((a, b) => a.onDate.localeCompare(b.onDate) || a.direction.localeCompare(b.direction))) {
    const day = days.get(e.onDate);
    if (!day || day.holiday) continue;
    if (day.absent) {
      if (!seenAbsent.has(e.onDate)) out.push({ date: e.onDate, direction: "in", kind: "absent", label: null });
      seenAbsent.add(e.onDate);
      continue;
    }
    const mark = e.direction === "in" ? day.in : day.out;
    if (e.kind === "skip" && mark === "skip") out.push({ date: e.onDate, direction: e.direction, kind: "skip", label: null });
    if (e.kind === "add" && mark === "changed") out.push({ date: e.onDate, direction: e.direction, kind: "changed", label: e.label ?? null });
  }
  return out;
}
