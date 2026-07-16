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

/**
 * 표시 행 목록 → 렌더 메타(학생 묶음 첫 행 여부·학생 묶음 순번). **표시 순서 기준**이라 순서 모드 재배열에도 정합.
 * 키보드 세로 이동(3-1)의 nav 인덱스 원천: 학생 단위 열(일일/확인 점수)은 studentRow(첫 행만),
 * 과목 단위 열(교재·오늘과제)은 행 렌더 인덱스를 쓴다 — 다과목 학생의 중복 점수칸에 Enter가 멈추지 않게(리뷰 확정 결함).
 */
export type RowRenderMeta = { firstOfStudent: boolean; studentRow: number };
export function buildRowRenderMeta(rows: readonly { student: { id: string } }[]): RowRenderMeta[] {
  let seq = -1;
  let prev: string | null = null;
  return rows.map((r) => {
    const first = r.student.id !== prev;
    if (first) seq += 1;
    prev = r.student.id;
    return { firstOfStudent: first, studentRow: seq };
  });
}

/** 저장·발송 대상 판정 — 오늘 진도가 입력된 행만(빈 보고서 방지). */
export function isReportEligible(subject: Subject): boolean {
  return !!subject.today && subject.today.trim().length > 0;
}

/**
 * 반 필터 매칭 — 특정 반 선택 시 그 반 소속 과목 행만(다과목/다반 학생의 타 반 행 혼입 차단).
 * classFilter=null("전체")면 전부. 반 모호(className=null, 같은 과목 두 반)는 통과(어느 반인지 못 가르므로 표시).
 */
export function rowInClass(subject: Subject, classFilter: string | null): boolean {
  if (!classFilter) return true;
  return subject.className == null || subject.className === classFilter;
}

// ───────────────────────── 결석 연동 — 작업별 대상 판정 (2-3) ─────────────────────────

export type RowAction = "save" | "send" | "autowrite";

/**
 * 행이 액션 대상인가 — 진도 입력은 공통 필수(빈 보고서 방지).
 * ⚠️ save=결석 포함(기록은 보존해야), send/autowrite=결석 제외(학부모 발송·AI 멘트 무의미).
 * 결석 판정은 행(반) 단위 raw(absent)만 — 조퇴(early_leave)는 수업을 들었으므로 발송 유지.
 */
export function isRowActionable(subject: Subject, action: RowAction): boolean {
  if (!isReportEligible(subject)) return false;
  if (action === "save") return true;
  return subject.attendanceRaw !== "absent";
}

/**
 * 일괄 발송 confirm 누락 요약(2-4) — **고유 학생 수** 기준(과목 행 수 아님).
 * 호출부가 결석 제외된(send 대상) 행만 넘기므로 결석 학생은 누락 카운트에 안 들어간다.
 */
export function summarizeSendGaps(
  rows: GridRow[],
  opts: { dailyEnabled: boolean; checkEnabled: boolean },
): { missingAttitude: number; missingTest: number } {
  const seen = new Set<string>();
  let missingAttitude = 0;
  let missingTest = 0;
  for (const r of rows) {
    if (seen.has(r.student.id)) continue;
    seen.add(r.student.id);
    if (!r.student.attitude) missingAttitude++;
    const t = r.student.tests;
    if ((opts.dailyEnabled && t.daily.score == null) || (opts.checkEnabled && t.check.score == null))
      missingTest++;
  }
  return { missingAttitude, missingTest };
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
