/**
 * 학생 학교+학년 표기 — 순수 함수(전역 공용). D:\ijw-calander\utils\studentUtils.ts verbatim 발췌를
 * exports/math-timetable/student-format.ts에서 승격(원 파일은 re-export shim, 기존 import 무변경).
 *
 * ⚠️ 표시 표준(디자인 규칙): 학교·학년을 함께 보여줄 땐 `schoolGradeLabel` — "경명여중"+"중1" → "경명여중1".
 * "경명여중 중1"처럼 공백 join으로 새로 만들지 말 것(시간표 셀·hover 카드와 표기 통일).
 */

/** 학년에서 숫자만 추출. "초3" -> "3" */
export const getGradeNumber = (grade: string | undefined | null): string => {
  if (!grade) return "";
  const match = grade.match(/\d+/);
  return match ? match[0] : grade;
};

/** 학년에서 레벨(초/중/고) 추출. "초3" -> "초", "3" -> "" */
export const getGradeLevel = (grade: string | undefined | null): string => {
  if (!grade) return "";
  if (grade.startsWith("초") || grade.includes("초등")) return "초";
  if (grade.startsWith("중") || grade.includes("중학")) return "중";
  if (grade.startsWith("고") || grade.includes("고등")) return "고";
  return "";
};

/** 학교명 + 학년 포맷팅. 시간표용 기본: "칠성초"+"초5" -> "5칠성초" (ijw 완전 일치 필수 — 변경 금지) */
export const formatSchoolGrade = (
  school: string | undefined | null,
  grade: string | undefined | null,
  options?: { numberLast?: boolean },
): string => {
  const schoolStr = school?.trim() || "";
  const gradeStr = grade?.trim() || "";

  if (!schoolStr && !gradeStr) return "-";
  if (!schoolStr) return gradeStr || "-";
  if (!gradeStr) return schoolStr;

  const gradeNum = getGradeNumber(gradeStr);
  const gradeLevel = getGradeLevel(gradeStr);

  if (options?.numberLast) {
    return `${schoolStr}${gradeNum}`;
  }

  const schoolEndsWithLevel =
    schoolStr.endsWith("초") || schoolStr.endsWith("중") || schoolStr.endsWith("고");

  if (schoolEndsWithLevel) {
    return `${gradeNum}${schoolStr}`;
  }

  if (gradeLevel) {
    return `${gradeStr}${schoolStr}`;
  }

  return `${gradeNum}${schoolStr}`;
};

/**
 * 학교·학년 표시 표준 — "경명여중"+"중1" → "경명여중1", "옥산초"+"초3" → "옥산초3".
 * 한쪽만 있으면 그것만("침산중" / "중1"), 둘 다 없으면 ""(호출부의 "—"/"-" 폴백 유지용 falsy).
 */
export const schoolGradeLabel = (
  school: string | undefined | null,
  grade: string | undefined | null,
): string =>
  !school?.trim() && !grade?.trim() ? "" : formatSchoolGrade(school, grade, { numberLast: true });
