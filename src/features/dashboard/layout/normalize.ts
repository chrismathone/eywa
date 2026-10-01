/**
 * 저장값(jsonb) ↔ 믿을 수 있는 `DashboardSettings`. 읽을 때(`resolveSettings`)와 저장할 때(`saveOwnerSection`) 같은 함수를 지난다.
 *
 * · 읽기: 판 번호가 다르거나 모양이 깨진 역할 배치는 버린다(= 기본 배치로 돌아간다 — 화면이 안 죽는다).
 *   모르는 카드 id·중복·크기 이탈은 `sanitizeItems`가 걸러 프리셋으로 맞춘다. 카드가 하나도 안 남은 역할도 버린다.
 * · 저장(`dropDefaults`): 기본 배치와 같은 역할은 **저장하지 않는다** — 저장값이 없어야 기본을 코드로 개선했을 때
 *   안 건드린 역할이 자동으로 따라온다.
 * ⚠️ 순수 모듈(zod 없음) — 서버·클라 공용.
 */
import { defaultItems } from "./defaults";
import { normalizeAssignments } from "./assignment";
import { placedIds, sameItems, sanitizeItems } from "./engine";
import { BUNDLES, DASHBOARD_VERSION, EMPTY_DASHBOARD, type Bundle, type DashboardSettings, type RoleLayout } from "./types";

const isBundle = (v: unknown): v is Bundle => typeof v === "string" && (BUNDLES as readonly string[]).includes(v);

export function normalizeDashboard(raw: unknown, opts?: { dropDefaults?: boolean }): DashboardSettings {
  if (typeof raw !== "object" || raw === null) return EMPTY_DASHBOARD;
  const r = raw as { version?: unknown; layouts?: unknown; assignments?: unknown };
  if (r.version !== DASHBOARD_VERSION || !Array.isArray(r.layouts)) return EMPTY_DASHBOARD;
  const byRole = new Map<Bundle, RoleLayout>();
  const layouts = r.layouts;
  const entries = layouts.flatMap((entry) => {
    if (entry?.role === "other") return ["counselor", "accountant", "viewer"].filter((role) => !layouts.some((v: { role?: unknown }) => v?.role === role)).map((role) => ({ ...entry, role }));
    return [entry];
  });
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { role, items: rawItems } = entry as { role?: unknown; items?: unknown };
    if (!isBundle(role) || byRole.has(role) || !Array.isArray(rawItems)) continue;
    const items = sanitizeItems(rawItems);
    // 카드가 하나도 없는 배치는 "운영실을 비워 두라"가 아니라 깨진 값으로 본다 — 기본으로 돌아간다.
    if (placedIds(items).length === 0) continue;
    if (opts?.dropDefaults && sameItems(items, defaultItems(role))) continue;
    byRole.set(role, { role, items });
  }
  // 정의 순서로 — 저장·비교가 흔들리지 않게.
  const assignments = normalizeAssignments(r.assignments);
  return { version: DASHBOARD_VERSION, layouts: BUNDLES.flatMap((b) => (byRole.has(b) ? [byRole.get(b)!] : [])), assignments };
}

/** 이 역할이 지금 쓰는 배치(저장값 → 없으면 기본). 편집기 시작값. */
export function roleItems(settings: DashboardSettings, bundle: Bundle) {
  return settings.layouts.find((l) => l.role === bundle)?.items ?? defaultItems(bundle);
}
