export type PastClassTarget = { enrollmentId: string; classId: string; startDate: string; lastDate: string };
export type TeacherEvidence = { classId: string; date: string; name: string };
export type PastTeacher = { name: string; inferred: boolean; source: "assignment" | "report" | "attendance"; date: string };

/** 같은 반의 종료일 이전 마지막 보고서를 사용한다. 출결은 수강 기간 안에서만 찾고, 같은 날 강사가 여럿이면 확정하지 않는다. */
export function resolvePastClassTeacher(
  target: PastClassTarget,
  assignedName: string | null,
  reports: readonly TeacherEvidence[],
  attendance: readonly TeacherEvidence[],
): PastTeacher | null {
  if (assignedName) return { name: assignedName, inferred: false, source: "assignment", date: target.lastDate };
  for (const [source, evidence] of [["report", reports], ["attendance", attendance]] as const) {
    const eligible = evidence.filter(r => r.classId === target.classId && r.date <= target.lastDate
      && (source === "report" || r.date >= target.startDate) && r.name.trim());
    const latest = eligible.reduce((date, row) => row.date > date ? row.date : date, "");
    if (!latest) continue;
    const names = [...new Set(eligible.filter(r => r.date === latest).map(r => r.name.trim()))];
    if (names.length !== 1) return null;
    return { name: names[0]!, inferred: true, source, date: latest };
  }
  return null;
}
