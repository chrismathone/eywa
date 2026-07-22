/**
 * 특강 판정 **단일소스** (순수 · Vitest) — 소비처는 **시간표의 정규/특강 구분**이다.
 *
 * 특강 = 방학 단기강좌. 판정 순서:
 *   ① `classes.is_special`(0133a 컬럼, 폼 토글) = true  → 특강
 *   ② 아니면 반 이름에 '특강' 포함(하위호환 폴백)      → 특강
 *
 * ⚠️ **급여와 공유하는 것은 ②(이름 규칙)뿐이다.** `payroll/salary-group.ts` `autoSalaryGroup`은
 *    이 모듈의 `hasSpecialLectureName`을 불러 이름 규칙만 한 곳에 모았고, **`is_special` 컬럼은 보지
 *    않는다**. 따라서 토글만 켠 반은 *시간표에선 특강, 급여 과정 분류에선 특강이 아니다*(수납관리의
 *    수동 과정 지정이 있으면 그 값). 이 갭은 알고 두는 것이다 — 급여를 컬럼에 맞추는 것은 배분율이
 *    달라지는 **돈 산식 변경**이라 골든마스터 게이트를 다시 통과해야 하고, 이번 범위 밖이다.
 *    폼의 특강 토글 문구(`class-special-fields.tsx`)가 이 한계를 사용자에게 그대로 말한다.
 *    ⚠️ 급여를 배선하게 되면 이 주석과 0133a 헤더, 토글 문구를 **같은 커밋에서** 함께 고칠 것.
 */

/** 반 이름 폴백 판정에 쓰는 키워드. ⚠️ 급여 과정 '특강' 라벨과 같은 문자열이어야 한다. */
export const SPECIAL_LECTURE_KEYWORD = "특강";

/** 화면 표시용 한글 라벨(raw 영문 코드 노출 금지 규칙). */
export const SPECIAL_LECTURE_LABEL = "특강";

/** 반 이름에 '특강'이 들어있는가 — 접두어가 아니라 **포함**(예 "고등M 수능특강"). */
export function hasSpecialLectureName(className?: string | null): boolean {
  return (className ?? "").trim().includes(SPECIAL_LECTURE_KEYWORD);
}

/**
 * 이 반이 특강인가. 컬럼(토글)이 이기고, 없으면 이름 폴백.
 * ⚠️ `isSpecial=false`라고 특강이 아님을 **확정하지 않는다**(이름 폴백이 살아있다) — 특강 해제는
 *    토글을 끄는 것만으로 부족하고 이름에서 '특강'도 빼야 한다. 이것이 급여와 어긋나지 않는 유일한 규칙.
 */
export function isSpecialLecture(input: {
  isSpecial?: boolean | null;
  className?: string | null;
}): boolean {
  return input.isSpecial === true || hasSpecialLectureName(input.className);
}
