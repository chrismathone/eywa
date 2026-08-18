/**
 * 캘린더(학원 공용 일정) 공용 타입·라벨. server-only 아님(클라 컴포넌트도 import).
 * eywa DB가 일정의 단일 진실(0218a 머리 주석 — 구글 상시 동기화 없음).
 */

/** 일정 표시 색 — Pill/soft 팔레트 키의 부분집합. DB는 안 잠그고 코드가 검증한다(0218a). */
export const EVENT_COLORS = ["primary", "blue", "green", "amber", "purple", "rose", "neutral"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

export const EVENT_COLOR_LABEL: Record<EventColor, string> = {
  primary: "네이비",
  blue: "파랑",
  green: "초록",
  amber: "호박",
  purple: "보라",
  rose: "장미",
  neutral: "회색",
};

export function isEventColor(v: string): v is EventColor {
  return (EVENT_COLORS as readonly string[]).includes(v);
}

export type CalendarEvent = {
  id: string;
  title: string;
  memo: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** HH:MM — 종일이면 null. */
  startTime: string | null;
  endTime: string | null;
  color: EventColor;
  createdByName: string | null;
};

/** 시간 표기 — "15:00" / "15:00~16:30" / 종일이면 null. 목록·칩이 공유. */
export function eventTimeLabel(e: Pick<CalendarEvent, "startTime" | "endTime">): string | null {
  if (!e.startTime) return null;
  return e.endTime ? `${e.startTime}~${e.endTime}` : e.startTime;
}
