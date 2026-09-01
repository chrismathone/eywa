/**
 * 월간 뷰 격자 조립 — 순수(Vitest). 조회(IO)는 [`month-queries`](../server/month-queries.ts)가 하고
 * "그 날 어떤 교시가 도는가"는 여기서만 정한다(주간 시트의 `buildWeekGrid`에 해당하는 자리).
 *
 * 🔴 **날짜 단위로 유효성을 건다**([[#88]]·`slotLiveOnDate`) — `class_schedules`는 운영 이력을 함께
 *    담아서(실측 1,068행 중 480행 만료) 행을 그대로 그리면 끝난 교시가 현재로 보이고, 배치가 바뀐 주엔
 *    같은 칸이 두 번 그려진다. 한 달은 그런 경계를 서너 번 지나므로 주간보다 더 자주 밟힌다.
 * 🔴 **자리(LAB·JJ) 판정은 `slot_teacher_label`뿐**(`specialSlotLabel` 단일 소스) — 이름으로 추측하지
 *    않는다. 자리는 반 진도가 아니라 학생 개별 진도라 경고 판정·목표 대조에서 통째로 빠진다.
 */
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import { specialSlotLabel, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { fillPct, isHolidayOn, tallyHolidayFill, type HolidayMap } from "./holiday";
import { dowKeyOf, normalizeSlotTime } from "./week";

export type MonthScheduleRow = {
  dayOfWeek: string;
  startTime: string;
  endTime: string | null;
  validFrom: string | null;
  validTo: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
};

export type MonthSlot = {
  slotStart: string;
  slotEnd: string | null;
  /** 시간표와 **같은 문자열**(표시 전용) — 권한 근거로 쓰지 말 것. */
  teacherLabel: string | null;
  roomLabel: string | null;
  /** 자리(LAB·JJ)면 그 이름, 아니면 null. */
  seat: SpecialSlotLabel | null;
};

/** 슬롯 키 — 계획 줄·교시 라벨이 공유하는 표기(`YYYY-MM-DD|HH:MM`). */
export function slotKey(date: string, slotStart: string): string {
  return `${date}|${normalizeSlotTime(slotStart)}`;
}

/**
 * 날짜 → 그 날 실제로 도는 교시(시작시각 순).
 * ⚠️ 같은 시각에 행이 둘 남아 있으면(이력 분할 직후) **먼저 온 행을 남긴다** — 시간표 축과 같은 규약
 *    ([[#106]] "앞을 유지"). 뒤엣것으로 덮으면 그 칸의 담당·강의실이 화면마다 달라진다.
 */
export function slotsByDateOf(
  dates: readonly string[],
  rows: readonly MonthScheduleRow[],
): Record<string, MonthSlot[]> {
  const out: Record<string, MonthSlot[]> = {};
  for (const date of dates) {
    const dow = dowKeyOf(date);
    const seen = new Set<string>();
    const slots: MonthSlot[] = [];
    for (const row of rows) {
      if (row.dayOfWeek !== dow) continue;
      if (!slotLiveOnDate({ dayOfWeek: row.dayOfWeek, validFrom: row.validFrom, validTo: row.validTo }, date)) {
        continue;
      }
      const start = normalizeSlotTime(row.startTime);
      if (seen.has(start)) continue;
      seen.add(start);
      slots.push({
        slotStart: start,
        slotEnd: row.endTime ? normalizeSlotTime(row.endTime) : null,
        teacherLabel: row.slotTeacherLabel,
        roomLabel: row.slotRoomLabel,
        seat: specialSlotLabel(row.slotTeacherLabel),
      });
    }
    slots.sort((a, b) => (a.slotStart < b.slotStart ? -1 : a.slotStart > b.slotStart ? 1 : 0));
    if (slots.length > 0) out[date] = slots;
  }
  return out;
}

/**
 * 작성률 — **배정된 전 교시**가 분모다.
 *
 * 🔴 표시 토글(자리 교시 접기)을 따라가지 않는다(원장 시안 확인 2026-08-31) — 접는 것만으로 숫자가
 *    좋아 보이면 계획을 안 쓴 자리 교시(실측 8/31 JJ)가 조용히 사라진다. 주간 시트의
 *    `showSelfStudy`가 분모까지 바꾸는 것과 **일부러 다르다**: 저쪽은 "보이는 교시 = 세는 교시"가
 *    계약이지만, 월간의 이 숫자는 한 달 전체를 대표하는 사실이라 보기에 따라 흔들리면 안 된다.
 * 🔴 **휴일은 [`holiday.ts`](./holiday.ts) 규약**을 탄다(안 쓴 휴일=분모 밖 · 쓴 휴일=대상=작성).
 *    맵을 안 넘기면 종전과 같다(전부 평일 취급).
 */
export function monthFillStats(
  slotsByDate: Record<string, MonthSlot[]>,
  hasLines: (date: string, slotStart: string) => boolean,
  holidays?: HolidayMap | null,
): { filled: number; total: number; pct: number } {
  const cells: { holiday: boolean; written: boolean }[] = [];
  for (const [date, slots] of Object.entries(slotsByDate)) {
    const holiday = isHolidayOn(holidays, date);
    for (const slot of slots) cells.push({ holiday, written: hasLines(date, slot.slotStart) });
  }
  const fill = tallyHolidayFill(cells);
  return { filled: fill.filled, total: fill.total, pct: fillPct(fill) };
}

/**
 * 그 날 계획을 안 쓴 교시 수 — 달력 칸의 `미작성 N` 배지.
 * 🔴 **휴일엔 0이다** — 안 쓴 휴일은 의무가 없어 재촉할 게 없다(작성률 분모에서 빼는 것과 같은 사실을
 *    칸에서 말하는 것뿐이다. 한쪽만 고치면 배지와 툴바 숫자가 서로 다른 말을 한다).
 */
export function unwrittenCountOf(
  slots: readonly MonthSlot[],
  date: string,
  hasLines: (date: string, slotStart: string) => boolean,
  holidays?: HolidayMap | null,
): number {
  if (isHolidayOn(holidays, date)) return 0;
  return slots.filter((s) => !hasLines(date, s.slotStart)).length;
}
