// ECS 주차/기간 순수 유틸 — timetable/lib/week.ts(월요일 시작 규약)를 재사용하고 ECS 전용 정규화만 추가.
// ⚠️ server-only 금지 — 클라 컴포넌트(주 네비·저장 큐)도 import.
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/** 요일 enum 키(class_schedules.day_of_week) — 날짜에서 파생. */
export type DowKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DOW_BY_UTC_DAY: readonly DowKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function dowKeyOf(ymd: string): DowKey {
  return DOW_BY_UTC_DAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

/** 그 주 월요일부터 7일(월~일) 날짜 배열. */
export function weekDatesOf(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));
}

/**
 * class_sheet_goals.period_start 정규화 — week=그 주 월요일 / month=그 달 1일.
 * DB CHECK(0155a)와 같은 규약(어긋난 값은 저장 자체가 거부되므로 액션이 반드시 이걸 거친다).
 */
export function normalizePeriodStart(scope: "month" | "week", ymd: string): string {
  if (scope === "week") return mondayOf(ymd);
  return `${ymd.slice(0, 7)}-01`;
}

/** DB time("HH:MM:SS")·입력("HH:MM")을 "HH:MM"로 통일 — 슬롯 키 비교의 단일 표기. */
export function normalizeSlotTime(t: string): string {
  return t.slice(0, 5);
}
