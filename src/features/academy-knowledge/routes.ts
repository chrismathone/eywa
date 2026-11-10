/**
 * 시안 링크 정리 — aywa-next의 설계 사전·그래프는 main에 없는 화면(연간 마케팅 · 조직 OKR · 강사 지식그래프 …)과
 * 예시 학생 id(`/students/<가짜 id>`)를 가리킨다. 누르면 없는 주소로 가지 않도록, 있는 화면으로 바꾸거나 링크를 뺀다(null).
 */
const RENAMED: Record<string, string> = { "/class-review/knowledge": "/class-review", "/settings": "/owner" };
// 연간 마케팅·조직 OKR·경영 관리(수납)는 같은 시안 이식으로 생긴 화면이라 LIVE에 둔다(리뷰 C9 — 예전엔 "이식 전"으로 거짓 표시).
const MISSING = ["/api/"];
const LIVE = ["/marketing", "/organization/okr", "/dashboard", "/work-records", "/billing", "/students", "/staff", "/classes", "/consultations", "/newcomers", "/withdrawals", "/enrollment", "/timetable", "/student-contribution", "/owner", "/class-review", "/ecs", "/mcs", "/onescreen", "/lesson-reports", "/meetings", "/approvals", "/documents"];

export function liveHref(href: string | undefined | null): string | null {
  if (!href) return null;
  if (href.startsWith("#")) return href;
  const path = href.split(/[?#]/)[0]!;
  if (RENAMED[path]) return RENAMED[path] + href.slice(path.length);
  if (MISSING.some(p => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return null;
  // 예시 학생·직원의 상세 주소는 실제 기록이 아니다.
  if (/^\/(students|staff)\/[^/]+/.test(path) && path !== "/students/care" && path !== "/students/stats") return null;
  return LIVE.some(p => path === p || path.startsWith(`${p}/`)) ? href : null;
}
