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
import { buildLessonSchedule, MAX_LOOKAHEAD_DAYS, normalizeLessonPace, type SlotAxis } from "./lesson-schedule";
import { addToLessonIndex, type LessonIndex } from "./plan-compare";
import { planLane } from "./plan-siblings";

/** 계획 한 줄 — 그 날 그 교시에 **오기로 되어 있는** 차수. 실제 줄(`class_sheet_plan_lines`)이 아니다. */
export type PlannedLine = {
  /** 몇 차수인가(교재의 N차수). */
  lessonNo: number;
  date: string;
  /** `"HH:MM"` — 계획 줄 `slot_start`와 같은 표기. */
  slotStart: string;
  /** 그 교시의 몇 번째 차수 자리(1부터) — 줄 표식(미룸·당김)이 이 자리에 걸린다. */
  pos: number;
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
  /** 배정 id — 줄 미룸·당김 표식의 키(`planLane`). 같은 교재 배정이 여럿이면 이걸로 갈린다(2026-10-21). */
  id?: string;
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
      // 줄 표식은 **배정** 단위다(원장 2026-10-20 "수업이 2개면 각각" · 2026-10-21 같은 교재 배정 여럿 "각각 돌도록")
      // — 이 배정 것만 이 배정을 움직인다. 교재 id로 잡으면 같은 교재 배정 둘이 서로를 민다.
      lane: planLane(p),
      pace: normalizeLessonPace(p.pace),
      lookaheadDays: lookaheadFor(startDate, to),
    });

    const lessons = lessonsByBook.get(String(p.textbook_id));
    const termMode = p.term_mode === "exam" ? "exam" : "regular";
    for (const t of schedule.targets) {
      if (t.date < from || t.date > to) continue;
      const l = lessons?.get(t.lessonNo);
      (byCell[`${t.date}|${t.slotStart}`] ??= []).push({
        lessonNo: t.lessonNo,
        date: t.date,
        slotStart: t.slotStart,
        pos: t.pos,
        skillArea: book.skillArea,
        title: book.title,
        pageTime: book.pageTime,
        progress: (l?.progress ?? null) || null,
        homework: (l?.homework ?? null) || null,
        termMode,
      });
    }
  }
  // 칸 안 순서를 고정한다 — 구분 → 교재명. 호출마다 줄 순서가 흔들리면 화면이 깜빡이고 비교가 안 된다.
  for (const key of Object.keys(byCell)) {
    byCell[key]!.sort((a, b) =>
      a.skillArea !== b.skillArea
        ? a.skillArea.localeCompare(b.skillArea)
        : a.title !== b.title
          ? a.title.localeCompare(b.title, "ko")
          : a.lessonNo - b.lessonNo, // 한 교시에 같은 교재 1·2차수 — 차수 순
    );
  }
  return byCell;
}

/** 한 칸에 들어갈 차수 하나(진도·과제) — 실제 줄 **한 줄**이 된다. */
export type CellLesson = { progress: string | null; homework: string | null };
/** 한 칸(날짜·교시)에 들어갈 같은 교재 차수들(차수 순). */
export type CellLessons = { date: string; slot: string; lessons: CellLesson[] };

/**
 * 가져오기·미룸·당김의 쓰기 대상 — 한 교재의 계획 줄을 **칸별 차수 목록**으로 묶는다(차수 순).
 *
 * 🔑 **차수 하나 = 실제 줄 하나**(원장 2026-10-19 *"차시마다 한줄씩 들어가야지 … 수업시간 25분 이렇게
 *    되어있어서 제대로 안들어간걸로됌"*). 2026-10-16엔 한 교시의 1·2차수를 `A / B` 한 줄로 이었는데, 그러면
 *    `25분` 줄 하나에 차수가 둘 들어가 시간이 틀린다. 쓰기는 [`applyCellLessons`](./server/apply-cell-lessons.ts).
 * 🔑 칸은 날짜·교시 오름차순(동시 호출도 같은 순서로 락을 잡는다 — 0266a 교착 회피 규약).
 * @param lines 한 교재(시기·구분·교재명이 같은) 줄들.
 */
export function groupCellLessons(
  lines: readonly Pick<PlannedLine, "date" | "slotStart" | "lessonNo" | "progress" | "homework">[],
): CellLessons[] {
  const byCell = new Map<string, Pick<PlannedLine, "date" | "slotStart" | "lessonNo" | "progress" | "homework">[]>();
  for (const l of lines) {
    const key = `${l.date}|${l.slotStart}`;
    byCell.set(key, [...(byCell.get(key) ?? []), l]);
  }
  return [...byCell.values()]
    .map((cell) => {
      const sorted = [...cell].sort((a, b) => a.lessonNo - b.lessonNo);
      return {
        date: sorted[0]!.date,
        slot: sorted[0]!.slotStart,
        lessons: sorted.map((l) => ({ progress: blankToNull(l.progress), homework: blankToNull(l.homework) })),
      };
    })
    .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
}

function blankToNull(v: string | null | undefined): string | null {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
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
