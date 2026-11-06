import { NextResponse } from "next/server";
import { z } from "zod";
import { assistantViewer, isGateFailure } from "@/features/assistant/server/gate";
import { requestStop, requestStopCurrent } from "@/features/assistant/server/store";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";

/**
 * '멈춤' — 도는 질문에 표시만 남긴다(도는 쪽이 2초마다 보고 멈춘다 · 다른 서버 인스턴스에서 돌아도 같다).
 * id = `current`면 '지금 도는 내 질문'(사람당 하나 — 고유 색인) — 화면이 번호를 모르거나 번호로 보낸 멈춤이 실패했을 때(재리뷰 2026-11-06).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  const current = raw === "current";
  const id = z.string().uuid().safeParse(raw);
  if (!current && !id.success) return NextResponse.json({ error: "질문을 찾지 못했습니다" }, { status: 404 });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  try {
    return NextResponse.json({ ok: current ? await requestStopCurrent(viewer.owner) : await requestStop(viewer.owner, id.data!) });
  } catch (error) {
    reportError(error, { scope: "api.assistant.stop", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "멈추지 못했습니다" }, { status: 500 });
  }
}
