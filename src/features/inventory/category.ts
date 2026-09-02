/**
 * 자산 분류 — 코드 고정 enum(순수, 서버/클라 공용).
 *
 * ⚠️ 이건 **과목/학년/직급/교시가 아니다** — 학원설정 enum 하드코딩 금지 규칙의 대상이 아니고
 *    학생상태·출결상태처럼 코드에 고정하는 게 맞다. 다만 모르는 값이 와도 화면이 죽지 않게 라벨 폴백을 둔다.
 * 필터 칩 순서는 시안 그대로: 데스크탑 → 노트북 → 모니터 → 태블릿 → 프린터 → TV.
 * `etc`(기타)는 해당 자산이 1건 이상일 때만 칩을 세운다(지금 데이터엔 0건).
 */
export const ASSET_CATEGORIES = ["desktop", "laptop", "monitor", "tablet", "printer", "tv", "etc"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  desktop: "데스크탑",
  laptop: "노트북",
  monitor: "모니터",
  tablet: "태블릿",
  printer: "프린터",
  tv: "TV",
  etc: "기타",
};

/**
 * 자산ID 접두 — 시안의 라벨 번호 체계(`DT-001`·`NB-005`…)를 그대로 잇는다. 기타는 `ET`.
 * 🔑 접두는 **분류에서 파생**하지만 저장된 `asset_code`는 사람이 고칠 수 있는 라벨이다 —
 *    접두로 분류를 되짚지 말 것(코드는 라벨, 분류는 컬럼).
 */
export const ASSET_CODE_PREFIX: Record<AssetCategory, string> = {
  desktop: "DT",
  laptop: "NB",
  monitor: "MN",
  tablet: "TB",
  printer: "PR",
  tv: "TV",
  etc: "ET",
};

export function isAssetCategory(v: unknown): v is AssetCategory {
  return typeof v === "string" && (ASSET_CATEGORIES as readonly string[]).includes(v);
}

/** 분류 코드 → 한글. 모르는 값은 원문 그대로(폴백 — 화면이 죽지 않게). */
export function assetCategoryLabel(category: string | null | undefined): string {
  if (!category) return "";
  return isAssetCategory(category) ? ASSET_CATEGORY_LABEL[category] : category;
}
