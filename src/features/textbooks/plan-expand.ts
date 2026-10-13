/**
 * 교재 배정 → **칸별 계획 줄** 펼치기 — 순수(Vitest). 한 반의 조회([`month-plan.ts`](./server/month-plan.ts))와
 * 여러 반 현황([`plan-gap.ts`](./server/plan-gap.ts))이 **같은 함수**를 탄다(두 벌이면 같은 칸이 화면마다
 * 다른 차수를 말한다).
 *
 * 🔑 **두 벌을 만든다**(원장 2026-09-28 *"계획 놔두고 일정만 밀리게"*):
 *    · 원래 계획 = 미루기·당기기를 **반영하지 않는다** — 달력의 '계획' 표식·비교 모달·현황 페이지의 기준.
 *    · 일정     = 미루기·당기기를 반영한다 — [월간계획 가져오기]가 실제로 옮기는 값.
 *    `shifts`만 다르게 넘겨 같은 함수로 두 번 부른다.
 */
import type { HolidayMap } from "@/features/class-sheets/lib/holiday";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import {
  buildLessonSchedule,
  MAX_LOOKAHEAD_DAYS,
  mergeLessonTexts,
  normalizeLessonPace,
  type SlotAxis,
} from "./lesson-schedule";
import { addToLessonIndex, type LessonIndex } from "./plan-compare";

/** 계획 한 줄 — 그 날 그 교시에 **오기로 되어 있는** 차수. 실제 줄(`class_sheet_plan_lines`)이 아니다. */
export type PlannedLine = {
  /** 몇 차수인가(교재의 N차수). 25분 단위로 여러 차수가 든 칸이면 첫 차수. */
  lessonNo: number;
  /** 그 칸에 든 마지막 차수 — 한 차수뿐이면 `lessonNo`와 같다(25분 단위에서만 다르다). */
  lessonNoEnd: number;
  date: string;
  /** `"HH:MM"` — 계획 줄 `slot_start`와 같은 표기. */
  slotStart: string;
  /** 구분(vocab·writing…) — 실제 줄의 `skill_area`와 같은 값이라 가져오기가 줄을 맞춰 넣는다. */
  skillArea: string;
  title: string;
  pageTime: string | null;
  progress: string | null;
  homework: string | null;
  termMode: "regular" | "exam";
};

/** `class_textbook_plans` 한 줄이 계산에 필요로 하는 것만. */
export type PlanRow = {
  textbook_id: string;
  slot_axis: string;
  pace: string;
  term_mode: string;
  start_date: string;
  start_lesson_no: number;
  slot_picks?: unknown;
};

export type BookInfo = {
  title: string;
  pageTime: string | null;
  skillArea: string | null;
  sessionCount: number;
};

export type LessonText = { progress: string | null; homework: string | null };

/** 며칠 앞까지 훑을지 — 구간 끝까지 닿기만 하면 된다(상한은 스케줄러와 같다). */
function lookaheadFor(startDate: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return MAX_LOOKAHEAD_DAYS;
  return Math.max(1, Math.min(MAX_LOOKAHEAD_DAYS, Math.floor(ms / 86_400_000) + 1));
}

export function expandPlans(input: {
  plans: readonly PlanRow[];
  books: ReadonlyMap<string, BookInfo>;
  lessonsByBook: ReadonlyMap<string, ReadonlyMap<number, LessonText>>;
  schedules: readonly MonthScheduleRow[];
  holidays: HolidayMap | null | undefined;
  /** 미루기·당기기(0282a). **원래 계획을 낼 땐 null**(위 🔑). */
  shifts: Readonly<Record<string, "skip" | "advance">> | null;
  from: string;
  to: string;
}): Record<string, PlannedLine[]> {
  const { plans, books, lessonsByBook, schedules, holidays, shifts, from, to } = input;
  const byCell: Record<string, PlannedLine[]> = {};
  for (const p of plans) {
    const book = books.get(String(p.textbook_id));
    // 구분·차수가 없는 교재는 애초에 배정이 거절되지만, 나중에 지워졌을 수 있다 — 조용히 건너뛴다.
    if (!book || !book.skillArea || book.sessionCount < 1) continue;

    const startDate = String(p.start_date).slice(0, 10);
    // 구간이 시작일보다 앞이면 계획이 없다(스케줄러는 시작일부터만 앉힌다).
    if (startDate > to) continue;

    const startNo = Math.max(1, Math.min(200, Number(p.start_lesson_no ?? 1)));
    const lessonNos: number[] = [];
    for (let n = startNo; n <= book.sessionCount; n += 1) lessonNos.push(n);
    if (lessonNos.length === 0) continue;

    const picks = Array.isArray(p.slot_picks) ? (p.slot_picks as unknown[]).map((v) => String(v)) : null;
    const schedule = buildLessonSchedule({
      startDate,
      lessonNos,
      schedules,
      holidays,
      axis: (p.slot_axis === "jj" ? "jj" : "class") as SlotAxis,
      slotPicks: picks,
      shifts,
      pace: normalizeLessonPace(p.pace),
      lookaheadDays: lookaheadFor(startDate, to),
    });

    const lessons = lessonsByBook.get(String(p.textbook_id));
    const termMode = p.term_mode === "exam" ? "exam" : "regular";
    for (const t of schedule.targets) {
      if (t.date < from || t.date > to) continue;
      (byCell[`${t.date}|${t.slotStart}`] ??= []).push({
        lessonNo: t.lessonNo,
        lessonNoEnd: t.lessonNos[t.lessonNos.length - 1] ?? t.lessonNo,
        date: t.date,
        slotStart: t.slotStart,
        skillArea: book.skillArea,
        title: book.title,
        pageTime: book.pageTime,
        progress: mergeLessonTexts(t.lessonNos, (no) => lessons?.get(no)?.progress),
        homework: mergeLessonTexts(t.lessonNos, (no) => lessons?.get(no)?.homework),
        termMode,
      });
    }
  }
  // 칸 안 순서를 고정한다 — 구분 → 교재명. 호출마다 줄 순서가 흔들리면 화면이 깜빡이고 비교가 안 된다.
  for (const key of Object.keys(byCell)) {
    byCell[key]!.sort((a, b) =>
      a.skillArea !== b.skillArea ? a.skillArea.localeCompare(b.skillArea) : a.title.localeCompare(b.title, "ko"),
    );
  }
  return byCell;
}

/** 배정된 교재들의 차수표 — 실제 진도 문구 → 차수를 되짚는 재료(plan-compare). */
export function lessonIndexOf(
  plans: readonly PlanRow[],
  books: ReadonlyMap<string, BookInfo>,
  lessonsByBook: ReadonlyMap<string, ReadonlyMap<number, LessonText>>,
): LessonIndex {
  const index: LessonIndex = {};
  for (const id of new Set(plans.map((p) => String(p.textbook_id)))) {
    const book = books.get(id);
    const lessons = lessonsByBook.get(id);
    if (!book || !lessons) continue;
    addToLessonIndex(
      index,
      book.title,
      [...lessons.entries()].map(([lessonNo, l]) => ({ lessonNo, progress: l.progress })),
    );
  }
  return index;
}
