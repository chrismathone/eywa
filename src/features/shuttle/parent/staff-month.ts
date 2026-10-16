import { dayCodeOf } from "../roster";
import type { Direction } from "../types";
import {
  ABSENT_MEMO_PREFIX,
  buildParentMonth,
  summarizeParentMonth,
  type DirMark,
  type MonthBoarding,
  type MonthDay,
  type MonthException,
  type MonthRegular,
  type MonthSummary,
} from "./parent-month";

/**
 * 직원 '학부모 등하원 → 월별'(사용자 2026-10-16 "각 학부모들이 월별에서 보는 걸 통합으로") — 아이마다 학부모 월별 달력과
 * **같은 판정**(`buildParentMonth`)으로 한 달을 접어, 아이 한 줄 × 평일 칸의 표로 모은다. 순수 함수(Vitest).
 *
 * 🔑 칸 하나 = 학부모 달력 칸 하나(탔음 · 미탑승 · 안 탐 · 변경 · 결석 · 쉬는 날) — 화면마다 판정이 갈리지 않는다.
 * 🔑 줄 끝 합계도 학부모 화면과 같은 `summarizeParentMonth`.
 */
export type StaffMonthStudent = { id: string; name: string; schoolGrade: string };
export type StaffMonthStudentInput = StaffMonthStudent & {
  regular: readonly MonthRegular[];
  exceptions: readonly MonthException[];
  boardings: readonly MonthBoarding[];
};
export type StaffMonthHead = Pick<MonthDay, "date" | "day" | "holiday" | "isToday">;
/** 재료(정기 배정 · 변경 · 탑승 기록)도 줄에 남긴다 — 날짜·칸 상세 모달(`staffDayDetail`)이 서버를 다시 부르지 않게. */
export type StaffMonthRow = StaffMonthStudentInput & { cells: MonthDay[]; summary: MonthSummary };
export type StaffMonth = { days: StaffMonthHead[]; rows: StaffMonthRow[] };

