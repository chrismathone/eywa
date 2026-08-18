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

/** 미취학 묶음 라벨 — 화면(필터 버킷·분포 막대)에서 6세·7세를 한 덩어리로 부를 때의 유일한 표기. */
export const PRESCHOOL_LABEL = "미취학";

/**
 * 미취학 표기 판별 — "7세"·"6세"·"미취학"·"유치(원)".
 *
 * 학년 자리에 초/중/고가 아닌 값이 들어온다(원장 2026-08-18: *"7세반도 문의가 오기 때문"* → 학원설정
 * 학년 목록에 미취학 학년 추가). 급간(초·중·고)을 가정하는 코드가 이 값을 만나면 숫자만 뽑아
 * "미취학7" 같은 표기를 만들거나 '모르는 값'으로 뒤로 밀어내므로, 판별을 한 곳에 둔다.
 */
export const isPreschoolGrade = (grade: string | undefined | null): boolean => {
  const g = String(grade ?? "").trim();
  // ⚠️ 나이는 **한 자리(3~7세)만** — `\d+세`로 넓히면 성인반 "20세"가 미취학으로 분류돼 출석부에서
  //    초1보다 앞으로 올라온다(적대적 리뷰 2026-08-18). 8세부터는 초등이라 여기 넣지 않는다.
  return /^[3-7]\s*세$/.test(g) || /^(미취학|유치)/.test(g);
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

  // 미취학(7세·6세)은 급간이 없다 — 숫자만 뽑으면 "Ing유치원7"·"미취학7"이 된다. 학교와 띄어 적는다
  // ("Ing유치원 7세"). 학교칸에도 "7세"를 적은 상담이 실측 30건이라 같은 값이 겹치면 학교만 남긴다.
  // ⚠️ ijw엔 미취학 학년이 없었다 — 아래 초/중/고 경로는 ijw verbatim 그대로다.
  if (isPreschoolGrade(gradeStr)) {
    return schoolStr.includes(gradeStr) ? schoolStr : `${schoolStr} ${gradeStr}`;
  }

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
