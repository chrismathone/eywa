import type { Face } from "@/components/face-tabs";
import { SUBTABS_BY_MENU } from "@/lib/navigation";

/** 재고 관리의 라우트 — 면은 `?tab=`으로 가른다(수납관리와 같은 메커니즘). */
export const INVENTORY_PATH = "/inventory";

export const INVENTORY_TABS = ["assets", "loans", "audits", "supplies"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export function isInventoryTab(v: unknown): v is InventoryTab {
  return typeof v === "string" && (INVENTORY_TABS as readonly string[]).includes(v);
}

/** `?tab=` 값 → 면. 모르는 값·없음은 자산(기본 착지). */
export function resolveInventoryTab(v: unknown): InventoryTab {
  return isInventoryTab(v) ? v : "assets";
}

/** 하부탭 href(`/inventory?tab=loans`) → 면 키. `?tab`이 없으면 자산. */
export function tabOfHref(href: string): InventoryTab {
  const q = href.split("?")[1] ?? "";
  return resolveInventoryTab(new URLSearchParams(q).get("tab"));
}

/**
 * 재고 관리 면 전환 탭 — 자산 · 대여 · 실사 · 소모품.
 *
 * 🔴 **모바일엔 사이드바가 없다.** 하부탭(SUBTABS_BY_MENU)은 펼친 사이드바에만 있어서, 화면 안 탭바가
 *    없으면 폰에서 '대여/실사/소모품'으로 갈 길이 아예 없다(셔틀에서 실제로 터진 함정 — `shuttle/faces.ts`).
 * 🔑 라벨·순서는 사이드바 하부탭에서 **파생**한다 — 양쪽을 각각 하드코딩하면 한쪽만 고쳐 갈린다
 *    (수납관리 '회차 확정'이 그렇게 어긋났었다).
 * 🔑 탭 라벨 옆 건수(시안 `자산마스터 96 / 대여이력 7 / …`)는 라벨 뒤에 붙인다. 건수를 모르면(조회 실패·
 *    표 없음) 숫자를 **안 붙인다** — 0을 적으면 "하나도 없다"는 거짓말이 된다.
 */
export function inventoryFaces(counts?: Partial<Record<InventoryTab, number | null>>): Face[] {
  return (SUBTABS_BY_MENU.inventory ?? []).map((tab) => {
    const key = tabOfHref(tab.href);
    const n = counts?.[key];
    return {
      key,
      label: typeof n === "number" ? `${tab.label} ${n}` : tab.label,
      href: tab.href,
    };
  });
}
