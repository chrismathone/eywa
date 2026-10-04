import { isVideoOAuthDoneStatus, renderVideoOAuthDonePage, VIDEO_OAUTH_PAGE_HEADERS } from "@/features/video-submit/server/oauth/done-page";

/**
 * 숙제영상 드라이브 — Google 로그인이 끝난 새 탭의 **결과 화면**. 돌아온 주소(코드가 든)에서 이리로 옮겨 온다.
 * 주소의 `status`는 정해 둔 상태 이름일 때만 쓰고, 그 밖의 값은 '실패' 안내로 바꾼다(주소의 글자를 화면에 찍지 않는다).
 * 민감한 것이 없다(성공·실패 한 줄) — 로그인 없이도 열린다.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return new Response(renderVideoOAuthDonePage(isVideoOAuthDoneStatus(status) ? status : "failed"), { headers: VIDEO_OAUTH_PAGE_HEADERS });
}
