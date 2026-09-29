import { z } from "zod";
import { MAX_ITEMS_PER_BEACON, type UsageItem } from "./meter";
import { isCanonicalRouteKey, isTrackedRoute, menuKeyOfRoute, MAX_ROUTE_KEY_LENGTH } from "./route-key";

/**
 * 이용 분석 **수신 관문** — 비콘 본문 검증 + DB 행 변환(순수 함수, Vitest).
 * 🔴 비콘은 로그인한 누구나 손으로도 보낼 수 있다 — 숫자는 한 번에 보낼 수 있는 상한으로 자르고, 주소는 **정규형이면서
 *    실제 셸 경로**(메뉴 경로 + 내 정보·메뉴 판·권한 안내)만 받는다(지어낸 주소로 행을 무한히 늘리지 못하게).
 *    DB 함수(0292a `record_page_usage`)도 같은 상한을 한 번 더 건다(이중 방어).
 */

export const MAX_BEACON_BYTES = 16_000;
/** 비콘 한 번에 한 화면이 실을 수 있는 최대 초 — 보내는 간격(10분)의 6배라 정상 흐름은 절대 안 닿는다. */
const MAX_SECONDS_PER_ITEM = 3600;

export const usagePayloadSchema = z.object({
  v: z.literal(1),
  items: z
    .array(
      z.object({
        route: z.string().min(1).max(MAX_ROUTE_KEY_LENGTH),
        visits: z.number().int().min(0).max(500),
        openSec: z.number().int().min(0).max(MAX_SECONDS_PER_ITEM),
        activeSec: z.number().int().min(0).max(MAX_SECONDS_PER_ITEM),
      }),
    )
    .max(MAX_ITEMS_PER_BEACON),
});

/** `record_page_usage`가 받는 한 줄(jsonb 배열 원소). */
export type UsageRow = {
  route_key: string;
  menu_key: string;
  visits: number;
  open_seconds: number;
  active_seconds: number;
};

/**
 * 받은 항목 → DB 행. 정규형이 아니거나 셸에 없는 주소는 버리고 같은 주소는 합친다
 * (한 INSERT … ON CONFLICT가 같은 행을 두 번 고치면 전체가 실패한다). 활동은 화면 시간을 넘지 않게 자른다.
 */
export function toUsageRows(items: readonly UsageItem[]): UsageRow[] {
  const byRoute = new Map<string, UsageRow>();
  for (const it of items) {
    if (!isCanonicalRouteKey(it.route) || !isTrackedRoute(it.route)) continue;
    const active = Math.min(it.activeSec, it.openSec);
    if (it.visits === 0 && it.openSec === 0) continue;
    const prev = byRoute.get(it.route);
    if (prev) {
      prev.visits += it.visits;
      prev.open_seconds += it.openSec;
      prev.active_seconds += active;
    } else {
      byRoute.set(it.route, {
        route_key: it.route,
        // 클라이언트의 이름/폴더/메뉴 키는 받지 않는다. 서버가 기본 주소 표에서 분류를 결정한다.
        menu_key: menuKeyOfRoute(it.route),
        visits: it.visits,
        open_seconds: it.openSec,
        active_seconds: active,
      });
    }
  }
  return [...byRoute.values()];
}
