// 강사 분배 스냅샷 저장의 감사 요약(감사 M2, 2026-09-23) — 순수 함수.
// "누가 분배액을 몇에서 몇으로 바꿨는가"를 되짚게, 저장 **전** 스냅샷과 **이번 계산**을 강사별 합계로 접는다.
// ⚠️ 청구 기준(confirmed)과 실측 기준(actual)은 같은 청구의 두 표현이라 합산하지 않는다(R3) — 따로 적는다.
// ⚠️ 산식은 건드리지 않는다 — 이미 계산된 행의 합만 센다.

export type SplitAuditRow = {
  teacherName: string | null;
  confirmedAmount: number;
  actualAmount: number;
};

export type SplitTeacherChange = {
  teacher: string;
  confirmedBefore: number;
  confirmedAfter: number;
  actualBefore: number;
  actualAfter: number;
};

export type SplitAuditSummary = {
  rowsBefore: number;
  rowsAfter: number;
  confirmedBefore: number;
  confirmedAfter: number;
  actualBefore: number;
  actualAfter: number;
  /** 합계가 바뀐 강사만(최대 limit명, 변화 폭이 큰 순). */
  changed: SplitTeacherChange[];
  /** limit에 잘려 빠진 강사 수. */
  changedMore: number;
};

const UNASSIGNED = "담당 미지정";

function totals(rows: readonly SplitAuditRow[]) {
  const byTeacher = new Map<string, { confirmed: number; actual: number }>();
  let confirmed = 0;
  let actual = 0;
  for (const r of rows) {
    const c = Number(r.confirmedAmount) || 0;
    const a = Number(r.actualAmount) || 0;
    confirmed += c;
    actual += a;
    const key = r.teacherName?.trim() || UNASSIGNED;
    const t = byTeacher.get(key) ?? { confirmed: 0, actual: 0 };
    t.confirmed += c;
    t.actual += a;
    byTeacher.set(key, t);
  }
  return { byTeacher, confirmed, actual };
}

export function summarizeSplitChange(
  before: readonly SplitAuditRow[],
  after: readonly SplitAuditRow[],
  limit = 30,
): SplitAuditSummary {
  const b = totals(before);
  const a = totals(after);
  const names = new Set([...b.byTeacher.keys(), ...a.byTeacher.keys()]);
  const changed: SplitTeacherChange[] = [];
  for (const teacher of names) {
    const x = b.byTeacher.get(teacher) ?? { confirmed: 0, actual: 0 };
    const y = a.byTeacher.get(teacher) ?? { confirmed: 0, actual: 0 };
    if (x.confirmed === y.confirmed && x.actual === y.actual) continue;
    changed.push({
      teacher,
      confirmedBefore: x.confirmed,
      confirmedAfter: y.confirmed,
      actualBefore: x.actual,
      actualAfter: y.actual,
    });
  }
  changed.sort(
    (p, q) =>
      Math.abs(q.confirmedAfter - q.confirmedBefore) - Math.abs(p.confirmedAfter - p.confirmedBefore) ||
      p.teacher.localeCompare(q.teacher, "ko"),
  );
  return {
    rowsBefore: before.length,
    rowsAfter: after.length,
    confirmedBefore: b.confirmed,
    confirmedAfter: a.confirmed,
    actualBefore: b.actual,
    actualAfter: a.actual,
    changed: changed.slice(0, limit),
    changedMore: Math.max(0, changed.length - limit),
  };
}
