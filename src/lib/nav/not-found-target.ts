/**
 * 없는 주소(엉뚱한 URL·지운 기록·꺼진 기능)에 들어왔을 때 **어디로 보낼지** — 순수 함수(Vitest).
 *
 * 원장 2026-09-30 *"말도 안되는 페이지 입력하는거 전부 대시보드로 리다이렉트"*. "대시보드"는 사람마다 다르다 —
 * 강사는 원스크린·ECS가 홈이라 운영실로 보내면 또 거부돼 튕긴다. 그래서 목적지는 `/home`(서버가 그 사람의
 * 홈 `landingPath`로, 비로그인은 `/login`으로 보낸다)이다.
 *
 * 🔴 판정은 **화면에 실제로 보일 때 브라우저에서만** 한다 — 루트 not-found는 매 요청 미리 렌더되므로
 *    거기서 서버 조회·`headers()`·`redirect()`를 하면 모든 화면·창이 그 비용을 낸다(B6).
 *
 * 🔴 보내지 않는 곳(= 404 문구 그대로):
 *  - 로그인 없이 여는 공개 화면(학부모 보고서 링크 `/r`·링크 만료 안내 `/expired`·키오스크·접수·자리 출석부·학원 랜딩·자산 QR·로그인) —
 *    학부모·기기를 로그인 화면으로 보내면 안 된다.
 *  - 인쇄 화면(`(print)` 그룹) — 인쇄 창에 앱 셸이 뜨면 안 된다.
 *  - `/home` 자신(루프 방지).
 *  `/api/*`·정적 파일은 페이지가 아니라 이 화면에 오지 않는다.
 */

const PUBLIC_PREFIXES = ["/r", "/kiosk", "/intake", "/staff-intake", "/seat", "/academy", "/inventory/asset", "/login"];
/** 하위 경로가 없는 공개 화면 — 프록시(`lib/supabase/proxy.ts`)와 같은 **정확 매칭**. */
const PUBLIC_EXACT = ["/", "/expired"];

/**
 * `src/app/(print)` 라우트의 주소 모양. 🔴 새 인쇄 라우트를 만들면 여기에도 — 가드가 폴더를 세어 대조한다.
 * `[x]` 동적 조각은 한 조각 아무 값.
 */
export const PRINT_ROUTES = [
  "/attendance/class/[classId]/month/print",
  "/attendance/seat/[seat]/month/print",
  "/ecs/[classId]/month-plan/print",
  "/enrollment/[id]/prep",
  "/enrollment/[id]/print",
  "/inventory/qr/print",
  "/lesson_reports/[id]/print",
  "/meetings/[id]/print",
  "/payroll/[teacherId]/payslip",
  "/print/help/manuals",
  "/shuttle/route",
  "/textbook/[id]/print",
] as const;

const PRINT_MATCHERS = PRINT_ROUTES.map(
  (r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}(/|$)`),
);

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPrintPath(pathname: string): boolean {
  return PRINT_MATCHERS.some((m) => m.test(pathname));
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => underPrefix(pathname, p));
}

/** 보낼 곳. null = 리다이렉트하지 않고 404 문구를 보여 준다. */
export function notFoundTarget(pathname: string, embed: boolean): string | null {
  if (isPublicPath(pathname) || isPrintPath(pathname) || underPrefix(pathname, "/home")) return null;
  return embed ? "/home?embed=1" : "/home";
}
