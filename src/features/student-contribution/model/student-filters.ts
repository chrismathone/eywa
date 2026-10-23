export const STUDENT_STATUS_LABELS = { enrolled: "재원생", on_hold: "휴원생", withdrawn: "퇴원생", all: "모든 상태" } as const;
export type StudentFilters = { search: string; status: keyof typeof STUDENT_STATUS_LABELS; grade: string; subject: string };
export type StudentFilterParams = { q?: string; status?: string; grade?: string; subject?: string };
export type StudentFilterOptions = { grades: string[]; subjects: { key: string; label: string }[] };
export const DEFAULT_STUDENT_FILTERS: StudentFilters = { search: "", status: "enrolled", grade: "", subject: "" };

export function studentFilters(raw: StudentFilterParams = {}): StudentFilters {
  return { search: (raw.q ?? "").trim().slice(0, 100),
    status: Object.hasOwn(STUDENT_STATUS_LABELS, raw.status ?? "") ? raw.status as StudentFilters["status"] : "enrolled",
    grade: (raw.grade ?? "").slice(0, 100), subject: (raw.subject ?? "").slice(0, 100) };
}

export function matchesStudentFilters(student: { name: string; school: string | null; grade: string | null; status: string; subjects: string[] }, filters: StudentFilters) {
  return (filters.status === "all" || student.status === filters.status)
    && (!filters.grade || student.grade === filters.grade)
    && (!filters.subject || student.subjects.includes(filters.subject))
    && `${student.name} ${student.school ?? ""}`.toLocaleLowerCase("ko-KR").includes(filters.search.trim().toLocaleLowerCase("ko-KR"));
}

/** Explicit defaults keep links stable when moving between current and monthly views. */
export function writeStudentFilters(params: URLSearchParams, filters: StudentFilters) {
  params.set("status", filters.status);
  for (const [key, value] of [["q", filters.search.trim()], ["grade", filters.grade], ["subject", filters.subject]]) {
    if (value) params.set(key, value); else params.delete(key);
  }
  return params;
}
