import type { MenuKey } from "@/lib/permissions";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";

/**
 * **자주 방문한 메뉴** — 왼쪽 맨 위에 자동으로 올라가는 목록(원장 2026-09-07:
 * *"즐겨찾기 말고 사용자가 자주 방문한 탭이 알아서 리스트에 올라가도록"* · *"이름도 '자주 방문한 메뉴'"*).
 *
 * 🔴 사람이 고르는 즐겨찾기가 아니다 — **연 횟수**로 정한다. 저장은 계정(`users.ui_prefs.nav.visits`)이라
 *    다른 PC에서 열어도 같은 목록이다('모든 뷰 세팅은 계정 귀속').
 * 🔴 순위는 **횟수 → 마지막 방문 시각** 순이다. 횟수만 보면 옛날에 많이 쓰고 지금은 안 쓰는 메뉴가
 *    영영 위에 남고, 시각만 보면 방금 한 번 들른 메뉴가 매번 1등이 된다.
 * ⚠️ 기록이 아직 없으면(첫 로그인) 이 목록은 **비어 있다** — 호출부가 아무것도 안 그리거나 기본값을 쓴다.
 *    없는 사용 이력을 지어내지 않는다.
 * ⚠️ 표시 개수는 호출부가 정한다(사이드바는 4줄).
 */

/**
 * **세지 않는 메뉴** (원장 2026-09-10: *"'자주 방문한 메뉴'에서는 대시보드, 설정, 도움말이 카운팅되지 않게"*).
 *
 * 🔴 셋 다 **"자주 가니까 위에 올려 두면 편한 메뉴"가 아니다** — 대시보드는 곧 배경 화면 자체가 되고,
 *    설정·도움말은 이미 사이드바 아래 '지원' 줄에 **고정**으로 서 있다. 세면 항상 상위를 차지해
 *    정작 자주 쓰는 업무 메뉴를 **네 줄 밖으로 밀어낸다**(그 목록의 존재 이유가 사라진다).
 * 🔴 **'설정'에는 면마다의 권한 키도 든다**(2026-10-06) — 설정 버튼은 면별 권한 키(`operations_settings` · `kiosk_settings` 등)로
 *    방문이 기록되는데, 그 키들은 메뉴 목록에 없어 '자주 방문한 메뉴'가 목적지로 바꾸지 못하고 버렸다. 그러면 상위 네 칸 가운데
 *    한 칸이 빈 채로 사라져 실제 업무 메뉴가 줄어든다. 설정은 세지 않는다는 규칙 그대로, 그 키들도 함께 뺀다.
 * ⚠️ 기록 시점(`recordMenuVisit`)과 표시 시점(`topVisitedMenus`) **둘 다** 이 집합을 본다 —
 *    기록만 막으면 **이미 쌓인 횟수**가 남아 그 메뉴가 계속 목록에 뜨고, 표시만 막으면 jsonb가 계속 자란다.
 */
export const MENU_VISIT_EXCLUDED: ReadonlySet<string> = new Set(["dashboard", "owner", "help", ...SETTINGS_ROLE_KEYS]);

/** 이 메뉴를 '자주 방문한 메뉴'에 세는가. */
export function isVisitCounted(menuKey: string): boolean {
  return !MENU_VISIT_EXCLUDED.has(menuKey);
}

/** `ui_prefs.nav.visits`에 담기는 모양 — 키는 menuKey, 값은 [횟수, 마지막 방문(ms)]. */
export type MenuVisitMap = Record<string, [count: number, lastAt: number]>;

export const MENU_VISITS_NS = "nav";
export const MENU_VISITS_KEY = "visits";

/** 저장된 jsonb를 안전하게 읽는다 — 모양이 다르면(옛 값·손상) 빈 값으로 떨어진다. */
export function parseVisits(raw: unknown): MenuVisitMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: MenuVisitMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const [count, lastAt] = value;
    if (typeof count === "number" && count > 0 && typeof lastAt === "number") {
      out[key] = [count, lastAt];
    }
  }
  return out;
}

/**
 * 방문 1회 반영 — 순수 함수(저장은 호출부).
 * ⚠️ **상한을 둔다**(`MAX_TRACKED`) — 안 두면 jsonb가 메뉴 수만큼 계속 자란다. 넘치면 가장 덜 쓰고
 *    가장 오래된 것부터 버린다(지금 목록에 오를 리 없는 것들이다).
 */
const MAX_TRACKED = 24;

export function bumpVisit(prev: MenuVisitMap, menuKey: string, now: number): MenuVisitMap {
  const [count = 0] = prev[menuKey] ?? [];
  const next: MenuVisitMap = { ...prev, [menuKey]: [count + 1, now] };
  const keys = Object.keys(next);
  if (keys.length <= MAX_TRACKED) return next;
  const ranked = rankVisits(next);
  const keep = new Set(ranked.slice(0, MAX_TRACKED));
  // 방금 센 것은 순위와 무관하게 남긴다(막 쓴 메뉴가 그 자리에서 잘리면 다음 방문이 1부터 다시 센다).
  keep.add(menuKey);
  const trimmed: MenuVisitMap = {};
  for (const k of keys) if (keep.has(k)) trimmed[k] = next[k]!;
  return trimmed;
}

/** 많이 → 최근 순. 동률이면 키 이름으로 갈라 **순서가 흔들리지 않게** 한다(렌더마다 자리가 바뀌면 오클릭). */
export function rankVisits(visits: MenuVisitMap): string[] {
  return Object.entries(visits)
    .sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

/**
 * 자주 방문한 메뉴 상위 N — `allowed`(권한·존재하는 메뉴)에 있는 것만.
 * ⚠️ 권한이 사라진 메뉴는 기록에 남아 있어도 목록에서 빠진다(죽은 링크 금지).
 */
export function topVisitedMenus(
  visits: MenuVisitMap,
  allowed: readonly MenuKey[],
  limit: number,
): MenuKey[] {
  const ok = new Set<string>(allowed);
  return rankVisits(visits)
    // 🔴 이미 쌓여 있는 횟수도 여기서 막는다 — 기록을 멈춘 것만으론 옛 숫자가 계속 목록에 뜬다.
    .filter((k) => ok.has(k) && isVisitCounted(k))
    .slice(0, limit) as MenuKey[];
}
