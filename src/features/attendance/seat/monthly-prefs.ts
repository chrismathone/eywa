/**
 * 자리 월간 보기 설정 — `users.ui_prefs.seatMonthly`.
 * 기존 `ui_prefs.attendance`를 덮지 않는다(필드 단위, 형제 키 보존).
 */
const MAX_COLLAPSED = 300;

export type SeatMonthlyPrefs = {
  /** 접어 둔 반 id. 접기는 표시일 뿐 합계는 안 바뀐다. */
  collapsed: string[];
};

export const DEFAULT_SEAT_MONTHLY_PREFS: SeatMonthlyPrefs = { collapsed: [] };

export function parseSeatMonthlyPrefs(raw: unknown): SeatMonthlyPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.collapsed)
    ? o.collapsed.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
    : [];
  return { collapsed: [...new Set(ids)].slice(0, MAX_COLLAPSED) };
}
