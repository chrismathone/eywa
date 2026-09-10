/**
 * 반 스케줄을 **요일 묶음 + 교시 라벨**("월·목 1-3교시")로 접는 순수 모듈.
 *
 * 원래 [`students/server/queries.ts`](../students/server/queries.ts) 안에 있던 것을 그대로 꺼냈다
 * (2026-09-10) — 등록상담 상세의 '배정된 반' 카드가 같은 표기를 써야 하는데, 그쪽은 server-only
 * 모듈이라 끌어다 쓸 수 없었고 베껴 쓰면 같은 반이 화면마다 다른 스케줄로 적힌다.
 *
 * 🔴 **교시 라벨은 학원설정이 단일 소스**다 — `slotPeriodRow`/`periodRowText`가 과목별 교시표
 *    (`weekdayTableFor`)까지 해석하므로, 호출부는 `settingsToPeriodsConfig(settings.operations)`로
 *    만든 `PeriodsConfig`를 **반드시** 넘긴다(무config 호출은 커스텀 교시 라벨이 틀어진다).
 * ⚠️ 만료 배치([[#88]]) 걸러내기는 **호출부 몫**이다 — 이 함수는 받은 슬롯을 그대로 접는다.
 *    (`slotPhase(slot, today) === "current"`로 거르고 넘길 것.)
 */

import {
  slotPeriodRow,
  periodRowText,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { mergeTimeRanges } from "./schedule-summary";

const KO_DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

export type ScheduleGroup = { days: string[]; label: string }; // {days:["월","목"], label:"1~3교시"}

// 연속 교시 번호를 범위로 병합: [3,4,5,6]→"3-6교시", [2,3,5]→"2-3, 5교시", [2]→"2교시".
export function mergePeriodRanges(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const out: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (n !== undefined) {
      start = n;
      prev = n;
    }
  }
  return `${out.join(", ")}교시`;
}

// 요일별로 교시 묶기(같은 요일 연속 교시는 N-M으로 병합) → 같은 라벨 요일끼리 합침("월목 1-3교시 / 화금 1-4교시").
// attendanceDays 있으면 그 요일만(분리등원).
// 교시 이름이 없어 시간대로 나오는 슬롯(영어 등)은 **붙은 구간을 이어** 한 구간으로(2026-08-18 원장
// "영어 수업을 스마트하게" — 40분 교시 나열 `16:20~17:20, 17:20~18:10` → `16:20~18:10`). 이름 있는
// 커스텀 교시 라벨은 시간이 아니라 이름이 정보라 병합 대상이 아니다(그대로 나열).
export function groupSchedule(
  slots: { day: DayOfWeek; startTime: string; endTime: string }[],
  subj: string,
  attendanceDaysKo: string[],
  config: PeriodsConfig,
): ScheduleGroup[] {
  const TIME_RANGE = /^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/;
  // 1) 요일 → 교시번호[] + 시간대 구간[] + 그 외 원라벨[]
  const byDay = new Map<string, { nums: number[]; ranges: { start: string; end: string }[]; other: string[] }>();
  for (const s of slots) {
    const dayKo = enumDayToKo(s.day);
    if (attendanceDaysKo.length > 0 && !attendanceDaysKo.includes(dayKo)) continue;
    // 테넌트 설정 교시(과목별 override 포함)로 라벨 해석 — 무config 호출은 커스텀 교시 저장 시 라벨이 틀어진다(2026-07-06).
    // 여긴 시각을 따로 안 그리는 자리라, 이름을 비운 교시는 시간대로 대체한다(periodRowText).
    // endTime까지 넘겨 (시작,종료) 짝 우선 매칭 — 시작시각이 같은 두 교시 오매핑 방지(#106).
    const label = periodRowText(slotPeriodRow(subj, s.startTime, s.day, config, s.endTime));
    const entry = byDay.get(dayKo) ?? { nums: [], ranges: [], other: [] };
    const m = label.match(/^(\d+)교시$/);
    if (m) entry.nums.push(Number(m[1]));
    // 시간대 라벨이면 병합 후보 — 라벨의 교시표 시각이 아니라 **슬롯 실제 시각**으로 잇는다(사실 우선).
    else if (TIME_RANGE.test(label)) entry.ranges.push({ start: s.startTime, end: s.endTime });
    else entry.other.push(label);
    byDay.set(dayKo, entry);
  }
  // 2) 요일별 라벨(교시 연속 병합 + 붙은 시간 구간 병합)
  const dayLabel = new Map<string, string>();
  for (const [day, { nums, ranges, other }] of byDay) {
    const mergedRanges = mergeTimeRanges(ranges).map((r) => `${r.start}~${r.end}`);
    const parts = [mergePeriodRanges(nums), ...mergedRanges, ...[...new Set(other)]].filter(Boolean);
    dayLabel.set(day, parts.join(", "));
  }
  // 3) 같은 라벨 요일끼리 묶기
  const byLabel = new Map<string, Set<string>>();
  for (const [day, label] of dayLabel) {
    const set = byLabel.get(label) ?? new Set<string>();
    set.add(day);
    byLabel.set(label, set);
  }
  const groups = [...byLabel.entries()].map(([label, days]) => ({
    label,
    days: [...days].sort((a, b) => KO_DAY_ORDER.indexOf(a) - KO_DAY_ORDER.indexOf(b)),
  }));
  groups.sort((a, b) => KO_DAY_ORDER.indexOf(a.days[0] ?? "") - KO_DAY_ORDER.indexOf(b.days[0] ?? ""));
  return groups;
}
