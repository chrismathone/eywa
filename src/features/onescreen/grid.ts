/**
 * 선생님 원스크린 — 표(스프레드시트) 뷰 순수 헬퍼.
 * 카드↔표 토글의 표 쪽 행 구성·발송대상 판정을 순수 함수로 분리(CLAUDE.md: 계산 함수 분리+Vitest).
 */
import type { OneScreenStudent, Subject } from "./types";

/** 표 한 행 = (학생 × 과목). lesson_reports 1건·발송 1건과 1:1. */
export type GridRow = {
  student: OneScreenStudent;
  subject: Subject;
  subjectIndex: number;
  key: string; // `${student.id}::${subject.name}` — React key·상태 인덱싱
};

/** 학생 목록 → (학생 × 과목) 행 평탄화. 과목 순서 보존, 과목 없는 학생 제외(발송 단위가 과목). */
export function buildGridRows(students: OneScreenStudent[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const student of students) {
    student.subjects.forEach((subject, subjectIndex) => {
      rows.push({ student, subject, subjectIndex, key: `${student.id}::${subject.name}` });
    });
  }
  return rows;
}

/** 저장·발송 대상 판정 — 오늘 진도가 입력된 행만(빈 보고서 방지). */
export function isReportEligible(subject: Subject): boolean {
  return !!subject.today && subject.today.trim().length > 0;
}
