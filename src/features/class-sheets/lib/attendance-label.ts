/**
 * ECS가 화면에 쓰는 **출결 상태 한글 라벨** 단일 소스 — 순수 모듈(Vitest).
 *
 * 왜 모았나: 같은 표를 그리는 컨트롤 셋(체크 순환 `attendance-check` · 오늘 카드 알약
 * `today-attendance-pills` · 퇴원 한 줄 요약)이 **각자 같은 맵을 복사**해 들고 있었다. 하나만 고치면
 * 같은 상태가 화면마다 다른 낱말로 읽히고, 빠뜨린 키는 raw enum(`early_leave`)이 그대로 새어 나간다
 * (UI에 영문 코드 노출 금지 — 반복 지적).
 *
 * ⚠️ 출석부의 [`STATUS_TEXT`](../../attendance/cell-display.ts)와 **일부러 다르다**: 그쪽은 공결을
 *    '결석'으로 접어 시수 0을 말하는 표기이고, 여기는 강사가 고른 상태를 **있는 그대로** 보여야 한다
 *    (공결을 결석이라 적으면 강사가 "내가 안 찍었는데?"가 된다). 두 맵을 합치지 말 것.
 */

/** attendance_status enum → 한글. 3종(출석·지각·결석) 밖은 ECS에서 표시만 하고 바꾸지 않는다. */
export const ATTENDANCE_LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

/**
 * 같은 상태의 영어 라벨 — 강사뷰 영어 화면(원장 2026-09-03 *"출석 결석 같은 출결 상태도"*).
 *
 * 🔴 **한글 맵 바로 옆에 둔다** — 두 파일로 나누면 상태가 하나 늘 때 한쪽만 채워지고, 빠진 키는
 *    raw enum(`early_leave`)이 화면에 그대로 샌다(이 파일이 애초에 생긴 이유).
 * ⚠️ 칸 폭이 한글 기준이라 **짧은 낱말**로 고른다(`Excused absence` 같은 두 낱말은 알약을 밀어낸다).
 */
export const ATTENDANCE_LABEL_EN: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  early_leave: "Left early",
  excused: "Excused",
  makeup: "Makeup",
};

/**
 * 표시 라벨. 모르는 값은 **그대로 돌려준다** — 화면에서 지우는 것보다 낫고(쓴 게 안 보이면 안 된다),
 * enum이 늘면 여기 한 줄만 더하면 된다.
 *
 * @param lang 없으면 한국어(기존 호출부는 한 글자도 안 바뀐다).
 */
export function attendanceLabelOf(
  status: string | null | undefined,
  lang: "ko" | "en" = "ko",
): string | null {
  if (!status) return null;
  // 🔴 영어 표가 그 상태를 모르면 **한글로 떨어진다** — 빈 칸·raw enum보다 낫다(사전 폴백 규약과 같다).
  if (lang === "en") return ATTENDANCE_LABEL_EN[status] ?? ATTENDANCE_LABEL[status] ?? status;
  return ATTENDANCE_LABEL[status] ?? status;
}
