/**
 * 링크 정리 — aywa-next의 설계 사전·그래프는 main에 없는 화면(강사 지식그래프 · 서버 주소 …)도 가리킨다.
 * 누르면 없는 주소로 가지 않도록, 있는 화면으로 바꾸거나 링크를 뺀다(null). 2026-11-11부터 그래프의 학생·직원 주소는 실제 기록이라 그대로 둔다.
 */
const RENAMED: Record<string, string> = { "/class-review/knowledge": "/class-review", "/settings": "/owner" };
// 연간 마케팅·조직 OKR·경영 관리(수납)는 같은 시안 이식으로 생긴 화면이라 LIVE에 둔다(리뷰 C9 — 예전엔 "이식 전"으로 거짓 표시).
const MISSING = ["/api/"];
const LIVE = ["/marketing", "/organization/okr", "/dashboard", "/work-records", "/billing", "/students", "/staff", "/classes", "/consultations", "/newcomers", "/withdrawals", "/enrollment", "/timetable", "/student-contribution", "/owner", "/class-review", "/ecs", "/mcs", "/onescreen", "/lesson-reports", "/meetings", "/approvals", "/documents"];

export type KnowledgeRouteSwitches = Partial<Record<"approvals" | "class_review" | "classnote" | "ecs" | "mcs" | "newcomers", boolean>>;
const MODULE_PATHS: readonly [keyof KnowledgeRouteSwitches, string][] = [
  ["approvals", "/approvals"], ["class_review", "/class-review"], ["classnote", "/lesson-reports"],
  ["ecs", "/ecs"], ["mcs", "/mcs"], ["newcomers", "/newcomers"],
];

export function liveHref(href: string | undefined | null, switches: KnowledgeRouteSwitches = {}): string | null {
  if (!href) return null;
  if (href.startsWith("#")) return href;
  const path = href.split(/[?#]/)[0]!;
  if (MODULE_PATHS.some(([module, prefix]) => switches[module] === false && (path === prefix || path.startsWith(`${prefix}/`)))) return null;
  if (RENAMED[path]) return RENAMED[path] + href.slice(path.length);
  if (MISSING.some(p => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return null;
  return LIVE.some(p => path === p || path.startsWith(`${p}/`)) ? href : null;
}
