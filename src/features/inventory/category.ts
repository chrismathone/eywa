/**
 * 자산 분류 — **학원별 데이터**(0247a `inventory_categories`). 순수(서버/클라 공용).
 *
 * 원장 2026-09-03: *"분류를 정식으로 추가하고, 엑셀에서 없는 분류 추가하면 자동으로 분류 추가되도록"*.
 * 그전엔 코드 7종 + DB CHECK 두 겹으로 고정돼 있어서 엑셀에 '헤드셋'을 적으면 파일 전체가 반영되지 않았다.
 *
 * ⚠️ 이건 **과목/학년/직급/교시가 아니다** — 학원설정(`operations.*`)이 아니라 재고관리 전용 표다.
 *    다만 규약은 같다: **라벨·색·선택지를 화면 파일에 다시 적지 말 것**. 서버 컴포넌트는
 *    `getInventoryCategories()` → `buildCategoryMaps(rows)`, 클라이언트는 `useCategoryMaps()`.
 * 🔴 `key`는 확정 후 **불변**(라벨을 바꿔도 키는 그대로 — 바꾸면 기존 자산 연결이 끊긴다). 키·접두 도출은
 *    [`category-plan.ts`](./category-plan.ts) 한 곳.
 * 🔴 접두(`codePrefix`)로 분류를 **되짚지 말 것** — 저장된 `asset_code`는 사람이 고칠 수 있는 라벨이다.
 */
export type InventoryCategory = {
  key: string;
  label: string;
  codePrefix: string;
  sortOrder: number;
};

/**
 * 내장 7종 — ① 0247a 시드의 원본이고 ② 표가 아직 없을 때(마이그레이션 미적용)의 **폴백**이다([[#95]]).
 * 라벨·접두·순서는 시안의 라벨 번호 체계(`DT-001`·`NB-005`…) 그대로. `기타`는 `ET`.
 */
export const BUILTIN_CATEGORIES: ReadonlyArray<InventoryCategory> = [
  { key: "desktop", label: "데스크탑", codePrefix: "DT", sortOrder: 10 },
  { key: "laptop", label: "노트북", codePrefix: "NB", sortOrder: 20 },
  { key: "monitor", label: "모니터", codePrefix: "MN", sortOrder: 30 },
  { key: "tablet", label: "태블릿", codePrefix: "TB", sortOrder: 40 },
  { key: "printer", label: "프린터", codePrefix: "PR", sortOrder: 50 },
  { key: "tv", label: "TV", codePrefix: "TV", sortOrder: 60 },
  { key: "etc", label: "기타", codePrefix: "ET", sortOrder: 70 },
];

/** 분류가 하나도 없을 때 채번이 쓰는 접두 — 아무 접두도 못 고르면 자산ID를 직접 적게 한다. */
export const FALLBACK_CODE_PREFIX = "C1";

/** 라벨·키 비교용 정규화 — 공백 무시(엑셀 칸의 `노트 북`·`데스크탑 `이 같은 것으로 읽히게). */
export function normalizeCategoryText(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

export type CategoryMaps = {
  /** 정렬된 목록(sortOrder → key). 필터 칩·드롭다운·엑셀 서식이 이 순서를 쓴다. */
  list: InventoryCategory[];
  /** 키 → 한글 라벨. **모르는 값은 원문 그대로**(폴백 — 화면이 죽지 않게). */
  labelOf: (key: string | null | undefined) => string;
  /** 키 → 자산ID 접두. 모르는 키는 폴백 접두(자산ID를 직접 적게 된다). */
  prefixOf: (key: string | null | undefined) => string;
  /** 등록된 분류인가 — 서버 액션의 검증이 이걸 쓴다(화면 조건은 게이트가 아니다, [[#77]]). */
  has: (key: string | null | undefined) => boolean;
  /** 엑셀 칸(라벨 또는 키, 공백 무시) → 키. 모르면 undefined. */
  keyOfInput: (raw: string) => string | undefined;
  /** 드롭다운 옵션. */
  options: { value: string; label: string }[];
  /** 라벨만(엑셀 데이터 유효성 목록·안내 문구). */
  labels: string[];
};

export function buildCategoryMaps(rows: ReadonlyArray<InventoryCategory>): CategoryMaps {
  const list = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const byKey = new Map(list.map((c) => [c.key, c]));
  // 라벨·키 둘 다 받는다(엑셀은 한글 라벨이 정석이지만 키를 적어도 통과시킨다).
  const byText = new Map<string, string>();
  for (const c of list) {
    byText.set(normalizeCategoryText(c.label), c.key);
    byText.set(normalizeCategoryText(c.key), c.key);
  }
  return {
    list,
    labelOf: (key) => (key ? (byKey.get(key)?.label ?? key) : ""),
    prefixOf: (key) => (key ? (byKey.get(key)?.codePrefix ?? FALLBACK_CODE_PREFIX) : FALLBACK_CODE_PREFIX),
    has: (key) => !!key && byKey.has(key),
    keyOfInput: (raw) => byText.get(normalizeCategoryText(raw)),
    options: list.map((c) => ({ value: c.key, label: c.label })),
    labels: list.map((c) => c.label),
  };
}

/** 표가 없을 때의 폴백 맵(내장 7종). */
export const BUILTIN_CATEGORY_MAPS = buildCategoryMaps(BUILTIN_CATEGORIES);

/**
 * 내장 7종 기준 라벨 — **감사로그 옛 행 폴백 전용**.
 * 🔴 화면에서 쓰지 말 것(학원이 추가한 분류를 영문 키로 내보낸다). 화면은 `CategoryMaps.labelOf`.
 * 감사로그는 저장 시점에 `metadata.categoryLabel`을 함께 남기므로 이 함수는 0247a 이전 행에만 쓰인다.
 */
export function assetCategoryLabel(category: string | null | undefined): string {
  return BUILTIN_CATEGORY_MAPS.labelOf(category);
}
