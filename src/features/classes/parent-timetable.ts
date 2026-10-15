/**
 * 학부모 '수업 시간표' — 아이 한 명의 **이번 주 월~금 수업 시작·끝 시각**을 접는 순수 함수(사용자 2026-10-02).
 *
 * 🔑 날짜로 판정한다 — 요일 칸의 **그 날짜**에 ① 수강 중이고(시작일~종료일 · 대기 아님 · 분리등원 요일) ② 그 교시 배치가
 *    유효한(`valid_from`~`valid_to`) 것만. `class_schedules`는 지난 배치 이력을 함께 담는다([[#88]]).
 * 🔑 한 수업 = 한 줄 — 같은 반의 이어지는 교시(쉬는 시간 10분 이내)는 한 덩어리로 묶어 "16:20 ~ 18:10"으로 적는다
 *    (교시마다 쪼개 보이면 학부모는 몇 시에 끝나는지 되짚어야 한다).
 * 🔴 강사·강의실·교시 이름은 싣지 않는다 — 학부모 화면은 반 이름과 시각만.
 */

export const TIMETABLE_DAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export type TimetableDay = (typeof TIMETABLE_DAYS)[number];

/** 이어지는 교시로 보는 쉬는 시간 상한(분) — 운영실·오늘 출결의 묶음 규칙과 같은 값. */
const BREAK_MAX_MIN = 10;

export type TimetableEnrollment = {
  classId: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  /** 분리등원 — 비어 있으면 그 반의 모든 요일. */
  attendanceDays: readonly string[];
};
export type TimetableSlot = {
  classId: string;
  day: string;
  /** "HH:MM" */
  start: string;
  end: string;
  validFrom: string | null;
  validTo: string | null;
};
export type TimetableClass = { name: string; subjectLabel: string };

export type TimetableBlock = { classId: string; className: string; subjectLabel: string; start: string; end: string };
export type TimetableDayRow = { day: TimetableDay; ymd: string; blocks: TimetableBlock[] };

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

type RosterInput = { enrollments: readonly TimetableEnrollment[]; slots: readonly TimetableSlot[] };

/** 그 날짜(요일 `day`)에 실제로 듣는 교시 — 수강 중인 반 ∩ 그날 유효한 배치. 시간표와 "수업 있는 날"이 함께 쓴다. */
function liveSlotsOn(input: RosterInput, day: string, ymd: string): TimetableSlot[] {
  const attending = new Set(
    input.enrollments
      .filter(
        (e) =>
          !e.onHold &&
          e.startDate <= ymd &&
          (e.endDate === null || ymd <= e.endDate) &&
          (e.attendanceDays.length === 0 || e.attendanceDays.includes(day)),
      )
      .map((e) => e.classId),
  );
  return input.slots.filter(
    (s) =>
      s.day === day &&
      attending.has(s.classId) &&
      (s.validFrom === null || s.validFrom <= ymd) &&
      (s.validTo === null || ymd <= s.validTo),
  );
}

/**
 * **수업 있는 날** — 날짜 목록 중 그날 들을 교시가 하나라도 있는 날(학부모 월별 달력의 "등원하는 날" 표시, 사용자 2026-10-02).
 * 시간표와 같은 판정(`liveSlotsOn`)이라 달력에 표시된 날은 그 주 시간표에도 수업이 선다.
 */
export function classDatesOf(input: RosterInput & { dates: readonly { day: string; ymd: string }[] }): Set<string> {
  return new Set(input.dates.filter((d) => liveSlotsOn(input, d.day, d.ymd).length > 0).map((d) => d.ymd));
}

type BlockInput = RosterInput & { classes: ReadonlyMap<string, TimetableClass> };

/** 그 날짜의 수업 덩어리 — 이어지는 교시를 묶어 시각 순으로. */
function blocksOn(input: BlockInput, day: string, ymd: string): TimetableBlock[] {
  const live = liveSlotsOn(input, day, ymd).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const blocks: TimetableBlock[] = [];
  for (const s of live) {
    const last = [...blocks].reverse().find((b) => b.classId === s.classId);
    if (last && minutes(s.start) - minutes(last.end) <= BREAK_MAX_MIN) {
      if (s.end > last.end) last.end = s.end;
      continue;
    }
    const klass = input.classes.get(s.classId);
    blocks.push({
      classId: s.classId,
      className: klass?.name ?? "수업",
      subjectLabel: klass?.subjectLabel ?? "",
      start: s.start,
      end: s.end,
    });
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 날짜마다의 수업 — 학부모 **월별 달력** 칸에 과목과 시각을 적는 재료(사용자 2026-10-02). 수업 없는 날은 담지 않는다.
 * 주간 시간표와 같은 `blocksOn`이라 두 화면이 같은 수업·같은 시각을 말한다.
 */
export function classBlocksByDate(
  input: BlockInput & { dates: readonly { day: string; ymd: string }[] },
): Map<string, TimetableBlock[]> {
  const out = new Map<string, TimetableBlock[]>();
  for (const d of input.dates) {
    const blocks = blocksOn(input, d.day, d.ymd);
    if (blocks.length > 0) out.set(d.ymd, blocks);
  }
  return out;
}

export function buildChildTimetable(input: {
  /** 이번 주 요일별 날짜(월~금). */
  week: readonly { day: string; ymd: string }[];
  enrollments: readonly TimetableEnrollment[];
  slots: readonly TimetableSlot[];
  classes: ReadonlyMap<string, TimetableClass>;
}): TimetableDayRow[] {
  return TIMETABLE_DAYS.flatMap((day) => {
    const ymd = input.week.find((w) => w.day === day)?.ymd;
    if (!ymd) return [];
    return [{ day, ymd, blocks: blocksOn(input, day, ymd) }];
  });
}
