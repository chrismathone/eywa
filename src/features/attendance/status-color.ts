/**
 * 출결 상태 색 — **앱 전체 단일 소스**(순수 상수, 서버/클라 공용).
 *
 * 출결은 eywa에서 가장 여러 화면에 나오는 값이다(월간 출석부 격자 · 당일 출결 · 원스크린 알약 ·
 * ECS 체크 · 학생 상세 탭 · 자리 출석부). 2026-08-18 실측: 그 여섯 곳이 **'출석' 하나를 다섯 가지
 * 색**으로 그리고 있었다 — 민트(`--att-present`) · 네이비(`bg-primary`) · 초록(`chart-2`) ·
 * 네이비 틴트(`bg-primary-soft`) 각각. 조퇴는 파랑과 장미로 갈렸다. 화면을 옮길 때마다 색이 바뀌면
 * 색으로 상태를 읽는 법을 익힐 수가 없다(원장 2026-08-18: *"일치하는 곳의 색은 항상 일치"*).
 *
 * 색상(hue)은 의미색 캐논을 따른다:
 *   출석 = positive(green) · 결석/공결 = critical(danger) · 지각 = caution(amber) ·
 *   조퇴 = info(blue) · 보강 = special(purple).
 *
 * **채도는 자리마다 다르다** — 뜻이 아니라 밀도의 문제라 세 벌을 둔다:
 *   · `ATT_VIVID` = 31칸 격자 전용 **쨍한 원색**(`--att-*`). 한 화면에 수백 칸이라 옅은 틴트로는
 *     결석·지각을 훑어서 못 찾는다(원장 2026-07-21). ⚠️ 다른 화면에 쓰지 말 것.
 *   · `ATT_SOFT` = 칩·배지 몇 개짜리 화면(당일 출결·학생 상세). 앱 표준 -soft 틴트.
 *   · `ATT_SOLID` = **누른 상태**의 입력 알약(원스크린·ECS). 눌린 것이 확실히 보여야 한다.
 * 셋의 **색상은 같고 채도만 다르다** — 그래서 화면을 옮겨도 "같은 색 계열"로 읽힌다.
 */
export type AttendanceStatusKey =
  | "present"
  | "absent"
  | "excused"
  | "late"
  | "early_leave"
  | "makeup";

/** 31칸 격자 전용 — 쨍한 파스텔 원색. 다른 화면 금지. */
export const ATT_VIVID: Record<AttendanceStatusKey, string> = {
  present: "bg-att-present text-att-present-ink",
  absent: "bg-att-absent text-att-absent-ink",
  excused: "bg-att-absent text-att-absent-ink",
  late: "bg-att-late text-att-late-ink",
  early_leave: "bg-att-leave text-att-leave-ink",
  makeup: "bg-att-makeup text-att-makeup-ink",
};

/** 칩·배지 — 옅은 틴트 + 같은 색 글자. 테두리가 필요하면 `ATT_SOFT_BORDER`를 함께. */
export const ATT_SOFT: Record<AttendanceStatusKey, string> = {
  present: "bg-green-soft text-green",
  absent: "bg-danger-soft text-danger",
  excused: "bg-danger-soft text-danger",
  late: "bg-amber-soft text-amber",
  early_leave: "bg-blue-soft text-blue",
  makeup: "bg-purple-soft text-purple",
};

export const ATT_SOFT_BORDER: Record<AttendanceStatusKey, string> = {
  present: "border-green/25",
  absent: "border-danger/25",
  excused: "border-danger/25",
  late: "border-amber/25",
  early_leave: "border-blue/25",
  makeup: "border-purple/25",
};

/** 눌린 입력 알약 — 채움 + 흰 글자. "지금 이걸 골랐다"가 멀리서도 보여야 한다. */
export const ATT_SOLID: Record<AttendanceStatusKey, string> = {
  present: "bg-green text-white",
  absent: "bg-danger text-white",
  excused: "bg-danger text-white",
  late: "bg-amber text-white",
  early_leave: "bg-blue text-white",
  makeup: "bg-purple text-white",
};
