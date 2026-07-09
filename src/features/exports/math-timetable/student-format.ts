/**
 * 학생 학교+학년 표기 — 구현이 `src/lib/format/school-grade.ts`로 승격됨(전역 공용 표시 표준).
 * 이 파일은 re-export shim(기존 import 무변경). 새 코드는 `@/lib/format/school-grade`를 직접 import.
 */
export { getGradeNumber, getGradeLevel, formatSchoolGrade } from "@/lib/format/school-grade";