export function buildStaffMonth(input: {
  month: string;
  today: string;
  holidays: Readonly<Record<string, string>>;
  students: readonly StaffMonthStudentInput[];
}): StaffMonth {
  let days: StaffMonthHead[] = [];
  const rows = input.students.map((s) => {
    const weeks = buildParentMonth({ month: input.month, today: input.today, holidays: input.holidays, regular: s.regular, exceptions: s.exceptions, boardings: s.boardings });
    const cells = weeks.flat().filter((d) => d.inMonth);
    if (days.length === 0) days = cells.map(({ date, day, holiday, isToday }) => ({ date, day, holiday, isToday }));
    return { ...s, cells, summary: summarizeParentMonth(weeks) };
  });
  // 아이가 하나도 없어도 날짜 머리는 그린다.
  if (days.length === 0) {
    days = buildParentMonth({ month: input.month, today: input.today, holidays: input.holidays, regular: [], exceptions: [], boardings: [] })
      .flat()
      .filter((d) => d.inMonth)
      .map(({ date, day, holiday, isToday }) => ({ date, day, holiday, isToday }));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { days, rows };
}

/** 달력 칸 하나 — 그날 학원 전체를 접은 것(사용자 2026-10-16 "월별을 캘린더식으로 넣어서 좀 더 가시성 있게"). */
export type StaffCalendarDay = {
  date: string;
  day: number;
  inMonth: boolean;
  holiday: string | null;
  isToday: boolean;
  /** 등원이나 하원을 한 번이라도 탄 아이 수. */
  rode: number;
  /** 이름 목록 — 미탑승(방향 표시) · 결석 · 안 탐 · 변경. 이름순. */
  missed: string[];
  absent: string[];
  skip: string[];
  changed: string[];
};

/**
 * 월~금 달력 — 아이별 표(`buildStaffMonth`)의 같은 칸들을 날짜마다 모은다. 주마다 5칸, 이번 달 평일이 없는 주는 뺀다.
 * 🔑 판정은 아이별 표와 같다(같은 MonthDay를 센다) — 달력과 표가 서로 어긋나지 않는다.
 */
export function staffMonthCalendar(input: { month: string; today: string; holidays: Readonly<Record<string, string>> }, data: StaffMonth): StaffCalendarDay[][] {
  const byDate = new Map<string, { name: string; cell: MonthDay }[]>();
  for (const r of data.rows) for (const c of r.cells) byDate.set(c.date, [...(byDate.get(c.date) ?? []), { name: r.name, cell: c }]);
  const dirName = (name: string, cell: MonthDay) => {
    const dirs = [cell.in === "missed" ? "등" : null, cell.out === "missed" ? "하" : null].filter(Boolean).join("·");
    return `${name}(${dirs})`;
  };
  return buildParentMonth({ ...input, regular: [], exceptions: [], boardings: [] }).map((week) =>
    week.map((d): StaffCalendarDay => {
      const list = d.inMonth && !d.holiday ? (byDate.get(d.date) ?? []) : [];
      const has = (c: MonthDay, m: "rode" | "missed" | "skip" | "changed") => c.in === m || c.out === m;
      return {
        date: d.date,
        day: d.day,
        inMonth: d.inMonth,
        holiday: d.holiday,
        isToday: d.isToday,
        rode: list.filter((x) => has(x.cell, "rode")).length,
        missed: list.filter((x) => has(x.cell, "missed")).map((x) => dirName(x.name, x.cell)),
        absent: list.filter((x) => x.cell.absent).map((x) => x.name),
        skip: list.filter((x) => !x.cell.absent && has(x.cell, "skip")).map((x) => x.name),
        changed: list.filter((x) => has(x.cell, "changed")).map((x) => x.name),
      };
    }),
  );
}

/** 상세 모달의 한 방향(등원·하원) — 표시 + 그 근거. */
export type StaffDirDetail = {
  direction: Direction;
  mark: DirMark;
  /** 평소 자리 — 그 요일 정기 배정 글자("1호차 2회차 · 칠성초 정문 18:20"). */
  regular: string[];
  /** 그날만 바뀐 자리 + 사유·바꾼 사람. */
  added: { label: string | null; memo: string | null; actor: string | null }[];
  /** 그날 안 탐 — 사유(결석 머리말은 뗀다)·바꾼 사람. */
  skip: { memo: string | null; actor: string | null } | null;
  /** 탑승 기록 — 지난 날·오늘만(미래 기록은 달력과 같이 믿지 않는다). */
  records: MonthBoarding["status"][];
};

export type StaffDayDetail = {
  date: string;
  holiday: string | null;
  absent: boolean;
  /** 오늘 이후인가 — 기록이 없을 때 "기록 없음"(지난 날) / "평소대로"(앞으로)를 가른다. */
  future: boolean;
  in: StaffDirDetail;
  out: StaffDirDetail;
};

const stripAbsent = (memo: string | null) => {
  if (!memo) return null;
  return memo.startsWith(ABSENT_MEMO_PREFIX) ? memo.slice(ABSENT_MEMO_PREFIX.length).trim() || null : memo;
};

/**
 * 아이 한 명 · 하루 상세(사용자 2026-10-16 "월별에서 해당 날짜 내역을 클릭하면 모달로 상세히") — 달력 칸 표시(`MonthDay`)에
 * 그 근거(평소 자리 · 바뀐 자리 · 사유 · 바꾼 사람 · 탑승 기록)를 붙인다. 줄에 실린 재료만 쓰는 순수 함수(Vitest).
 * 🔑 직원·학부모 어느 쪽이 바꿨든 같은 표(`shuttle_ride_exceptions`)라 여기 그대로 나온다 — `actor`가 누구인지 적는다.
 */
export function staffDayDetail(row: StaffMonthRow, date: string, today: string): StaffDayDetail | null {
  const cell = row.cells.find((c) => c.date === date);
  if (!cell) return null;
  const code = dayCodeOf(date);
  const dir = (direction: Direction, mark: DirMark): StaffDirDetail => {
    const ex = row.exceptions.filter((e) => e.onDate === date && e.direction === direction);
    const skip = ex.find((e) => e.kind === "skip");
    return {
      direction,
      mark,
      regular: row.regular
        .filter((r) => r.direction === direction && r.weekdays.includes(code))
        .map((r) => r.label ?? "정기 배정"),
      added: ex.filter((e) => e.kind === "add").map((e) => ({ label: e.label ?? null, memo: e.memo, actor: e.actor ?? null })),
      skip: skip ? { memo: stripAbsent(skip.memo), actor: skip.actor ?? null } : null,
      records: date <= today ? row.boardings.filter((b) => b.date === date && b.direction === direction).map((b) => b.status) : [],
    };
  };
  return {
    date,
    holiday: cell.holiday,
    absent: cell.absent,
    future: date > today,
    in: dir("in", cell.in),
    out: dir("out", cell.out),
  };
}

/** 그날 상세에 '챙길 일'이 있나 — 미탑승 · 결석 · 안 탐 · 변경. 달력 모달에서 위로 올린다. */
export function needsAttention(d: StaffDayDetail): boolean {
  return d.absent || [d.in.mark, d.out.mark].some((m) => m === "missed" || m === "skip" || m === "changed");
}
