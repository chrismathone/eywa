import { defaultItems } from "./defaults";
import { normalizeAssignments } from "./assignment";
import { placedIds, sameItems, sanitizeItems } from "./engine";
import { BUNDLES, DASHBOARD_VERSION, EMPTY_DASHBOARD, type Bundle, type DashboardSettings, type RoleLayout } from "./types";

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
    const items = sanitizeItems(rawItems);
    if (placedIds(items).length === 0) continue;
    // 과목별 기본값도 명시적 재정의다. 지우면 다른 공통 배치가 다시 적용될 수 있다.
    if (opts?.dropDefaults && !subjectKey && sameItems(items, defaultItems(role))) continue;
    byRole.set(key, { role, ...(subjectKey ? { subject: subjectKey } : {}), items });
  }
  return { version: DASHBOARD_VERSION,
    layouts: BUNDLES.flatMap((b) => [...byRole.values()].filter((l) => l.role === b).sort((a, b) => (a.subject ?? "").localeCompare(b.subject ?? ""))),
    assignments: normalizeAssignments(r.assignments) };
}

export function roleItems(settings: DashboardSettings, bundle: Bundle, subject?: string | null) {
  return (subject && bundle === "subject" ? settings.layouts.find((l) => l.role === bundle && l.subject === subject)?.items : undefined)
    ?? settings.layouts.find((l) => l.role === bundle && !l.subject)?.items ?? defaultItems(bundle);
}
