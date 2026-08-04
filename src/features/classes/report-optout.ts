/**
 * '수업보고서 미발송' 반 판정 **단일소스** (순수 · Vitest) — 0174a `classes.report_optout`.
 *
 * 원장 2026-08-03: 랩실 수업처럼 수업보고서를 쓰지 않는 반은 ① 보고서 작성·발송 화면의 **반 목록에서
 * 빠지고**("선생님이 헷갈릴 필요가 없게") ② **작성률 분모에서도 빠진다**("괜히 작성률도 0%로 오해받지 않게").
 *
 * 🔴 **이름 폴백을 만들지 않는다.** 형제인 `isSpecialLecture`는 반 이름에 '특강'이 있으면 특강으로 보는
 *    하위호환 폴백이 있지만, 여기엔 그런 이름 규칙이 존재하지 않는다(실측 2026-08-03: 살아있는 반 107개
 *    중 'LAB' 이름 0개, 'JJ'는 수학 반 코드 접미사일 뿐 랩실이 아니다). 이름으로 추측하면 반 이름을
 *    고치는 순간 분류가 조용히 뒤집힌다. **판정은 컬럼 하나뿐이다.**
 *
 * 🔴 이건 '숨김'이지 '차단'이 아니다. 이미 쓴 보고서의 수정·발송은 막지 않는다(원장 표현이 "발송하지
 *    **않아도 되게**" = 의무 면제이지 금지가 아니다). 저장·발송 게이트를 여기에 물리지 말 것 —
 *    물리면 그 반의 과거 이력이 잠긴다.
 *
 * ⚠️ 소비 표면을 새로 만들면 **여기를 함께 보게 하라**. 이 기능의 유일한 실패 모드는 "표면 하나를
 *    빠뜨림"(#77)이고, `report-optout-surfaces.test.ts`가 그걸 전수 스캔으로 잡는다.
 */

/** 화면 표시용 한글 라벨(raw 영문 코드 노출 금지 규칙) — 폼 토글·배지가 이 문자열을 쓴다. */
export const REPORT_OPTOUT_LABEL = "수업보고서 미발송";

/**
 * 이 반이 '수업보고서 미발송'인가.
 * DB에서 온 snake_case(`report_optout`)와 앱 camelCase(`reportOptout`) 둘 다 받는다 — 쿼리 매핑 전
 * raw row로 거르는 자리가 있어서(예: 임베드 select).
 */
export function isReportOptout(input: {
  reportOptout?: boolean | null;
  report_optout?: boolean | null;
}): boolean {
  return input.reportOptout === true || input.report_optout === true;
}

/** 미발송이 **아닌** 반만 남긴다 — 목록·로스터 필터의 표준 술어. */
export function keepReportedClasses<T extends { reportOptout?: boolean | null; report_optout?: boolean | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => !isReportOptout(r));
}
