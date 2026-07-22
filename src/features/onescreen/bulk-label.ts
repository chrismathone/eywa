// 표 일괄 버튼 라벨 — 순수 함수(Vitest).
//
// ⚠️ 배경(2026-07-21 원장 제보 스크린샷): 37행을 선택했는데 버튼에 **"선택 0 저장"·"선택 0 발송"**이 떴다.
// 라벨의 숫자가 **선택 개수가 아니라 실제 동작 대상 수**인데 접두사는 "선택"이라, 사용자는 "37개 골랐는데
// 왜 0개 선택이지?"로 읽는다 — 화면이 사실과 다른 말을 하는 계열. 헤더는 이미 "선택 37 (발송가능 0)"처럼
// 둘을 나눠 말하고 있었는데 버튼만 뭉뚱그렸다.
//
// 규칙: 선택 수와 대상 수가 같으면 `선택 N`, 다르면 **`선택 N 중 M`** 으로 둘 다 밝힌다.

/**
 * @param selected 사용자가 체크한 행 수
 * @param actionable 그중 실제로 이 동작이 적용될 행 수(발송가능·저장가능·멘트 없는 행 등)
 */
export function bulkPickLabel(selected: number, actionable: number): string {
  return selected === actionable ? `선택 ${selected}` : `선택 ${selected} 중 ${actionable}`;
}
