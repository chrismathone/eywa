import type { PillColor } from "@/components/atoms/pill";
import type { ClassSort, ClassStatusFilter } from "./server/queries";

/**
 * 수업목록 필터 어휘 — 서버 페이지(searchParams·저장값 해석)와 화면 조각이 공유하는 **순수 모듈**(디렉티브 없음).
 * 옛 `app/(shell)/classes/_components/filter-shared.ts`를 features로 옮긴 것(2026-09-03, 열 머리 필터 전환).
 * `ClassSort`는 타입만 import라 server-only 런타임 가드가 안 붙는다.
 */

export type ViewMode = "cards" | "table";

/**
 * 상태 필터 선택지 — 라벨은 목록의 상태 배지와 **같은 말**이어야 한다(배지는 `classStatusMeta`가 같은 표를 읽는다).
 * 기본값 `operating`(원장 2026-08-27 *"디폴트로 폐지나 종강된 수업은 안보이고"*).
 */
export const CLASS_STATUS_DEFAULT: ClassStatusFilter = "operating";
export type ClassStatusKey =
  | "cls.status.operating"
  | "cls.status.ended"
  | "cls.status.retired"
  | "cls.filter.all";
// 🔴 **문구는 사전 한 곳**(`teacher-view/i18n.ts`)이고 여기엔 키만 둔다 — 한국어도 그 사전에서 나온다
//    (`sheetT("ko", key)`). 코드와 사전 두 곳에 적으면 한쪽만 고쳐져 같은 상태가 화면마다 다른 말을 한다.
export const STATUS_FILTERS: { value: ClassStatusFilter; key: ClassStatusKey }[] = [
  { value: "operating", key: "cls.status.operating" },
  { value: "ended", key: "cls.status.ended" },
  { value: "retired", key: "cls.status.retired" },
  { value: "all", key: "cls.filter.all" },
];

/** URL·저장값 → 상태 필터(모르는 값은 기본값). 서버 페이지와 열 머리가 같은 판정을 쓰게 하는 단일 소스. */
export function parseClassStatus(raw: string | undefined | null): ClassStatusFilter {
  return STATUS_FILTERS.some((o) => o.value === raw)
    ? (raw as ClassStatusFilter)
    : CLASS_STATUS_DEFAULT;
}

/**
 * 반 한 줄의 상태 배지 — 라벨은 위 필터 표에서, 색은 의미색 캐논(팔레트 v4): 운영 = positive(green) · 종강 = caution(amber) ·
 * 폐지 = inert(neutral). 🔴 v4 전수 처리에서 이 화면만 빠져 '운영'이 brand(primary)로 남아 있었다(2026-09-03) — 재원·재직과
 * 같은 "정상"이라 초록이 맞다.
 */
export function classStatusMeta(c: { isActive: boolean; closedAt: string | null }): {
  key: ClassStatusKey;
  color: PillColor;
} {
  if (!c.isActive) return { key: keyOf("retired"), color: "neutral" };
  if (c.closedAt) return { key: keyOf("ended"), color: "amber" };
  return { key: keyOf("operating"), color: "green" };
}
function keyOf(v: ClassStatusFilter): ClassStatusKey {
  return STATUS_FILTERS.find((o) => o.value === v)?.key ?? "cls.filter.all";
}

// 🔴 요일 **글자**는 여기 두지 않는다 — 화면 언어를 타야 해서 `sheetDowLabel(key, lang)`이 단일 소스다
//    (시트 툴바·수업목록 열 머리가 같은 함수를 쓴다). 여기 있는 건 순서와 키뿐이다.
export const DAY_FILTERS = [
  { key: "mon" },
  { key: "tue" },
  { key: "wed" },
  { key: "thu" },
  { key: "fri" },
  { key: "sat" },
  { key: "sun" },
];
export const DAY_KEYS = new Set(DAY_FILTERS.map((d) => d.key));

// 정렬 옵션 — 드롭다운에 전부 노출(기본 name 포함).
// 문구는 사전 한 곳(`cls.sort.*`) — 여기엔 값과 키만(위 상태 표와 같은 규약).
export const SORT_OPTIONS: { value: ClassSort; key: "cls.sort.name" | "cls.sort.students" | "cls.sort.teacher" }[] = [
  { value: "name", key: "cls.sort.name" },
  { value: "students", key: "cls.sort.students" },
  { value: "teacher", key: "cls.sort.teacher" },
];

/** 정렬 — 모르는 값은 기본(수업명순). URL·저장값 둘 다 이 한 곳을 지난다. */
export function parseClassSort(raw: unknown): ClassSort {
  return SORT_OPTIONS.some((o) => o.value === raw) ? (raw as ClassSort) : "name";
}

/** 보기(표/카드) — 모르는 값은 표. */
export function parseClassView(raw: unknown): ViewMode {
  return raw === "cards" ? "cards" : "table";
}

/** 강사가 해당 과목 담당인지 — users.subjects 대소문자 편차('MATH' vs 'math')에 견고(정확일치, 무시). */
export const teacherTeaches = (subjects: string[], subjectKey: string) =>
  subjects.some((s) => s.toLowerCase() === subjectKey.toLowerCase());
