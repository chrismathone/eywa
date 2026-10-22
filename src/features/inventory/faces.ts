import type { Face } from "@/components/face-tabs";

/** 재고관리의 라우트 — 면은 `?tab=`으로 가른다(수납관리와 같은 메커니즘). */
export const INVENTORY_PATH = "/inventory";

export const INVENTORY_TABS = ["assets", "loans", "audits", "supplies", "vendors"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

/**
 * 면 정의 **단일 소스** — 화면 안 FaceTabs가 이걸 그린다.
 *
 * 🔴 사이드바 하부탭(`SUBTABS_BY_MENU`)엔 **넣지 않는다** — 원장 2026-09-02: *"재고관리 내부탭은 왼쪽 탭에서
 *    안보여도 돼. 의미 없음. 그냥 '재고관리' 1개"*. 면은 화면 안 탭바 하나로만 오간다(폰·데스크톱 공통).
 *    처음엔 셔틀처럼 하부탭에서 파생시켰는데(사이드바 4줄) 그 줄이 노이즈라 걷어냈다.
 */
export const INVENTORY_FACE_DEFS: ReadonlyArray<{ key: InventoryTab; label: string; href: string }> = [
  { key: "assets", label: "자산", href: INVENTORY_PATH },
  { key: "loans", label: "대여", href: `${INVENTORY_PATH}?tab=loans` },
  { key: "audits", label: "실사", href: `${INVENTORY_PATH}?tab=audits` },
  { key: "supplies", label: "소모품", href: `${INVENTORY_PATH}?tab=supplies` },
  // 거래처 연락처(원장 2026-10-22 *"재고관리에 전화번호부? 업체리스트?"*) — 서점·출판사·정수기·인테리어 등.
  { key: "vendors", label: "업체리스트", href: `${INVENTORY_PATH}?tab=vendors` },
];

export function isInventoryTab(v: unknown): v is InventoryTab {
  return typeof v === "string" && (INVENTORY_TABS as readonly string[]).includes(v);
}

/** `?tab=` 값 → 면. 모르는 값·없음은 자산(기본 착지). */
export function resolveInventoryTab(v: unknown): InventoryTab {
  return isInventoryTab(v) ? v : "assets";
}

/** href(`/inventory?tab=loans`) → 면 키. `?tab`이 없으면 자산. */
export function tabOfHref(href: string): InventoryTab {
  const q = href.split("?")[1] ?? "";
  return resolveInventoryTab(new URLSearchParams(q).get("tab"));
}

/**
 * 면 전환 탭 — 자산 · 대여 · 실사 · 소모품 · 업체리스트. 탭 라벨 옆 건수(시안 `자산마스터 96 / 대여이력 7 / …`)는 라벨 뒤에
 * 붙인다. 건수를 모르면(조회 실패·표 없음) 숫자를 **안 붙인다** — 0을 적으면 "하나도 없다"는 거짓말이 된다.
 */
export function inventoryFaces(counts?: Partial<Record<InventoryTab, number | null>>): Face[] {
  return INVENTORY_FACE_DEFS.map((f) => {
    const n = counts?.[f.key];
    return { key: f.key, label: typeof n === "number" ? `${f.label} ${n}` : f.label, href: f.href };
  });
}
