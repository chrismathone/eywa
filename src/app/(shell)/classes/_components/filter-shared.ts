import type { ClassSort, ClassStatusFilter } from "@/features/classes/server/queries";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

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
  /** 상태(운영/종강/폐지/전체). **기본값은 "operating"** — 원장 지시 2026-08-27. */
  status: ClassStatusFilter;
};

/**
 * 상태 필터 선택지 — 라벨은 목록의 상태 배지와 **같은 말**이어야 한다(배지는 운영/종강/폐지).
 * 기본값 `operating`은 URL에 안 실린다(buildClassHref) → 맨 주소 `/classes` = 운영 중만.
 *
 * 🔴 라벨은 **사전 키**다(`cls.status.*` — 표의 상태 배지와 **같은 키**를 쓴다). 값(enum)은 URL
 *    파라미터라 한 글자도 안 바뀐다. 여기 한국어를 다시 적으면 배지와 필터가 갈린다.
 */
export const CLASS_STATUS_DEFAULT: ClassStatusFilter = "operating";
export const STATUS_FILTERS: { value: ClassStatusFilter; key: SheetDictKey }[] = [
  { value: "operating", key: "cls.status.operating" },
  { value: "ended", key: "cls.status.ended" },
  { value: "retired", key: "cls.status.retired" },
  { value: "all", key: "filter.all" },
];

/** URL·저장값 → 상태 필터(모르는 값은 기본값). 서버 페이지와 필터바가 같은 판정을 쓰게 하는 단일 소스. */
export function parseClassStatus(raw: string | undefined | null): ClassStatusFilter {
  return STATUS_FILTERS.some((o) => o.value === raw)
    ? (raw as ClassStatusFilter)
    : CLASS_STATUS_DEFAULT;
}

// 과목 필터 옵션은 학원설정(operations.subjects)에서 서버가 만들어 ClassFilterBar에 prop으로 주입한다.
// (하드코딩 목록은 미등록 과목 누출 + 설정 드리프트의 원인이라 제거 — buildSubjectMaps 단일 소스.)

// 요일 키(월~일). 🔴 라벨은 여기 두지 않는다 — 요일 글자는 앱 전역 `sheetDowLabel` 단일 소스다
// (여기에 표를 다시 만들면 같은 요일이 화면마다 다르게 적힌다).
export const DAY_FILTERS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_KEYS = new Set<string>(DAY_FILTERS);

// 정렬 옵션 — 드롭다운에 전부 노출(기본 name 포함). 기본값은 URL에 안 실음(buildClassHref).
// 🔴 라벨은 사전 키(값은 URL 파라미터라 불변).
export const SORT_OPTIONS: { value: ClassSort; key: SheetDictKey }[] = [
  { value: "name", key: "cls.sort.name" },
  { value: "students", key: "cls.sort.students" },
  { value: "teacher", key: "cls.sort.teacher" },
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
  if (next.status !== CLASS_STATUS_DEFAULT) params.set("status", next.status);
  const s = params.toString();
  return s ? `/classes?${s}` : "/classes";
}
