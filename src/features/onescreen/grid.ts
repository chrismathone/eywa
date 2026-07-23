/**
 * 선생님 원스크린 — 표(스프레드시트) 뷰 순수 헬퍼.
 * 카드↔표 토글의 표 쪽 행 구성·발송대상 판정을 순수 함수로 분리(CLAUDE.md: 계산 함수 분리+Vitest).
 */
import type { OneScreenStudent, PrevReport, Subject } from "./types";

/**
 * 표 한 행 = (학생 × **반**). lesson_reports 1건·발송 1건과 1:1(0134a — 예전엔 과목 단위였다).
 * ⚠️ `subject.name`은 그래서 학생 안에서 유일하다(같은 과목 두 반이면 로스터가 반 이름을 덧붙인다).
 *    그 유일성이 깨지면 두 행이 같은 state·같은 보고서를 가리켜 서로를 덮는다.
 */
export type GridRow = {
  student: OneScreenStudent;
  subject: Subject;
  subjectIndex: number;
  key: string; // `${student.id}::${subject.name}` — React key·상태 인덱싱
};

/** 학생 목록 → (학생 × 과목) 행 평탄화. 과목 순서 보존, 과목 없는 학생 제외(발송 단위가 과목). */
/** 행 키 = `${studentId}::${subjectName}` — 선택·로딩·첨부 상태를 이 키로 인덱싱한다(문자열 조립 산재 금지). */
export const rowKey = (studentId: string, subjectName: string): string => `${studentId}::${subjectName}`;

