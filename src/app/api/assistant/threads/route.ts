import { NextResponse } from "next/server";
import { assistantViewer, isGateFailure } from "@/features/assistant/server/gate";
import { listThreads } from "@/features/assistant/server/store";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** 학원 비서 대화 목록(본인 것만) — 표가 아직 없는 DB면 enabled:false. 셸이 저절로 부르는 조회라 GET(#137). AI는 부르지 않는다. */
export async function GET() {
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ enabled: false, threads: [], error: viewer.error }, { status: viewer.status, ...NO_STORE });
  try {
    return NextResponse.json(await listThreads(viewer.owner), NO_STORE);
  } catch (error) {
    reportError(error, { scope: "api.assistant.threads", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ enabled: false, threads: [], error: "대화 목록을 읽지 못했습니다" }, { status: 500, ...NO_STORE });
  }
}
