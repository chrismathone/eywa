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

/** 일정 태그(0224a) — 테넌트 사전. 색은 태그에 한 번만(일정마다 복제 안 함). */
export type CalendarTag = {
  id: string;
  name: string;
  color: EventColor;
};

/**
 * 표시색 단일 규칙 — **태그가 있으면 태그색, 없으면 일정 자체 색**.
 * 월 그리드·하루 상세·연간/목록/분석 뷰가 전부 이걸 지나야 색이 갈리지 않는다.
 */
export function eventDisplayColor(e: Pick<CalendarEvent, "color" | "tag">): EventColor {
  return e.tag?.color ?? e.color;
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
  /**
   * 일정의 출처 — "manual" = 수기 등록(편집 가능) · "leave" = 전자결재 승인 휴가 오버레이
   * (읽기 전용 — 진실은 결재 문서라 캘린더에서 못 고친다. 휴가를 바꾸려면 문서를 회수·재기안).
   */
  source: "manual" | "leave";
  /**
   * 반복 일정 묶음(0222a) — 같은 반복 등록에서 태어난 회차들이 공유. null = 단발.
   * 규칙은 저장하지 않는다(등록 시점 실체화) — 있는 건 "한 시리즈"라는 사실뿐.
   */
  seriesId: string | null;
  /** 분류 태그(0224a) — null = 태그 없음(휴가 오버레이 포함). 표시색은 eventDisplayColor 경유. */
  tag: CalendarTag | null;
};

/** 시간 표기 — "15:00" / "15:00~16:30" / 종일이면 null. 목록·칩이 공유. */
export function eventTimeLabel(e: Pick<CalendarEvent, "startTime" | "endTime">): string | null {
  if (!e.startTime) return null;
  return e.endTime ? `${e.startTime}~${e.endTime}` : e.startTime;
}
