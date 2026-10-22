import { isMergedStudent } from "@/features/students/status/merged";

/** 같은 지점에서 조회한 원생 집합만 전달한다. 이름·전화번호로 정체성을 추측하지 않는다. */
export function studentIdentity(students: readonly { id: string; notes: string | null }[]) {
  const known = new Set(students.map((s) => s.id));
  const next = new Map<string, string>();
  for (const student of students) if (isMergedStudent(student.notes)) {
    const target = /^중복 병합:\s*(\S+)와 통합됨/.exec(student.notes!.trimStart())?.[1];
    if (!target || !known.has(target)) throw new Error("병합된 원생의 연결을 확인해 주세요");
    next.set(student.id, target);
  }
  const canonical = new Map<string, string>();
  for (const student of students) {
    const visited = new Set<string>();
    let id = student.id;
    while (next.has(id)) {
      if (visited.has(id)) throw new Error("원생 병합 연결이 순환합니다");
      visited.add(id);
      id = next.get(id)!;
    }
    canonical.set(student.id, id);
  }
  return (id: string) => {
    const resolved = canonical.get(id);
    if (!resolved) throw new Error("원생의 연결을 확인해 주세요");
    return resolved;
  };
}
