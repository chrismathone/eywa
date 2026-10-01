import { NextResponse } from "next/server";
import { getThreadVideoStates } from "@/features/classnote-reply/server/video-poll";
import { reportError } from "@/lib/observability/report-error";

/**
 * 답글 창 영상 보관 상태 확인(GET) — 창이 열려 있고 영상이 아직 보관 중일 때만 몇 초마다 부른다(원장 2026-10-01 *"완료되면 재생이 바로 되게"*).
 * 🔴 서버 액션이 아니라 라우트인 이유 = 주기 호출은 라우터 작업 큐를 지나지 않는 일반 fetch로(gotchas #137).
 * 게이트·격리는 답글 창 조회와 같은 함수 — 자격이 없으면 빈 지도(영상 주소 0). `/api`는 proxy 밖이라 세션 확인은 `getCurrentUser`가 한다. 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const messageId = new URL(request.url).searchParams.get("messageId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ videos: {} }, { headers: NO_STORE });
  try {
    return NextResponse.json({ videos: await getThreadVideoStates(messageId) }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.classnote.reply-videos" });
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
