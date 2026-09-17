import { schoolGradeLabel } from "@/lib/format/school-grade";

/** 검색에 쓰는 회차 행의 글자 칸 — 표에 보이는 것만(숫자·금액은 검색 대상이 아니다). */
export type TermSearchFields = {
  studentName: string;
  className: string | null;
  studentSchool?: string | null;
  studentGrade: string | null;
  homeroomTeacherName?: string | null;
  note: string | null;
};

/** 대소문자·공백을 무시한다 — `ps3a`로 `PS3A`, `개별토일`로 `고등M 개별 토일`을 찾는다. */
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * 회차 확정 상단 검색 — 표의 글자 열 전부(원장 2026-09-17 *"상단 검색도 추가된 행에 따라 더 검색이 용이하도록"*):
 * 이름 · 반 · 학교학년(`칠성초6`처럼 화면 표기 그대로도, 학교 원문도) · 담임 · 메모. 부분 일치.
 * 🔴 열을 더하면 여기에도 더할 것 — 화면에 보이는 글자로 못 찾으면 검색이 고장 난 것처럼 보인다.
 */
export function matchesTermQuery(row: TermSearchFields, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const hay = [
    row.studentName,
    row.className,
    schoolGradeLabel(row.studentSchool, row.studentGrade),
    row.studentSchool,
    row.homeroomTeacherName,
    row.note,
  ];
  return hay.some((v) => !!v && fold(v).includes(q));
}
