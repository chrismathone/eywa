import { isMergedStudent } from "../status/merged";

export type IdentityIssue = { studentId: string; reason: "missing_target" | "cycle" };

/** Read views quarantine a broken chain. Writers and aggregation still use the strict resolver. */
export function buildStudentIdentityIndex(students: readonly { id: string; notes: string | null }[]) {
  const known = new Set(students.map((s) => s.id));
  const next = new Map<string, string | null>();
  for (const student of students) if (isMergedStudent(student.notes)) {
    next.set(student.id, /^중복 병합:\s*(\S+)와 통합됨/.exec(student.notes!.trimStart())?.[1] ?? null);
  }
  const resolved = new Map<string, string>(), issues: IdentityIssue[] = [];
  for (const student of students) {
    const visited = new Set<string>();
    let id: string | null = student.id;
    let reason: IdentityIssue["reason"] | undefined;
    while (id && known.has(id)) {
      if (visited.has(id)) { reason = "cycle"; break; }
      if (!next.has(id)) break;
      visited.add(id); id = next.get(id) ?? null;
    }
    if (!id || !known.has(id)) reason = "missing_target";
    if (reason) issues.push({ studentId: student.id, reason });
    else resolved.set(student.id, id!);
  }
  return { issues, ids: [...resolved.keys()], resolve: (id: string) => resolved.get(id) ?? null };
}
