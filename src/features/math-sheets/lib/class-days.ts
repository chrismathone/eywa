/**
 * MCS 월간 뷰의 **열** — 그 달에 이 반이 실제로 도는 날짜. 순수(Vitest).
 * 서버·클라가 함께 쓰므로 `server-only` 금지([[#61]]).
 *
 * ECS 월간은 "주 행 × 수업 요일 열"로 서지만 MCS는 **학생 행 × 수업일 열**이라 주 개념이 필요 없다.
 * 수학 반은 등원 요일이 1~2일뿐이라(실측: 1일 21반 / 2일 44반 / 4일 1반) 한 달이 4~9열에 들어온다.
 *
 * 🔴 **날짜 단위로 유효성을 건다**([[#88]]·`slotLiveOnDate`) — `class_schedules`는 운영 이력을 함께
 *    담아서 행을 그대로 세면 끝난 교시가 현재로 보인다. 한 달은 그런 경계를 서너 번 지난다.
 * 🔴 **하루는 한 열이다.** 수학은 반-요일당 2교시가 최빈(실측 83건 / 1교시 13 · 3교시 17)인데
 *    연속 2교시가 한 수업이라, 교시마다 열을 세우면 같은 수업이 두 번 그려지고 학생 한 명의 그날
 *    기록(lesson_reports는 **날짜 단위**라 교시가 없다)을 어느 칸에 넣을지 정할 수 없다.
 * ⚠️ 월 범위·달 이동·라벨은 [`date-kst`](@/lib/date-kst)가 단일 소스 — 여기서 다시 만들지 말 것.
 */
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import { monthDates, normalizeMonth } from "@/features/class-sheets/lib/month";
import { dowKeyOf, normalizeSlotTime } from "@/features/class-sheets/lib/week";

export { monthDates, normalizeMonth };

export type MathScheduleRow = {
  dayOfWeek: string;
  startTime: string;
  endTime: string | null;
  validFrom: string | null;
  validTo: string | null;
};

export type ClassDay = {
  /** YYYY-MM-DD */
  date: string;
  /** 그 날 도는 교시의 시작시각(오름차순) — 표시용 부제("14:30 · 15:25"). */
  slotStarts: string[];
};

/**
 * 그 달에 이 반이 도는 날 목록(오름차순). 교시가 하나도 안 도는 날은 열을 만들지 않는다.
 */
export function classDaysOf(month: string, rows: readonly MathScheduleRow[]): ClassDay[] {
  const out: ClassDay[] = [];
  for (const date of monthDates(month)) {
    const dow = dowKeyOf(date);
    const starts: string[] = [];
    for (const row of rows) {
      if (row.dayOfWeek !== dow) continue;
      // 행의 요일이 이미 이 날짜와 같으므로 `slotLiveOnDate`는 이 날짜 자신으로 유효기간을 판정한다.
      if (!slotLiveOnDate(row, date)) continue;
      const start = normalizeSlotTime(row.startTime);
      if (!starts.includes(start)) starts.push(start);
    }
    if (starts.length === 0) continue;
    starts.sort();
    out.push({ date, slotStarts: starts });
  }
  return out;
}

/** 열 부제 — "14:30 · 15:25". 교시가 하나면 그것만. */
export function slotTimesLabel(day: ClassDay): string {
  return day.slotStarts.join(" · ");
}
