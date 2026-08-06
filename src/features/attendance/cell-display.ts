// 출석부 셀 표기 — 숫자 + 배경색. 순수 함수(Vitest).
//
// 2026-07-21 원장 규칙(구 출석부 표기 관행):
//   출석·지각·조퇴·보강 = **시수 숫자**(기본 1, 배수면 1.5·2), 결석 = **0**.
//   색은 전부 **배경색**으로 — 출석 민트 / 지각 주황 / 결석 빨강 / 조퇴 파랑 / 보강 보라.
// ⚠️ O·X·L 같은 글자 표기로 되돌리지 말 것(원장 지시로 폐기).

import { formatSessionUnits } from "./session-units";

export type AttendanceMark = "present" | "absent" | "late" | "excused" | "makeup" | "early_leave";

/**
 * 상태별 배경(+글자색) = **쨍한 파스텔 원색**(`--att-*`, globals.css).
 * 2026-07-21 원장 교정: *"형광색은 날짜가 아니라 학생 출결 1의 배경 · 색도 더 쨍하게"* —
 * 앱 표준 -soft 토큰(8~22% 틴트)으로는 31칸 격자에서 결석·지각이 안 튀었다.
 * ⚠️ 색을 다시 -soft 틴트로 낮추지 말 것. 이 팔레트는 출석부 전용이며 다른 화면에 쓰지도 말 것.
 */
export const STATUS_TONE: Record<AttendanceMark, string> = {
  present: "bg-att-present text-att-present-ink",
  absent: "bg-att-absent text-att-absent-ink",
  excused: "bg-att-absent text-att-absent-ink",
  late: "bg-att-late text-att-late-ink",
  early_leave: "bg-att-leave text-att-leave-ink",
  makeup: "bg-att-makeup text-att-makeup-ink",
};

/**
 * 날짜 성격 배경 — 헤더·본문이 **같은 상수**를 써야 열이 위아래로 어긋나지 않는다.
 * · 수업하는 요일(기록 전) = 아주 옅은 민트(출석 민트의 옅은 버전 — "찍어야 할 칸"이지 출결 표시가 아니다)
 * · 수업 없는 평일 = 흰색  · 주말·공휴일 = 회색
 * ⚠️ 여기(날짜)에 쨍한 색을 주면 출결 표시와 헷갈린다 — 쨍한 색은 STATUS_TONE(1의 배경)만.
 */
export const DAY_TONE = {
  classDay: "bg-att-classday",
  weekend: "bg-att-weekend",
} as const;

/**
 * 고정 표 헤더의 높이 — **이 두 값은 반드시 같아야 한다.**
 *
 * 🔴 방향키로 위로 이동하면 `scrollIntoView({block:"nearest"})`가 활성 칸을 스크롤포트 **맨 위**에 붙이는데,
 *    그 자리는 sticky 헤더가 덮고 있다 → 활성 칸이 헤더 뒤로 **통째로 사라진다**(2026-08-06 실측: 37px 겹침,
 *    화면상 "방향키를 눌렀는데 커서가 없어짐"). `scroll-margin-top`을 헤더 높이만큼 주면 브라우저가 그만큼
 *    더 스크롤해 칸을 **헤더 바로 아래**에 세운다.
 * ⚠️ 헤더 높이를 바꾸면 `CELL_SCROLL_MARGIN`도 같이 바꿀 것. Tailwind가 스캔하도록 **리터럴 문자열**로 둔다
 *    (템플릿 조합 `scroll-mt-[${n}px]`은 JIT가 못 잡아 클래스가 생성되지 않는다).
 */
export const HEAD_ROW_H = "h-[38px]";
export const CELL_SCROLL_MARGIN = "scroll-mt-[38px]";

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
