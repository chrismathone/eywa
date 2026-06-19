import type { ClassSort } from "@/features/classes/server/queries";

// 수업목록 필터 — 서버 페이지(searchParams 파싱)와 클라이언트 필터바가 공유하는 순수 모듈.
// (디렉티브 없음 → 양쪽에서 import 가능. ClassSort는 타입만 import라 server-only 런타임 가드 미발동.)

export type ViewMode = "cards" | "table";

export type ClassFilterState = {
  subject: string;
  teacher: string;
  days: string[];
  q: string;
  view: ViewMode;
  sort: ClassSort;
};

export const SUBJECT_FILTERS = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "highmath", label: "수학(심화)" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

export const DAY_FILTERS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];
export const DAY_KEYS = new Set(DAY_FILTERS.map((d) => d.key));

// 정렬 옵션 — 드롭다운에 전부 노출(기본 name 포함). 기본값은 URL에 안 실음(buildClassHref).
export const SORT_OPTIONS: { value: ClassSort; label: string }[] = [
  { value: "name", label: "수업명순" },
  { value: "students", label: "학생수순" },
  { value: "teacher", label: "강사명순" },
];

/** 강사가 해당 과목 담당인지 — users.subjects 대소문자 편차('MATH' vs 'math')에 견고(정확일치, 무시). */
export const teacherTeaches = (subjects: string[], subjectKey: string) =>
  subjects.some((s) => s.toLowerCase() === subjectKey.toLowerCase());

/** 필터 상태 → /classes URL. 기본값은 생략(page 파라미터는 절대 안 넣음 → 필터 변경 시 1페이지로 리셋). */
export function buildClassHref(current: ClassFilterState, patch: Partial<ClassFilterState>): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.subject !== "all") params.set("subject", next.subject);
  if (next.teacher !== "all") params.set("teacher", next.teacher);
  if (next.days.length) params.set("days", next.days.join(","));
  if (next.q) params.set("q", next.q);
  if (next.view !== "table") params.set("view", next.view);
  if (next.sort !== "name") params.set("sort", next.sort);
  const s = params.toString();
  return s ? `/classes?${s}` : "/classes";
}
