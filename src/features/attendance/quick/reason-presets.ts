/**
 * '출결 모드' **사유 프리셋** — 터치 한 번으로 고르는 미리 정해진 사유(순수 상수, Vitest).
 *
 * 원장 2026-08-20: *"결석에도 사유입력을 미리 정해둔거에서 터치로 간단하게. (필요하면 타이핑)"*
 *
 * 🔑 목록은 취향이 아니라 **실측**이다(프로덕션 injaewon `attendance_records.note`, 최근 1년 결석 사유
 *    상위): `여행`(91) · `가족여행`(31) · `휴가`(16) · `병결`(13) · `가족일정`(13) · `캠프`(12).
 *    나머지 셋(`병원`·`학교 행사`·`개인사정`)은 같은 표에서 꾸준히 나오되 표기가 여럿으로 갈려 있어
 *    대표 표기 하나로 고정한다 — 칩을 쓰면 표기가 모이고, 표기가 모이면 분류기가 더 잘 맞는다.
 *
 * 🔴 이 문자열은 그대로 `attendance_records.note`가 되고, [`classifyAbsenceReason`](../absence-reason.ts)이
 *    그걸 읽어 '오늘 출결'·'어제 요약'의 **긴급 여부**를 정한다. 결석 칩이 하나라도 `unknown`으로
 *    분류되면 사유를 골랐는데 화면은 "연락 안 됨 긴급"이라고 말한다 — 그 정합은 테스트가 잠근다
 *    (`reason-presets.test.ts`). 칩을 더할 땐 분류기 사전에 그 말이 있는지 **먼저** 볼 것.
 *
 * ⚠️ **v1은 코드 상수다.** 학원설정(`operations.*`)으로 빼려면 스키마·기본값·폼·소비처·검증 5단계
 *    배선이 필요하고(CLAUDE.md 「학원 설정」), 소비처 없는 설정 필드는 만들지 않는 것이 이 저장소의
 *    규칙이다. 원장이 목록을 직접 고치고 싶어지면 그때 5단계로 옮긴다.
 * ⚠️ 지각 사유는 **분류기 대상이 아니다** — `classifyAbsenceReason`은 결석·공결 행에만 걸린다
 *    (`recap/digest.ts`). 그래서 지각 칩은 실데이터 자유 텍스트에서 자주 나온 말을 그대로 쓴다.
 */

/** 결석 사유 칩 — 순서 = 실측 빈도(위가 많이 쓰인다). '직접 입력'은 화면이 따로 붙인다. */
export const ABSENCE_REASON_PRESETS = [
  "여행",
  "가족여행",
  "휴가",
  "병결",
  "가족일정",
  "캠프",
  "병원",
  "학교 행사",
  "개인사정",
] as const;

/** 지각 사유 칩 — 실측 자유 텍스트에서 추린 네 가지. 메모 뒤에 `· 사유`로 붙는다. */
export const LATE_REASON_PRESETS = [
  "학교 종례 늦음",
  "버스 놓침",
  "시간 착각",
  "다른 학원",
] as const;

export type AbsenceReasonPreset = (typeof ABSENCE_REASON_PRESETS)[number];
export type LateReasonPreset = (typeof LATE_REASON_PRESETS)[number];
