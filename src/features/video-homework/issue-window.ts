/**
 * **따로 내는 영상 숙제**를 낼 수 있는 기간 — 순수(Vitest). 원장 2026-10-13:
 * *"그냥 단순하게 저기서 우클릭해서 숙제 출제 시키는걸로 (해당날짜에. 기한은 7일. 따로 보고서 안감. 개별통지해야함)
 *  대신 추가 숙제 출제 가능한건 해당 학생 해당 반의 다음 수업 전까지"*.
 *
 *  · 숙제는 **그 수업 날짜**의 숙제로 선다(낸 날이 아니다) — 제출 기한은 숙제일 + 7일(`SITE_HOMEWORK_DAYS` — 마감 저장값이 없다, due.ts).
 *  · 낼 수 있는 때 = 그 학생 × 그 반의 **다음 수업 전까지**. 다음 수업 =
 *      ① 숙제일 뒤(오늘 포함) 그 학생이 그 반에서 수업한 흔적(출결·수업보고서)이 있는 첫 날, 또는
 *      ② 숙제일 뒤 **어제까지** 시간표상 그 학생이 그 반 수업에 오는 첫 날(학원 휴원일 제외)
 *    중 이른 쪽. 오늘이 다음 수업일이어도 그 수업의 출결·보고서가 남기 전까지는 낼 수 있다(수업 전이다).
 *  · 그날 수업을 듣지 않은 학생(수강 전·휴원·결석)에게는 낼 수 없다 — 장부의 '숙제없음' 칸과 같은 판정(`blankReasonOn`).
 * 🔴 화면은 이 판정을 미리 하지 않는다(재료가 서버에만 있다) — 메뉴는 늘 뜨고, 서버가 거절하면 까닭을 말한다.
 */
import { addDays } from "@/lib/date-kst";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { rosterIncludesEnrollment } from "@/features/onescreen/roster-filter";
import type { LedgerEnrollment, LedgerSchedule } from "./ledger-roster";
import { blankReasonOn, type BlankAttendanceRow, type DaySlot } from "./no-homework";
import { VIDEO_HOMEWORK_MAX_DUE_DAYS } from "./due";

/** 이보다 오래된 수업에는 따로 숙제를 내지 않는다(자동 판정이 보는 기간과 같다). */
export const EXTRA_ISSUE_LOOKBACK_DAYS = 30;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const weekdayOf = (date: string) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
type Schedule = Pick<LedgerSchedule, "day_of_week" | "valid_from" | "valid_to">;
type Enrollment = LedgerEnrollment;

/** 시간표상 그 반이 그날 수업하는가(배치의 유효 기간 포함). */
export function classMeetsOn(schedules: readonly Schedule[], date: string): boolean {
  const day = weekdayOf(date);
  return schedules.some((row) => row.day_of_week === day && (!row.valid_from || date >= row.valid_from) && (!row.valid_to || date <= row.valid_to));
}

type LessonDay = { date: string; schedules: readonly Schedule[]; enrollments: readonly Enrollment[]; slots: readonly DaySlot[] };
type LessonProblem = "absent" | "outside" | "no_lesson" | "holiday";

/** 그날 이 학생이 이 반 수업을 들었나 — 못 들었으면 까닭(따로 내는 숙제 · 숙제없음 수업일 배정이 함께 쓴다). */
function lessonProblem(input: LessonDay): LessonProblem | null {
  const reason = blankReasonOn(input.date, input.enrollments, input.slots);
  if (reason === "absent") return "absent";
  if (reason !== "none") return "outside";
  // 출결 기록이 없으면 시간표로 본다 — 수업이 없는 요일에 숙제를 세우지 않는다.
  return input.slots.length || classMeetsOn(input.schedules, input.date) ? null : "no_lesson";
}

const ISSUE_MESSAGE: Record<Exclude<LessonProblem, "holiday">, string> = {
  absent: "결석한 날에는 영상 숙제를 낼 수 없습니다.",
  outside: "그날 이 반의 수강생이 아니어서 영상 숙제를 낼 수 없습니다.",
  no_lesson: "그날은 이 반 수업이 없었습니다.",
};

/** 그날이 이 학생이 이 반에서 **수업을 들은 날**인가 — 결석·수강 밖이면 까닭을 돌려준다. */
export function extraIssueLessonError(input: LessonDay): string | null {
  const problem = lessonProblem(input);
  return problem && problem !== "holiday" ? ISSUE_MESSAGE[problem] : null;
}

const BLANK_MESSAGE: Record<LessonProblem, string> = {
  absent: "결석한 날에는 영상을 붙일 수 없습니다.",
  outside: "그날 이 반의 수강생이 아니어서 영상을 붙일 수 없습니다.",
  no_lesson: "그날은 이 반 수업이 없었습니다.",
  holiday: "그날은 학원 휴원일이었습니다.",
};

/**
 * 이미 올라온 영상을 붙일 수 있는 **숙제없음 수업일**인가(원장 2026-10-22 '숙제없음 칸에 바로 배정') — 그 학생이 그 반 수업을 실제로 들은 날.
 * 판정은 따로 내는 숙제와 같다(`lessonProblem` — 결석 · 수강 밖 · 수업 없는 요일은 안 된다) + 출결 기록이 없는 학원 휴원일 · 종강 뒤 날은 뺀다
 * (숙제 0건 반의 줄은 시간표로 수업일을 깔아서, 빼지 않으면 쉬는 날 · 종강 뒤에 '숙제없음' 칸이 선다 — 명단의 종강 판정과 같게).
 * 🔑 출제 기한(`extraIssueWindow` — 다음 수업 전까지)은 보지 않는다 — 새 숙제를 내는 것이 아니라 이미 올라온 영상을 그 수업의 숙제로 기록하는 일이다.
 */
