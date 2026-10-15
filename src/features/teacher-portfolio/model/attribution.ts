/**
 * 강사 칸이 없는 기록(성적 · 학부모 글)을 **그날 다니던 반의 담임**에게 잇는다 — 계획서 5번 "성적엔 강사가 없어 그날 다니던 반 담임으로".
 * 순수 함수. 성적 관리와 학부모 만족도가 같은 규칙을 쓴다(같은 학생·같은 날이면 같은 선생님).
 *
 * - 기록에 반이 적혀 있고 그 반이 정규 반(보강 묶음 아님)이며 과목이 맞으면 그 반.
 * - 아니면 그날 명단에 있던(휴원 포함) 그 과목의 정규 반 전부. 과목을 모르면(빈 목록) 그날 담임이 **한 명일 때만** 그 담임 —
 *   여럿이면 아무에게도 잇지 않는다(다른 과목 담임 점수를 짐작으로 움직이지 않게 · 답글 정책과 같은 '모르면 짐작하지 않는다').
 * - 담임은 그날 기준(담임 이력 `buildHomeroomOwner`). 같은 선생님은 한 번만.
 */
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

export type Owned = { teacherId: string; classId: string };

export function buildRecordOwners(input: {
  enrollments: readonly SnapshotEnrollment[]; classes: ReadonlyMap<string, SnapshotClass>;
  owner: (c: SnapshotClass, day: string) => string | null;
}) {
  const byStudent = new Map<string, SnapshotEnrollment[]>();
  for (const e of input.enrollments) {
    const list = byStudent.get(e.student_id);
    if (list) list.push(e); else byStudent.set(e.student_id, [e]);
  }
  const regular = (id: string | null | undefined) => {
    const c = id ? input.classes.get(id) : undefined;
    return c && !c.is_makeup_pool ? c : undefined;
  };
  return function ownersOf(r: { studentId: string | null; day: string; subjects: readonly string[]; classId: string | null }): Owned[] {
    const fits = (c: SnapshotClass) => !r.subjects.length || r.subjects.includes(c.subject);
    const own = regular(r.classId);
    const classes = own && fits(own) ? [own] : (r.studentId ? byStudent.get(r.studentId) ?? [] : [])
      .filter((e) => isEnrollmentOnRosterOn({ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred }, r.day))
      .flatMap((e) => { const c = regular(e.class_id); return c && fits(c) ? [c] : []; });
    const out = new Map<string, Owned>();
    for (const c of classes) {
      const teacherId = input.owner(c, r.day);
      if (teacherId && !out.has(teacherId)) out.set(teacherId, { teacherId, classId: c.id });
    }
    const owners = [...out.values()];
    return !own && !r.subjects.length && owners.length > 1 ? [] : owners;
  };
}
