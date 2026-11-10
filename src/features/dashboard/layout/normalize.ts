import { toBoardItems } from "./board";
import { defaultItems } from "./defaults";
import { normalizeAssignments } from "./assignment";
import { placedIds, sameItems, sanitizeItems } from "./engine";
import { BUNDLES, DASHBOARD_VERSION, EMPTY_DASHBOARD, isCoreId, type Bundle, type DashboardSettings, type RoleLayout } from "./types";

const isBundle = (v: unknown): v is Bundle => typeof v === "string" && (BUNDLES as readonly string[]).includes(v);
export const layoutKey = (bundle: Bundle, subject?: string | null) => bundle === "subject" && subject ? `${bundle}:${subject}` : bundle;

/** JSON 설정을 읽고 저장할 때 같은 규칙을 적용한다. 기존 공통 배치는 과목별 배치의 초기값이다. */
export function normalizeDashboard(raw: unknown, opts?: { dropDefaults?: boolean }): DashboardSettings {
  if (typeof raw !== "object" || raw === null) return EMPTY_DASHBOARD;
  const r = raw as { version?: unknown; layouts?: unknown; assignments?: unknown };
  if (r.version !== DASHBOARD_VERSION || !Array.isArray(r.layouts)) return EMPTY_DASHBOARD;
  const byRole = new Map<string, RoleLayout>();
  const layouts = r.layouts;
  const entries = layouts.flatMap((entry) => {
    if (entry?.role === "other") return ["counselor", "accountant", "viewer"].filter((role) => !layouts.some((v: { role?: unknown }) => v?.role === role)).map((role) => ({ ...entry, role }));
    return [entry];
  });
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { role, subject, items: rawItems } = entry as { role?: unknown; subject?: unknown; items?: unknown };
    if (!isBundle(role) || !Array.isArray(rawItems)) continue;
    if (subject !== undefined && (role !== "subject" || typeof subject !== "string" || !subject.trim() || subject.trim().length > 64)) continue;
    const subjectKey = typeof subject === "string" ? subject.trim() : undefined;
    const key = layoutKey(role, subjectKey);
    if (byRole.has(key)) continue;
    // 옛 배치(새 대시보드 전)는 읽을 때 새 모양으로 옮긴다 — 카드·제목·민감 옵션은 그대로(`board.ts`).
    const saved = sanitizeItems(rawItems);
    const items = toBoardItems(saved, { owner: role === "owner" || role === "super" });
    // 비었나 = 카드·KPI도, 원장이 직접 남긴 핵심 업무 칸도 없다(바로가기 칸만 둔 배치도 원장이 고른 배치다 — 리뷰 2026-11-09).
    // 옛 배치를 옮길 때 붙는 핵심 업무 칸은 세지 않는다(제목만 남은 옛 배치는 그대로 버린다).
    if (placedIds(items).length === 0 && !saved.some((i) => isCoreId(i.id))) continue;
    // 과목별 기본값도 명시적 재정의다. 지우면 다른 공통 배치가 다시 적용될 수 있다.
    if (opts?.dropDefaults && !subjectKey && sameItems(items, defaultItems(role))) continue;
    byRole.set(key, { role, ...(subjectKey ? { subject: subjectKey } : {}), items });
  }
  return { version: DASHBOARD_VERSION,
    layouts: BUNDLES.flatMap((b) => [...byRole.values()].filter((l) => l.role === b).sort((a, b) => (a.subject ?? "").localeCompare(b.subject ?? ""))),
    assignments: normalizeAssignments(r.assignments) };
}

/** 배치 키 모양(`owner` · `subject:<과목키>`) — 저장 요청이 보낸 '고친 배치' 목록을 거르는 데 쓴다. */
export const isLayoutKey = (key: unknown): key is string =>
  typeof key === "string" && (isBundle(key) || (key.startsWith("subject:") && key.length > 8 && key.length <= 72));

const isUserId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * 동시 저장 = **마지막 저장이 이긴다**(원장 2026-10-14 *"동시에 저장하면 최신 저장본이 덮어씌워지도록"*) — 예전엔
 * 편집을 연 뒤 다른 창이 저장했으면 '새로고침한 뒤 다시 저장'으로 거절했다.
 * 🔴 다만 덮어쓰는 것은 **이번 저장이 고친 것(`touched`)뿐**이다 — 그사이 다른 사람이 저장한 것은 지금 저장본(`fresh`)의 것을 그대로 둔다.
 *    · `layouts` = 고친 배치 키(`owner`·`subject:math`)만. 다른 역할의 배치와 직원 배정은 그대로. 같은 역할을 둘이 고쳤으면 나중 저장이 이긴다.
 *    · `assignments` = 고친 직원 id의 배정 한 줄만(직원관리에서 한 사람씩 저장). 다른 직원의 배정과 배치는 그대로 —
 *      배열을 통째로 바꾸면 두 직원을 동시에 저장했을 때 먼저 저장한 사람의 배정이 사라진다(리뷰 2026-10-14, [[#142]]와 같은 꼴).
 *      보낸 값에 그 직원 줄이 없으면 그 직원의 배정을 지운다.
 */
export function mergeDashboardSave(fresh: unknown, submitted: unknown, part: "layouts" | "assignments", touched: readonly string[]): DashboardSettings {
  const now = normalizeDashboard(fresh);
  const sent = normalizeDashboard(submitted);
  const mine = new Set(touched);
  if (part === "assignments") {
    return { ...now, assignments: [...(now.assignments ?? []).filter((a) => !mine.has(a.userId)), ...(sent.assignments ?? []).filter((a) => mine.has(a.userId))] };
  }
  const key = (l: RoleLayout) => layoutKey(l.role, l.subject);
  return { ...now, layouts: [...now.layouts.filter((l) => !mine.has(key(l))), ...sent.layouts.filter((l) => mine.has(key(l)))] };
}

/**
 * 저장 요청의 '고친 부분' 칸 해석 — `dashboardPart`가 없으면 null(옛 요청: 종전 기준선 규칙).
 * `dashboardTouched`는 JSON 배열(배치 키 또는 직원 id). 칸이 있는데 못 읽으면 `"invalid"` — 저장을 거절한다
 * (전체 덮어쓰기로 넓히지 않는다: 실패가 조용히 남의 배치까지 덮는 쪽으로 가면 안 된다).
 */
export function dashboardSavePart(part: unknown, touched: unknown): { part: "layouts" | "assignments"; touched: string[] } | "invalid" | null {
  if (part === null || part === undefined || part === "") return null;
  if (part !== "layouts" && part !== "assignments") return "invalid";
  if (typeof touched !== "string") return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(touched);
  } catch {
    return "invalid";
  }
  if (!Array.isArray(parsed) || parsed.length > 128) return "invalid";
  const valid = part === "layouts" ? isLayoutKey : isUserId;
  if (!parsed.every(valid)) return "invalid";
  return { part, touched: [...new Set(parsed as string[])] };
}

export function roleItems(settings: DashboardSettings, bundle: Bundle, subject?: string | null) {
  return (subject && bundle === "subject" ? settings.layouts.find((l) => l.role === bundle && l.subject === subject)?.items : undefined)
    ?? settings.layouts.find((l) => l.role === bundle && !l.subject)?.items ?? defaultItems(bundle);
}
