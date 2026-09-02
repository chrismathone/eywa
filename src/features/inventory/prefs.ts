/**
 * 재고관리 화면의 **보기 설정**(순수 파서) — `users.ui_prefs.inventory`.
 *
 * 규칙: *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*(원장 2026-08-04). 토글은 localStorage가 아니라 DB에 담아
 * 다른 기기에서도 같은 상태로 열린다([[#90]]). ⚠️ 저장된 값을 그대로 믿지 않는다 — 모르는 값은 기본값으로 접는다.
 */
export type InventoryPrefs = {
  /** 자산 표에서 폐기 자산 숨김(원장 2026-09-02 *"폐기 숨김 토글 추가"*). '폐기' 필터 칩을 고르면 이 토글과 무관하게 보인다. */
  hideDisposed: boolean;
};

export const DEFAULT_INVENTORY_PREFS: InventoryPrefs = { hideDisposed: false };

export function parseInventoryPrefs(raw: unknown): InventoryPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_INVENTORY_PREFS;
  const v = (raw as Record<string, unknown>).hideDisposed;
  return { hideDisposed: v === true };
}