export function blankLessonError(input: LessonDay & { isHoliday: (date: string) => boolean; closedOn?: string | null }): string | null {
  const unrecorded = !input.slots.length;
  const problem = lessonProblem(input)
    ?? (unrecorded && input.closedOn && input.date > input.closedOn.slice(0, 10) ? "no_lesson" : null)
    ?? (unrecorded && input.isHoliday(input.date) ? "holiday" : null);
  return problem ? BLANK_MESSAGE[problem] : null;
}

type BlankLessonInput = { schedules: readonly Schedule[]; enrollments: readonly Enrollment[]; records: readonly BlankAttendanceRow[]; isHoliday: (date: string) => boolean;
  /** 반의 종강일(`classes.closed_at`) — 그 뒤 날은 출결이 없으면 수업일이 아니다. */
  closedOn?: string | null };
/** 출결 줄 → 날짜별 수업 상태(교시마다 최신 정정본 — 숙제없음 칸과 같다). */
function slotsByDate(records: readonly BlankAttendanceRow[]): Map<string, DaySlot[]> {
  const slots = new Map<string, DaySlot[]>();
  for (const row of effectiveAttendanceRecords(records)) slots.set(row.session_date, [...(slots.get(row.session_date) ?? []), { status: row.status }]);
  return slots;
}

/**
 * 기간 안의 숙제없음 수업일 전부(날짜순) — 장부의 숙제 0건 반 줄(칸) · 배정 창의 날짜 목록이 쓰고, 배정 저장은 같은 판정(`blankLessonDayError`)으로 다시 본다.
 * `records` = 그 반 × 학생의 출결(정정 전 줄 포함 — 여기서 최신본만 본다) · `exclude` = 이미 숙제가 있는 날(숙제 칸으로 고른다).
 */
export function blankLessonDates(input: BlankLessonInput & { fromDate: string; toDate: string; exclude?: ReadonlySet<string> }): string[] {
  const slots = slotsByDate(input.records);
  const dates: string[] = [];
  for (let date = input.fromDate; date <= input.toDate; date = addDays(date, 1)) {
    if (input.exclude?.has(date)) continue;
    if (!blankLessonError({ date, schedules: input.schedules, enrollments: input.enrollments, slots: slots.get(date) ?? [],
      isHoliday: input.isHoliday, closedOn: input.closedOn })) dates.push(date);
  }
  return dates;
}

/** 하루만 — 배정 저장의 검증(화면이 보낸 날짜를 믿지 않는다). 붙일 수 없으면 까닭. */
export function blankLessonDayError(input: BlankLessonInput & { date: string }): string | null {
  return blankLessonError({ date: input.date, schedules: input.schedules, enrollments: input.enrollments,
    slots: slotsByDate(input.records).get(input.date) ?? [], isHoliday: input.isHoliday, closedOn: input.closedOn });
}

/**
 * 숙제일 뒤(그날 제외) `before` 전까지 **시간표상** 그 학생이 그 반 수업에 오는 첫 날 — 학원 휴원일은 건너뛴다.
 * 반의 배치(요일·유효 기간)와 그 학생의 수강(수강 기간·휴원·분리 등원 요일 — `rosterIncludesEnrollment`)을 함께 본다.
 */
export function scheduledLessonAfter(input: {
  homeworkDate: string; before: string;
  schedules: readonly Schedule[]; enrollments: readonly Enrollment[];
  isHoliday: (date: string) => boolean;
}): string | null {
  for (let date = addDays(input.homeworkDate, 1); date < input.before; date = addDays(date, 1)) {
    if (input.isHoliday(date) || !classMeetsOn(input.schedules, date)) continue;
    const day = weekdayOf(date);
    if (input.enrollments.some((row) => rosterIncludesEnrollment(row, date, day, true))) return date;
  }
  return null;
}

/**
 * 영상 숙제 마감 '다음 수업'(원장 2026-10-15, due.ts) — 숙제일 뒤 `VIDEO_HOMEWORK_MAX_DUE_DAYS` 안의 첫 수업일. 없으면 null(호출부가 7일로 둔다).
 * 따로 낸 숙제의 '다음 수업 전까지'(아래)와 같은 판정이다 — 시간표로 다음 수업을 찾는 곳은 이 두 함수뿐이다.
 */
export function nextLessonDate(input: Omit<Parameters<typeof scheduledLessonAfter>[0], "before">): string | null {
  return scheduledLessonAfter({ ...input, before: addDays(input.homeworkDate, VIDEO_HOMEWORK_MAX_DUE_DAYS + 1) });
}

/** 다음 수업 전인가 — 지났으면 그 수업일을 돌려준다. */
export function extraIssueWindow(input: {
  homeworkDate: string; today: string;
  schedules: readonly Schedule[]; enrollments: readonly Enrollment[];
  isHoliday: (date: string) => boolean;
  /** 그 학생 × 그 반의 출결·수업보고서 날짜(숙제일 뒤 것만 본다). */
  lessonDates: readonly string[];
}): { open: true } | { open: false; nextLesson: string } {
  const recorded = input.lessonDates.filter((date) => date > input.homeworkDate && date <= input.today).sort()[0] ?? null;
  const scheduled = scheduledLessonAfter({ ...input, before: input.today });
  const next = [recorded, scheduled].filter((date): date is string => !!date).sort()[0];
  return next ? { open: false, nextLesson: next } : { open: true };
}
