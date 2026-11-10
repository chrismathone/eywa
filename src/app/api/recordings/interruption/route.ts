import { NextResponse } from "next/server";
import { recordRecordingInterruption } from "@/features/media/server/recording-report";
import { reportError } from "@/lib/observability/report-error";

/**
 * 녹음 중단 진단 받기(POST) — 셸의 녹음 런타임이 마운트·페이지 닫힘 때 저절로 보낸다(`recording-diagnostics.ts`).
 * 🔴 서버 액션이 아니라 라우트인 까닭 = gotchas #137(셸에서 저절로 부르는 서버 액션은 라우터 작업 큐와 엉켜 영어 기본 오류 화면).
 * 인증·소유자 대조·하루 상한은 `recordRecordingInterruption` 한 곳(종전 액션 본문 그대로). 응답 `{ ok }` — false면 브라우저가 다음 접속 때 다시 보낸다.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await recordRecordingInterruption(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportError(error, { scope: "api.recordings.interruption" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
