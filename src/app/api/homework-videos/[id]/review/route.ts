import { NextResponse } from "next/server";
import { reviewAccess, reviewViewFor } from "@/features/video-review/server/view";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";

/**
 * 영상 설명 AI 참고 메모 읽기 — 재생과 같은 권한. 저장된 결과만 돌려준다(이 요청은 AI를 부르지 않는다 —
 * CLAUDE.md '페이지 로드만으로 새 호출 안 함'). 스위치가 꺼진 지점·볼 수 없는 영상은 404/403.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const videoId = (await params).id;
  try {
    const access = await reviewAccess(videoId);
    if (!access.ok) return NextResponse.json({ error: "볼 수 없는 영상입니다" }, { status: access.status });
    return NextResponse.json({ view: await reviewViewFor(access.tenantId, videoId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    reportError(error, { scope: "video-review.view", videoId });
    return NextResponse.json({ error: "AI 참고 메모를 불러오지 못했습니다" }, { status: 500 });
  }
}