export function buildGridRows(students: OneScreenStudent[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const student of students) {
    student.subjects.forEach((subject, subjectIndex) => {
      rows.push({ student, subject, subjectIndex, key: rowKey(student.id, subject.name) });
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
 * 이미 학부모 게시판에 올라간 보고서인가 — 발송 대상에서 뺄 유일한 상태.
 *
 * ⚠️ `success`만 본다. queued·processing은 "발송 진행 중"이라 서버가 따로 막고(in-flight 보호),
 *    failed·too_old·name_conflict는 **아직 학부모에게 안 갔으므로** 다시 시도할 수 있어야 한다.
 *    여기서 그 상태들까지 막으면 실패한 보고서를 강사가 영영 못 보낸다.
 */
export function isAlreadySent(status: string | null | undefined): boolean {
  // `already_sent`는 서버 액션의 **결과 코드**(DB 상태 아님)다. 호출부가 배지용으로 success로 정규화하지만,
  // 어딘가 그대로 흘러들어도 게이트가 fail-open 되지 않도록 여기서도 같이 인정한다(가드는 보수적으로).
  return status === "success" || status === "already_sent";
}

/**
 * 행이 액션 대상인가 — 진도 입력은 공통 필수(빈 보고서 방지).
 * ⚠️ save=결석·발송완료 포함(기록은 언제든 보존해야), send=결석·**발송완료** 제외, autowrite=결석 제외.
 * 결석 판정은 행(반) 단위 raw(absent)만 — 조퇴(early_leave)는 수업을 들었으므로 발송 유지.
 *
 * 발송완료 제외(2026-07-22): 일괄 발송을 두 번 누르면 그날 전원에게 게시글이 하나씩 더 붙었다
 * (ClassNote는 수정·삭제가 없어 되돌릴 수 없다). 서버(saveAndQueueClassnote)가 권위 있는 차단이고
 * 여기는 화면 게이트 — 버튼을 잠그고 일괄 대상에서 빼서 "눌렀는데 아무 일도 안 남"을 없앤다.
 * ⚠️ `subject.classnoteStatus`는 **로스터가 로드한 시점** 값이라 세션 중 방금 보낸 건을 모른다 →
 *    호출부(selectRows)가 화면 state의 최신 상태를 넣어 준다(`statusOverride`).
 */
/**
 * 이 행의 **실효** ClassNote 상태 — 화면 state가 로스터 스냅샷을 이긴다.
 *
 * 🔴 `undefined`(아직 모름)와 `null`(이번 세션에서 **명시적으로 지워짐**)을 구분하는 게 핵심이다.
 *    공유링크 재발급·첨부 변경은 서버가 상태를 리셋하고 화면도 지운다 — 그때 `?? 스냅샷`으로 읽으면
 *    **로스터가 실어 온 옛 "success"가 되살아나** 방금 푼 잠금이 그대로 다시 걸린다.
 *    그러면 재발급이 유일한 탈출구인데 그 탈출구가 새로고침 전까지 죽는다(적대 검수 확정).
 */
export function effectiveClassnoteStatus(
  live: string | null | undefined,
  snapshot: string | null | undefined,
): string | null | undefined {
  return live !== undefined ? live : snapshot;
}

export function isRowActionable(
  subject: Subject,
  action: RowAction,
  statusOverride?: string | null,
): boolean {
  if (!isReportEligible(subject)) return false;
  // 발송 완료 = **수정도 금지**(2026-07-22 원장 지시). ClassNote는 게시글 수정·삭제가 없어 학부모는
  // 발송 시점의 이미지를 그대로 갖고 있다 — 여기서 내용을 바꾸면 기록과 학부모가 본 것이 갈라진다.
  // 그래서 save·send·autowrite **전부** 막는다(예전엔 save만 열려 있었다).
  // 푸는 유일한 문 = 공유링크 재발급(그 건을 무효화 선언). 서버 saveLessonReport가 같은 규칙을 강제한다.
  if (isAlreadySent(statusOverride ?? subject.classnoteStatus)) return false;
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

/** 멘트 일괄 채우기 대상 행 — 직전 회차 멘트(lesson_reports.notes)와 오늘 초안. */
export type PrevCommentRow = {
  studentId: string;
  subjectName: string;
  prevNote: string | null | undefined; // prevReport.note = 직전에 학부모에게 보낸 멘트 본문
  currentDraft: string;
};

/** 멘트 일괄 채우기 계획 1건. */
export type PrevCommentPlan = { studentId: string; subjectName: string; comment: string };

/**
 * 직전 회차 **멘트** 일괄 채우기 계획 — 초안이 비어 있고 직전 멘트가 있는 행만.
 *
 * ⚠️ 멘트는 planPrevFill(진도·태도·과제)과 **분리**한다 — 이건 학부모에게 이미 나간 문장을 그대로 옮기는 것이라
 * 오늘 진도·점수와 어긋날 수 있다. 그래서 호출부가 별도 확인(ConfirmDialog)을 받은 뒤에만 적용한다.
 * ⚠️ 채워진 초안은 절대 덮지 않는다(빈 칸만 = 이 버튼의 계약).
 */
export function planPrevComments(rows: readonly PrevCommentRow[]): PrevCommentPlan[] {
  const out: PrevCommentPlan[] = [];
  for (const r of rows) {
    if (r.currentDraft.trim()) continue;
    const note = r.prevNote?.trim();
    if (!note) continue;
    out.push({ studentId: r.studentId, subjectName: r.subjectName, comment: note });
  }
  return out;
}

/** 일괄 채우기 대상 행 — planPrevFill 인자 + 학생/과목 식별자. */
export type PrevFillRow = {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  prev: PrevReport | undefined;
  current: PrevFillCurrent;
};

/** 일괄 채우기 계획 1건 — 그 행에 실제로 적용할 필드만 담긴다(빈 fill 행은 결과에서 제외). */
export type PrevFillPlan = { studentId: string; subjectName: string; subjectIndex: number; set: PrevFill };

/**
 * 이전 회차 **일괄** 채우기 계획 — 행 순서대로 planPrevFill을 돌리되 **학생 단위 필드(태도·과제)는 학생당 1회**만.
 *
 * ⚠️ 이 dedup이 핵심이다. 태도·과제는 학생 단위 값인데 행은 (학생×과목)이고, 호출부의 행 스냅샷은 루프 중
 * 갱신되지 않는다 → dedup이 없으면 다과목 학생의 모든 과목 행이 "아직 비었다"고 보고 각자의 직전 태도로
 * 덮어써 **마지막 과목 행이 이기는** 비결정 결과가 된다(채운 칸 수도 중복 계수). 첫 과목 행 값으로 확정한다.
 */
export function planBulkPrevFill(
  rows: readonly PrevFillRow[],
  attitudes: readonly string[],
  homeworks: readonly string[],
): PrevFillPlan[] {
  const studentFieldDone = new Set<string>();
  const out: PrevFillPlan[] = [];
  for (const r of rows) {
    const set = planPrevFill({ prev: r.prev, current: r.current, attitudes, homeworks });
    for (const f of ["attitude", "homework"] as const) {
      if (set[f] === undefined) continue;
      const k = `${r.studentId}::${f}`;
      if (studentFieldDone.has(k)) delete set[f];
      else studentFieldDone.add(k);
    }
    if (Object.keys(set).length) {
      out.push({ studentId: r.studentId, subjectName: r.subjectName, subjectIndex: r.subjectIndex, set });
    }
  }
  return out;
}

// ───────────────────────── 첫 행 내용 아래로 복사 (2026-07-23) ─────────────────────────

/**
 * 같은 수업을 들은 반은 **진도·교재·오늘 과제가 대체로 같다**. 그런데 표에서는 학생마다 진도 피커를
 * 다시 열어 고르고 있었다(원장 2026-07-23: "같은 진도일 때 일일이 진도선택 등 고르지 않도록").
 * → 맨 위 행에 한 번 입력하고 **아래 행 전부에 복사**한다.
 *
 * ⚠️ **복사하는 것은 '수업'이지 '학생'이 아니다.** 진도·교재·오늘 과제만 옮기고
 *    테스트 점수·태도·과제 수행·학부모 문구는 손대지 않는다 — 그건 학생마다 다른 **개별 사실**이라
 *    한 명의 값을 반 전체에 붙이면 기록이 거짓이 된다(태도·과제를 일부러 통일하려면 '값 일괄 입력'으로
 *    강사가 값을 **직접 골라** 넣는다).
 * ⚠️ **다른 과목 행에는 복사하지 않는다** — 수학 진도가 영어 행에 들어가면 학부모에게 그대로 나간다.
 * ⚠️ **발송 완료 행은 제외** — 발송분 수정 금지(원장 2026-07-22)와 같은 규칙.
 */
export type CopyRowValues = {
  subjectKey: string; // 과목 일치 판정 키(미지정은 "math"로 간주 — isMathSubject와 동일 규칙)
  today: string;
  textbook: string;
  homeworkToday: string;
};

export type CopyRowTarget = CopyRowValues & {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  actionable: boolean; // isRowActionable(subject, "save") — 발송 완료면 false
};

export type CopyRowPlan = {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  set: { today?: string; textbook?: string; homeworkToday?: string };
};

export type CopyRowResult = {
  plan: CopyRowPlan[];
  skippedSent: number; // 발송 완료라 건너뜀
  skippedSubject: number; // 과목이 달라 건너뜀
  skippedFilled: number; // 이미 값이 있어 건너뜀(덮어쓰기 끔)
};

/** 원본 행에서 실제로 복사할 값만 추린다(빈 값은 복사하지 않음 — 지우기가 아니다). */
export function copyableFields(source: CopyRowValues): { today?: string; textbook?: string; homeworkToday?: string } {
  const out: { today?: string; textbook?: string; homeworkToday?: string } = {};
  if (source.today.trim()) out.today = source.today;
  if (source.textbook.trim()) out.textbook = source.textbook;
  if (source.homeworkToday.trim()) out.homeworkToday = source.homeworkToday;
  return out;
}

export function planCopyFirstRow(
  source: CopyRowValues,
  targets: readonly CopyRowTarget[],
  opts: { overwrite: boolean },
): CopyRowResult {
  const fields = copyableFields(source);
  const srcKey = source.subjectKey || "math";
  const res: CopyRowResult = { plan: [], skippedSent: 0, skippedSubject: 0, skippedFilled: 0 };
  if (Object.keys(fields).length === 0) return res;

  for (const t of targets) {
    if (!t.actionable) {
      res.skippedSent++;
      continue;
    }
    if ((t.subjectKey || "math") !== srcKey) {
      res.skippedSubject++;
      continue;
    }
    const set: CopyRowPlan["set"] = {};
    if (fields.today !== undefined && (opts.overwrite || !t.today.trim())) set.today = fields.today;
    if (fields.textbook !== undefined && (opts.overwrite || !t.textbook.trim())) set.textbook = fields.textbook;
    if (fields.homeworkToday !== undefined && (opts.overwrite || !t.homeworkToday.trim()))
      set.homeworkToday = fields.homeworkToday;
    if (Object.keys(set).length === 0) {
      res.skippedFilled++;
      continue;
    }
    res.plan.push({ studentId: t.studentId, subjectName: t.subjectName, subjectIndex: t.subjectIndex, set });
  }
  return res;
}
