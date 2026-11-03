import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 로컬 메뉴 편집 체험: DB/로그인 없이 고정된 샘플만 쓴다. 프로덕션에서는 페이지도 404다.
  if (process.env.NODE_ENV === "development" && (request.nextUrl.pathname === "/dev/navigation" || request.nextUrl.pathname === "/dev/dashboard-harness" || request.nextUrl.pathname === "/dev/dashboard-instruments")) return NextResponse.next();
  return updateSession(request);
}

/**
 * 프록시를 **태울 필요가 없는 경로는 애초에 매칭하지 않는다** — 매칭되면 요청마다 함수가 깨어나고
 * (warm 실측 17~26ms) 그 안에서 세션을 갱신한 뒤 버려진다.
 *
 * 제외 대상(2026-07-29 추가):
 * - `api/*` — 라우트 핸들러가 자체 인증(Bearer·CRON_SECRET·웹훅 시크릿·service_role)을 하고,
 *   쿠키 세션 갱신이 필요한 곳은 핸들러 안에서 직접 클라이언트를 만든다. 프록시가 할 일이 없다.
 * - `robots.txt`·`sitemap.xml`·`manifest.json` — 정적 메타. 실측상 이들이 `/login`으로 **307**
 *   리다이렉트되고 있었다(크롤러·PWA에 잘못된 응답).
 * - 폰트·스타일·데이터 확장자 — 이미지 6종만 빼고 있어 `woff2` 등이 함수를 태우고 있었다.
 * - `mp4`·`webm` (2026-09-22) — 로그인 패널 배경 영상(`/photos/login-panel.mp4`). 빠져 있으면 영상 요청이
 *   `/login?next=…`로 **307**되어 `<video>`가 MEDIA_ERR_SRC_NOT_SUPPORTED로 멈춘다(실측 — 포스터만 남는다).
 *
 * ⚠️ 여기서 빼는 건 "인증을 면제한다"가 아니라 "쿠키 세션 갱신을 건너뛴다"이다. 보호가 필요한
 *    표면은 페이지·라우트 핸들러가 각자 게이트를 갖는다(#77 — 화면에서만 잠그면 우회된다).
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map|txt|json|mp4|webm)$).*)",
  ],
};
