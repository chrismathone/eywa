import { after, NextResponse } from "next/server";
import { startLinkUpload } from "@/features/video-submit/server/upload-start";
import { afterLinkUpload } from "@/features/video-submit/server/upload-notify";

/**
 * 공개 제출 링크(`/v/<토큰>`) — 업로드 시작. 로그인 없음: 토큰이 지점·학생·반을 정한다(서버가 매번 확인).
 * 라우트 핸들러인 이유: 큰 영상은 몇 분이 걸려 그 사이 배포가 바뀔 수 있다 — 서버 액션 번호는 배포마다 바뀌어
 * 올리던 화면의 "끝났다" 알림이 길을 잃는다. 주소가 고정인 라우트는 안 바뀐다.
 * 응답은 Drive 세션 주소뿐(영상 바이트는 이 함수를 지나지 않는다). 지난번에 못 알린 업로드를 대신 마무리했으면 응답 뒤 알림·감사로그.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; name?: unknown; size?: unknown; type?: unknown } | null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const { result, followUp } = await startLinkUpload({
    token: body?.token, file: { name: body?.name, size: body?.size, type: body?.type }, origin: request.headers.get("origin"), host,
  });
  if (followUp) after(async () => { await Promise.all((await followUp()).map((done) => afterLinkUpload(done))); });
  return NextResponse.json(result, { status: !result.ok && result.code === "limit" ? 429 : 200, headers: { "Cache-Control": "no-store" } });
}
