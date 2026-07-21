// 출석부 셀 표기 — 숫자 + 배경색. 순수 함수(Vitest).
//
// 2026-07-21 원장 규칙(구 출석부 표기 관행):
//   출석·지각·조퇴·보강 = **시수 숫자**(기본 1, 배수면 1.5·2), 결석 = **0**.
//   색은 전부 **배경색**으로 — 지각 주황 / 결석 빨강 / 보강 연보라 / 조퇴 연파랑 / 출석 기본(브랜드 연톤).
// ⚠️ O·X·L 같은 글자 표기로 되돌리지 말 것(원장 지시로 폐기).

import { formatSessionUnits } from "./session-units";

export type AttendanceMark = "present" | "absent" | "late" | "excused" | "makeup" | "early_leave";

/**
 * 상태별 배경(+글자색). **출석(정상)이 가장 옅고, 특수 상태 4종은 채도를 올려** 훑을 때 바로 튄다.
 * ⚠️ 조퇴를 `blue-soft`(9%)로 두면 출석의 `primary-soft`(네이비 8%)와 사실상 구분이 안 된다
 * (v3에서 primary가 네이비가 되며 blue와 색상각 4.8° — globals.css 주석). 그래서 특수 상태는 20~22%.
 */
export const STATUS_TONE: Record<AttendanceMark, string> = {
  present: "bg-primary-soft text-primary",
  absent: "bg-danger/22 text-danger",
  excused: "bg-danger/22 text-danger",
  late: "bg-amber/22 text-amber",
  early_leave: "bg-blue/22 text-blue",
  makeup: "bg-purple/20 text-purple",
};

/**
 * 날짜 성격 배경(원장 2026-07-21) — 헤더·본문이 **같은 상수**를 써야 열이 위아래로 어긋나지 않는다.
 * · 수업하는 요일 = 민트(green 계열 — 출결 5색 primary/danger/amber/blue/purple과 겹치지 않는 유일한 색상)
 * · 수업 없는 평일 = 흰색(클래스 없음)  · 주말·공휴일 = 회색
 */
export const DAY_TONE = {
  classDay: "bg-green/15",
  weekend: "bg-bg-soft/70",
} as const;

export const STATUS_TEXT: Record<AttendanceMark, string> = {
  present: "출석",
  absent: "결석",
  excused: "결석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
};

/** 결석은 시수를 소비하지 않으므로 언제나 0. 나머지는 시수(미입력=1). */
export function markNumber(status: AttendanceMark, units: number | null | undefined): string {
  if (status === "absent" || status === "excused") return "0";
  const u = units ?? 1;
  return Number.isFinite(u) && u > 0 ? formatSessionUnits(u) : "1";
}

export type CellDisplay = { text: string; className: string };

/**
 * 셀 한 칸의 배경 = 그 날의 성격(원장 규칙 2026-07-21): **수업하는 요일 민트 · 수업 없는 평일 흰색 · 주말 회색**.
 * @param attendDay 그 학생이 그 요일에 등원하는지(수업요일 하이라이트)
 * @param muted 주말·공휴일 등 수업이 없는 날(회색)
 */
export function cellDisplay(
  status: AttendanceMark | null,
  units: number | null | undefined,
  opts: { attendDay?: boolean; muted?: boolean } = {},
): CellDisplay {
  if (status) return { text: markNumber(status, units), className: STATUS_TONE[status] };
  if (opts.muted) return { text: "·", className: `text-text-faint ${DAY_TONE.weekend}` };
  if (opts.attendDay) return { text: "·", className: `text-text-faint ${DAY_TONE.classDay}` };
  return { text: "·", className: "text-text-faint" };
}
