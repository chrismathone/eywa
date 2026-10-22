import type { StudentFact } from "./types";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/**
 * 반·강사·과목 등 여러 조회 결과에 실린 같은 사실을 한 번만 모은다.
 * ID가 같지만 내용이 다르면 어느 값을 믿을지 추측하지 않는다(스냅샷을 맞춘 뒤 다시 조회).
 * 도메인별 열람 권한을 통과한 자료만 입력해야 한다. 지점 경계는 여기서도 확인한다.
 */
export function uniqueStudentFacts<T extends StudentFact>(tenantId: string, groups: readonly (readonly T[])[]): T[] {
  const facts = new Map<string, { row: T; signature: string }>();
  for (const group of groups) for (const row of group) {
    if (row.tenantId !== tenantId) throw new Error("다른 학원의 원생 기록을 합칠 수 없습니다");
    if (!row.id || !row.studentId || !row.evidence.length) throw new Error("원생 기록의 식별자와 근거를 확인해 주세요");
    const signature = stable(row);
    const previous = facts.get(row.id);
    if (previous && previous.signature !== signature) throw new Error("같은 원생 기록의 내용이 다릅니다. 자료를 다시 확인해 주세요");
    if (!previous) facts.set(row.id, { row, signature });
  }
  return [...facts.values()].map(({ row }) => row);
}
