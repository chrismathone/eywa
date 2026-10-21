/**
 * 오늘 등하원 화면의 **보기 설정**(순수 파서) — `users.ui_prefs.shuttleToday`.
 *
 * 규칙: *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*(원장 2026-08-04). 정렬·필터·표시 토글은
 * localStorage가 아니라 DB에 담아 **다른 기기에서도 같은 상태**로 열린다. 셔틀 선생님은 폰과 PC를
 * 오가므로 특히 그렇다.
 *
 * 🔑 2026-10-20(사용자 *"등하원으로 나누지말고 호차 별로 나눠서 토글 형태로 누르면 계속 그 호차면 볼수있게"*):
 *    저장하는 것은 **고른 호차**(`vehicle` = 호차 칸 키 `vehicleGroupKey`, null = 전체)다. 옛 `direction`(등하원 보기)은
 *    더는 읽지 않는다 — 저장돼 있어도 조용히 버린다(그 필터가 걸린 채 열리면 화면에 이유 없이 회차가 빠진다).
 * ⚠️ 저장된 값을 그대로 믿지 않는다 — 모르는 값이 오면 조용히 기본값(전체)으로 접는다. 그날 그 호차가 없으면
 *    화면이 전체로 보여 준다(여기서 판단하지 않는다 — 날짜를 모른다).
 */
export type ShuttleTodayPrefs = {
  /** 고른 호차 칸 키(`name:2호차` 꼴) — null이면 전체. */
  vehicle: string | null;
};

export const DEFAULT_SHUTTLE_TODAY_PREFS: ShuttleTodayPrefs = { vehicle: null };

/** 칸 키 꼴 — `name:` 또는 `id:` 접두 + 내용, 지나치게 긴 값은 버린다. */
const KEY_RE = /^(name|id):.{1,80}$/;

/** 저장된 jsonb → 항상 완전한 설정(모르는 값·빠진 키는 기본값). */
export function parseShuttleTodayPrefs(raw: unknown): ShuttleTodayPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_SHUTTLE_TODAY_PREFS;
  const v = (raw as Record<string, unknown>).vehicle;
  if (typeof v === "string" && KEY_RE.test(v)) return { vehicle: v };
  return DEFAULT_SHUTTLE_TODAY_PREFS;
}
