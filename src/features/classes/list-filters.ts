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
export const STATUS_FILTERS: { value: ClassStatusFilter; label: string }[] = [
  { value: "operating", label: "운영" },
  { value: "ended", label: "종강" },
  { value: "retired", label: "폐지" },
  { value: "all", label: "전체" },
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
export function classStatusMeta(c: { isActive: boolean; closedAt: string | null }): { label: string; color: PillColor } {
  if (!c.isActive) return { label: labelOf("retired"), color: "neutral" };
  if (c.closedAt) return { label: labelOf("ended"), color: "amber" };
  return { label: labelOf("operating"), color: "green" };
}
function labelOf(v: ClassStatusFilter): string {
  return STATUS_FILTERS.find((o) => o.value === v)?.label ?? v;
}

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

// 정렬 옵션 — 드롭다운에 전부 노출(기본 name 포함).
export const SORT_OPTIONS: { value: ClassSort; label: string }[] = [
  { value: "name", label: "수업명순" },
  { value: "students", label: "학생수순" },
  { value: "teacher", label: "강사명순" },
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
