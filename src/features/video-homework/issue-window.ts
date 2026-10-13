/**
 * **따로 내는 영상 숙제**를 낼 수 있는 기간 — 순수(Vitest). 원장 2026-10-13:
 * *"그냥 단순하게 저기서 우클릭해서 숙제 출제 시키는걸로 (해당날짜에. 기한은 7일. 따로 보고서 안감. 개별통지해야함)
 *  대신 추가 숙제 출제 가능한건 해당 학생 해당 반의 다음 수업 전까지"*.
 *
 *  · 숙제는 **그 수업 날짜**의 숙제로 선다(낸 날이 아니다) — 제출 기한도 종전 규칙 그대로 숙제일 + 7일(`SITE_HOMEWORK_DAYS`).
 *  · 낼 수 있는 때 = 그 학생 × 그 반의 **다음 수업 전까지**. 다음 수업 =
 *      ① 숙제일 뒤(오늘 포함) 그 학생이 그 반에서 수업한 흔적(출결·수업보고서)이 있는 첫 날, 또는
 *      ② 숙제일 뒤 **어제까지** 시간표상 그 학생이 그 반 수업에 오는 첫 날(학원 휴원일 제외)
 *    중 이른 쪽. 오늘이 다음 수업일이어도 그 수업의 출결·보고서가 남기 전까지는 낼 수 있다(수업 전이다).
 *  · 그날 수업을 듣지 않은 학생(수강 전·휴원·결석)에게는 낼 수 없다 — 장부의 '숙제없음' 칸과 같은 판정(`blankReasonOn`).
 * 🔴 화면은 이 판정을 미리 하지 않는다(재료가 서버에만 있다) — 메뉴는 늘 뜨고, 서버가 거절하면 까닭을 말한다.
 */
import { addDays } from "@/lib/date-kst";
import { rosterIncludesEnrollment } from "@/features/onescreen/roster-filter";
import type { LedgerEnrollment, LedgerSchedule } from "./ledger-roster";
import { blankReasonOn, type DaySlot } from "./no-homework";

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

/** 그날이 이 학생이 이 반에서 **수업을 들은 날**인가 — 결석·수강 밖이면 까닭을 돌려준다. */
export function extraIssueLessonError(input: {
  date: string; schedules: readonly Schedule[]; enrollments: readonly Enrollment[]; slots: readonly DaySlot[];
}): string | null {
  const reason = blankReasonOn(input.date, input.enrollments, input.slots);
  if (reason === "absent") return "결석한 날에는 영상 숙제를 낼 수 없습니다.";
  if (reason !== "none") return "그날 이 반의 수강생이 아니어서 영상 숙제를 낼 수 없습니다.";
  // 출결 기록이 없으면 시간표로 본다 — 수업이 없는 요일에 숙제를 세우지 않는다.
  return input.slots.length || classMeetsOn(input.schedules, input.date) ? null : "그날은 이 반 수업이 없었습니다.";
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
  let scheduled: string | null = null;
  for (let date = addDays(input.homeworkDate, 1); date < input.today; date = addDays(date, 1)) {
    if (input.isHoliday(date) || !classMeetsOn(input.schedules, date)) continue;
    const day = weekdayOf(date);
    if (input.enrollments.some((row) => rosterIncludesEnrollment(row, date, day, true))) { scheduled = date; break; }
  }
  const next = [recorded, scheduled].filter((date): date is string => !!date).sort()[0];
  return next ? { open: false, nextLesson: next } : { open: true };
}
