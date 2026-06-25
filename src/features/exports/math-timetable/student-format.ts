/**
 * 학생 학교+학년 표기 — D:\ijw-calander\utils\studentUtils.ts verbatim 발췌.
 * ijw 시간표 셀의 "5칠성초" 형식을 그대로 재현(완전 일치 필수).
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

/** 학교명 + 학년 포맷팅. 시간표용 기본: "칠성초"+"초5" -> "5칠성초" */
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
