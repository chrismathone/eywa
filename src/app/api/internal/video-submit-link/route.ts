import { NextResponse } from "next/server";
import { secretMatches } from "@/lib/http/secret-compare";
import { reportVideoLinkToken } from "@/features/video-submit/server/report-link";

/**
 * 발송 PC 워커 전용 — 수업보고서를 ClassNote에 올리기 직전, 이 보고서 글에 붙일 **영상 제출 링크 토큰**을 받는다.
 * ⚠️ `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET` 게이트(보고서 첨부·스크린샷과 같은 시크릿).
 * 붙일 게 없으면 `{ token: null }`(200) — 워커는 줄 없이 그대로 보낸다. 🔴 실패도 null로 돌려준다: 이 경로가 보고서 발송을 막으면 안 된다.
 * 응답의 토큰 원문은 이 한 번뿐이다(DB엔 해시만).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-eywa-internal"), process.env.CLASSNOTE_INTERNAL_SECRET))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reportId?: unknown } | null;
  try {
    return NextResponse.json({ token: await reportVideoLinkToken(body?.reportId) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.reportLink", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ token: null });
  }
}
