/**
 * 교재 차수 → (수업일, 교시) 배분 — **순수**(Vitest). 서버 액션·미리보기·기입이 **같은 답**을 내야 해서
 * 여기 한 곳에서만 정한다. 🔴 규칙을 SQL에도 적지 말 것 — 두 벌이 되면 화면의 미리보기와 실제 기입이
 * 갈린다(0266a RPC는 이 함수의 결과를 받아 쓰기만 한다).
 *
 * 원장 2026-09-16: *"영어 강사 시트에서 **연휴제외** 차수별로 들어가게 … 하루 수업이 2시간이면
 * **1시간씩 차수에 넣을지 2시간씩 차수 넣을지 선택** … **JJ실의 경우 자습실이라 별도**"*.
 *
 * 규칙 셋:
 *  ① **휴일은 차수를 소비하지 않는다.** 판정 자료는 학원설정 `operations.holidays` 하나
 *     ([`holiday.ts`](../class-sheets/lib/holiday.ts)) — 캘린더 탭 내장 법정공휴일 표가 아니다
 *     (법정공휴일 ≠ 학원 휴원일이고 이 학원은 실제로 공휴일에 수업한다).
 *     ⚠️ 휴일에도 **입력은 열려 있다**(ECS 규약) — 여기서 막는 건 "자동으로 차수를 밀어 넣는 것"뿐이다.
 *  ② **축(axis)이 둘이고 섞이지 않는다.** `class` = 정규 수업 교시(자리 아님) / `jj` = JJ(자습실) 교시.
 *     🔴 **LAB은 어느 축에도 안 들어간다** — ECS가 표시·집계에서 언제나 빼는 자리라, 여기서만 넣으면
 *     아무도 안 보는 칸에 기록이 쌓인다(`hiddenSeatOf`의 "LAB은 설정과 무관하게 언제나 제외").
 *  ③ **단위(pace)**: `period` = 교시 하나가 차수 하나(1시간씩) / `day` = 그 날 그 축의 **모든 교시**가
 *     같은 차수(2시간씩). 후자는 지어낸 규칙이 아니라 이미 쓰이는 패턴이다 — 실측(2026-09-16) 교시가
 *     둘 이상인 반-날짜 628건 중 **93건(15%)** 이 두 교시에 같은 (교재, 진도)를 적어 두고 있었다.
 */
import { slotsByDateOf, type MonthScheduleRow, type MonthSlot } from "@/features/class-sheets/lib/month-assemble";
import { holidayNameOn, type HolidayMap } from "@/features/class-sheets/lib/holiday";
import { shiftDays } from "@/features/timetable/lib/week";
import { SELF_STUDY_ROOM_LABEL } from "@/features/timetable/lib/teacher-label";

/** 차수를 태울 교시 축. LAB은 축이 아니다(위 ②). */
export type SlotAxis = "class" | "jj";
/** 차수 1개가 소비하는 단위. */
export type LessonPace = "period" | "day";

/**
 * 시작일부터 몇 날까지 훑을지의 상한. 200차수를 1차수/교시로 태워도(주 6교시 기준 ≈ 233일) 닿는 길이라
 * 넉넉하지만, 무한 루프·과도한 날짜 생성은 막는다. 여기서 끊기면 `unplaced`로 정직하게 보고한다.
 */
export const MAX_LOOKAHEAD_DAYS = 400;

/** 차수 하나가 앉을 자리 한 칸. 같은 `lessonNo`가 여러 칸에 앉을 수 있다(pace="day"). */
export type LessonTarget = { lessonNo: number; date: string; slotStart: string };

export type LessonSchedule = {
  /** 날짜·교시 순으로 정렬된 배치 결과. */
  targets: LessonTarget[];
  /** 자리가 모자라 배치하지 못한 차수 번호(상한까지 훑었는데도 수업일이 부족한 경우). */
  unplaced: number[];
  /** 휴일이라 건너뛴 수업일 — 화면이 "연휴 N일을 건너뛰었습니다"로 밝힌다. */
  skippedHolidays: { date: string; name: string }[];
  /** 마지막 차수가 앉은 날짜(없으면 null) — 미리보기 요약용. */
  lastDate: string | null;
};

/** 그 축에 해당하는 교시만 남긴다(시작시각 순은 `slotsByDateOf`가 이미 보장). */
export function slotsOfAxis(slots: readonly MonthSlot[], axis: SlotAxis): MonthSlot[] {
  // ⚠️ 자리 이름은 [`teacher-label.ts`]가 단일 소스다 — 여기 문자열을 박으면 이름이 바뀔 때
  //    JJ 축이 **조용히** 빈다(LAB 쪽은 `=== null`이라 그 위험이 없다).
  return slots.filter((s) => (axis === "jj" ? s.seat === SELF_STUDY_ROOM_LABEL : s.seat === null));
}

/** 시작일부터 `days`일치 날짜 문자열(오름차순). `slotsByDateOf`에 그대로 넘긴다. */
export function lookaheadDates(startDate: string, days: number): string[] {
  const n = Math.max(0, Math.min(days, MAX_LOOKAHEAD_DAYS));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(shiftDays(startDate, i));
  return out;
}

/**
 * 차수 번호 목록을 수업일·교시에 차례로 앉힌다.
 *
 * @param lessonNos 앉힐 차수 번호(오름차순·중복 없음이라고 가정 — 호출부가 만든다).
 */
export function buildLessonSchedule(input: {
  startDate: string;
  lessonNos: readonly number[];
  schedules: readonly MonthScheduleRow[];
  holidays: HolidayMap | null | undefined;
  axis: SlotAxis;
  pace: LessonPace;
  /** 훑을 날 수(기본 = 상한). 테스트·짧은 미리보기에서 줄여 쓴다. */
  lookaheadDays?: number;
}): LessonSchedule {
  const { startDate, lessonNos, schedules, holidays, axis, pace } = input;
  const dates = lookaheadDates(startDate, input.lookaheadDays ?? MAX_LOOKAHEAD_DAYS);
  const slotsByDate = slotsByDateOf(dates, schedules);

  const targets: LessonTarget[] = [];
  const skippedHolidays: { date: string; name: string }[] = [];
  let cursor = 0;
  let lastDate: string | null = null;

  for (const date of dates) {
    if (cursor >= lessonNos.length) break;
    const daySlots = slotsOfAxis(slotsByDate[date] ?? [], axis);
    // 수업이 없는 날은 휴일이어도 알리지 않는다 — 어차피 앉을 칸이 없어 "건너뛴 수업일"이 아니다.
    if (daySlots.length === 0) continue;

    const holidayName = holidayNameOn(holidays, date);
    if (holidayName !== null) {
      skippedHolidays.push({ date, name: holidayName });
      continue;
    }

    if (pace === "day") {
      const lessonNo = lessonNos[cursor]!;
      for (const slot of daySlots) targets.push({ lessonNo, date, slotStart: slot.slotStart });
      cursor += 1;
      lastDate = date;
      continue;
    }

    for (const slot of daySlots) {
      if (cursor >= lessonNos.length) break;
      targets.push({ lessonNo: lessonNos[cursor]!, date, slotStart: slot.slotStart });
      cursor += 1;
      lastDate = date;
    }
  }

  return { targets, unplaced: lessonNos.slice(cursor), skippedHolidays, lastDate };
}
