/**
 * 선생님 원스크린 — 표(스프레드시트) 뷰 순수 헬퍼.
 * 카드↔표 토글의 표 쪽 행 구성·발송대상 판정을 순수 함수로 분리(CLAUDE.md: 계산 함수 분리+Vitest).
 */
import type { OneScreenStudent, PrevReport, Subject } from "./types";

/** 표 한 행 = (학생 × 과목). lesson_reports 1건·발송 1건과 1:1. */
export type GridRow = {
  student: OneScreenStudent;
  subject: Subject;
  subjectIndex: number;
  key: string; // `${student.id}::${subject.name}` — React key·상태 인덱싱
  index: number; // 표 전체 행 순번 — 키보드 세로 이동(data-nav-row, 3-1)
};

/** 학생 목록 → (학생 × 과목) 행 평탄화. 과목 순서 보존, 과목 없는 학생 제외(발송 단위가 과목). */
export function buildGridRows(students: OneScreenStudent[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const student of students) {
    student.subjects.forEach((subject, subjectIndex) => {
      rows.push({ student, subject, subjectIndex, key: `${student.id}::${subject.name}`, index: rows.length });
    });
  }
  return rows;
}

/** 저장·발송 대상 판정 — 오늘 진도가 입력된 행만(빈 보고서 방지). */
export function isReportEligible(subject: Subject): boolean {
  return !!subject.today && subject.today.trim().length > 0;
}

// ───────────────────────── 값 일괄 적용 (1-2) ─────────────────────────

/** 값 일괄 적용 patch — **비어 있는(undefined/공백) 필드는 적용하지 않는다**(값 지우기 아님 — 지우기는 개별 셀에서). */
export type BulkPatch = {
  attitude?: string;
  homework?: string;
  textbook?: string;
  homeworkToday?: string;
};

/** 일괄 적용 대상 행의 현재값(경량 shape — 테스트 용이). 태도·과제는 학생 단위, 교재·오늘과제는 과목(행) 단위. */
export type BulkTarget = {
  studentId: string;
  subjectName: string;
  attitude: string | null;
  homework: string;
  textbook: string;
  homeworkToday: string;
};

const normPatchField = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * 값 일괄 적용 계획 — patch에 채워진 필드만, onlyEmpty면 현재값이 빈 칸인 행만.
 * 태도·과제는 학생 단위 필드라 같은 학생의 두 번째 행부터는 중복 적용하지 않는다.
 */
export function planBulkApply(
  targets: BulkTarget[],
  patch: BulkPatch,
  onlyEmpty: boolean,
): Array<{ studentId: string; subjectName: string; set: BulkPatch }> {
  const p = {
    attitude: normPatchField(patch.attitude),
    homework: normPatchField(patch.homework),
    textbook: normPatchField(patch.textbook),
    homeworkToday: normPatchField(patch.homeworkToday),
  };
  const out: Array<{ studentId: string; subjectName: string; set: BulkPatch }> = [];
  const studentDone = new Set<string>(); // 학생 단위 필드(태도·과제) 중복 방지
  for (const t of targets) {
    const set: BulkPatch = {};
    const firstRowOfStudent = !studentDone.has(t.studentId);
    if (p.attitude !== undefined && firstRowOfStudent && (!onlyEmpty || !t.attitude)) set.attitude = p.attitude;
    if (p.homework !== undefined && firstRowOfStudent && (!onlyEmpty || !t.homework)) set.homework = p.homework;
    if (p.textbook !== undefined && (!onlyEmpty || !t.textbook.trim())) set.textbook = p.textbook;
    if (p.homeworkToday !== undefined && (!onlyEmpty || !t.homeworkToday.trim())) set.homeworkToday = p.homeworkToday;
    studentDone.add(t.studentId);
    if (Object.keys(set).length) out.push({ studentId: t.studentId, subjectName: t.subjectName, set });
  }
  return out;
}

// ───────────────────────── 이전 회차 가져오기 (1-3) ─────────────────────────

/** 이전 회차 가져오기 대상 행의 현재값. */
export type PrevFillCurrent = {
  today: string;
  attitude: string | null;
  homework: string;
  homeworkToday: string;
};

/** 이전 회차에서 채울 필드(빈 칸만). */
export type PrevFill = {
  today?: string;
  attitude?: string;
  homework?: string;
  homeworkToday?: string;
};

/**
 * 이전 회차 → 오늘 행 "빈 칸만" 채움 계획.
 * ⚠️ 특이사항은 제외 — prevReport.note(lesson_reports.notes)는 **학부모 발송 본문**이라 특이사항이 아니다(오염 방지).
 * ⚠️ 교재는 제외 — roster가 이미 직전 교재를 자동 승계한다.
 * 태도·과제는 현 학원 선택지에 있는 값만(옛 선택지 잔존값은 스킵).
 */
export function planPrevFill(args: {
  prev: PrevReport | undefined;
  current: PrevFillCurrent;
  attitudes: readonly string[];
  homeworks: readonly string[];
}): PrevFill {
  const { prev, current, attitudes, homeworks } = args;
  const out: PrevFill = {};
  if (!prev) return out;
  if (!current.today.trim() && prev.progress?.trim()) out.today = prev.progress;
  if (!current.attitude && prev.attitude && attitudes.includes(prev.attitude)) out.attitude = prev.attitude;
  if (!current.homework && prev.homeworkScore && homeworks.includes(prev.homeworkScore))
    out.homework = prev.homeworkScore;
  if (!current.homeworkToday.trim() && prev.homeworkToday?.trim()) out.homeworkToday = prev.homeworkToday;
  return out;
}
