/**
 * 강사 원스크린 — ClassNote 발송 상태 따라잡기 순수 로직(계산 함수는 분리 + Vitest, CLAUDE.md).
 * 화면 state를 서버가 알려준 상태로 **병합**하는 규칙이 여기 한 곳에만 있다.
 */

export type ClassnoteStatusRow = {
  studentId: string;
  subject: string | null;
  /** 이 보고서의 반(0134a). 같은 과목 두 행(정규+특강)을 가르는 유일한 축 — 없으면 과목으로 폴백. */
  classId?: string | null;
  status: string | null;
};

/** 아직 결과가 안 나온 발송(워커가 처리 중) — 이 학생들이 있는 동안만 상태를 다시 읽는다. */
export const PENDING_STATUSES = ["queued", "processing"] as const;

type HasStatus = { classnoteStatus?: string };

/** 발송 대기·처리중인 학생 id — 비어 있으면 감시할 게 없다(조회 0회). */
export function pendingSendStudentIds(reports: Record<string, Record<string, HasStatus>>): string[] {
  const out = new Set<string>();
  for (const [studentId, bySubject] of Object.entries(reports)) {
    for (const rep of Object.values(bySubject)) {
      if (rep.classnoteStatus && (PENDING_STATUSES as readonly string[]).includes(rep.classnoteStatus)) {
        out.add(studentId);
      }
    }
  }
  return [...out].sort();
}

/**
 * 서버가 알려준 발송 상태를 화면 state에 병합한다. 변화가 없으면 **같은 참조를 그대로 반환**(불필요한 리렌더 방지).
 *
 * ⚠️ 두 가지 안 하는 것이 중요하다:
 *  ① `status`가 비어 있는 행은 **무시** — 발송 직전에 출발한 조회가 방금 누른 '대기'를 지워 "안 보낸 것처럼"
 *     보이게 하는 역전을 막는다.
 *  ② 화면에 없는 (학생, 과목)은 건드리지 않는다 — 다른 강사 담당 과목이 강사 화면에 새로 생기면 안 된다.
 *
 * `rowNameOf`: 보고서 행(반 + 과목키)을 이 화면의 **행 이름**으로 바꾸는 함수(state 키가 행 이름이라).
 * ⚠️ 반을 먼저 본다 — 같은 과목 두 행(정규 수학 + 수학 특강)은 과목키가 같아서 과목만으론 못 가른다.
 */
export function mergeClassnoteStatuses<T extends HasStatus>(
  prev: Record<string, Record<string, T>>,
  rows: ClassnoteStatusRow[],
  rowNameOf: (
    studentId: string,
    subjectKey: string | null,
    classId: string | null,
  ) => string | undefined,
): Record<string, Record<string, T>> {
  let changed = false;
  const next = { ...prev };
  for (const row of rows) {
    if (!row.status) continue; // ①
    const subjectName = rowNameOf(row.studentId, row.subject, row.classId ?? null);
    if (!subjectName) continue; // ②
    const cur = next[row.studentId]?.[subjectName];
    if (!cur || cur.classnoteStatus === row.status) continue;
    next[row.studentId] = {
      ...next[row.studentId],
      [subjectName]: { ...cur, classnoteStatus: row.status },
    };
    changed = true;
  }
  return changed ? next : prev;
}
