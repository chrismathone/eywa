import { NextResponse } from "next/server";
import { assistantViewer, isGateFailure } from "@/features/assistant/server/gate";
import { listAdvice } from "@/features/assistant/server/advice-list";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * 학원 비서 '지난 의견'(제안 → 결과 → 학습 3단계 첫 조각 · 2026-11-10) — 본인 의견 전부 · 지운 대화 제외 → `{ items }`.
 * 판을 열고 '지난 의견'을 누를 때만 부른다(GET · #137). AI는 부르지 않는다.
 */
export async function GET() {
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ items: [], error: viewer.error }, { status: viewer.status, ...NO_STORE });
  try {
    return NextResponse.json({ items: await listAdvice(viewer.owner) }, NO_STORE);
  } catch (error) {
    reportError(error, { scope: "api.assistant.advice.list", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ items: [], error: "지난 의견을 읽지 못했습니다" }, { status: 500, ...NO_STORE });
  }
}
