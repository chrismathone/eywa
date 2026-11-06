import { NextResponse } from "next/server";
import { z } from "zod";
import { logAction } from "@/features/audit/server/log";
import { assistantViewer, isGateFailure } from "@/features/assistant/server/gate";
import { deleteThread, threadDetail, threadRunning } from "@/features/assistant/server/store";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const Id = z.string().uuid();

/**
 * 대화 한 편(본인 것만). `?status=1`이면 아직 도는 질문이 있는지만(`{ running }`) — 화면의 3초 다시 읽기가 대화 전체(표·차트 자료)를
 * 매번 받지 않게(재리뷰 2026-11-06). 다른 사람 대화도 `false`라 있는지 없는지가 새지 않는다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404, ...NO_STORE });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status, ...NO_STORE });
  try {
    if (new URL(request.url).searchParams.get("status") === "1") {
      return NextResponse.json({ running: await threadRunning(viewer.owner, id.data) }, NO_STORE);
    }
    const detail = await threadDetail(viewer.owner, id.data);
    return detail ? NextResponse.json(detail, NO_STORE) : NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404, ...NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.assistant.thread", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "대화를 읽지 못했습니다" }, { status: 500, ...NO_STORE });
  }
}

/** 대화 지우기(목록에서 감춘다 — 기록은 남는다). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  try {
    if (!(await deleteThread(viewer.owner, id.data))) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
    await logAction({ action: "assistant_thread_delete", targetType: "assistant", targetLabel: id.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError(error, { scope: "api.assistant.thread.delete", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "대화를 지우지 못했습니다" }, { status: 500 });
  }
}
