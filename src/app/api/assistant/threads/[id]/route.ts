import { NextResponse } from "next/server";
import { z } from "zod";
import { logAction } from "@/features/audit/server/log";
import { assistantViewer, isGateFailure, scopedViewer } from "@/features/assistant/server/gate";
import { deleteThread, renameThread, THREAD_TITLE_MAX, threadDetail, threadRunning } from "@/features/assistant/server/store";
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
    // 3초 다시 읽기(도는 중인지만)는 권한 범위를 계산하지 않는다 — 내용이 나가지 않는다.
    if (new URL(request.url).searchParams.get("status") === "1") {
      return NextResponse.json({ running: await threadRunning(viewer.owner, id.data) }, NO_STORE);
    }
    const scoped = await scopedViewer();
    if (isGateFailure(scoped)) return NextResponse.json({ error: scoped.error }, { status: scoped.status, ...NO_STORE });
    const detail = await threadDetail(viewer.owner, id.data, scoped.scope);
    return detail ? NextResponse.json(detail, NO_STORE) : NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404, ...NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.assistant.thread", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "대화를 읽지 못했습니다" }, { status: 500, ...NO_STORE });
  }
}

const RenameBody = z.object({ title: z.string().trim().min(1, "이름을 적어 주세요").max(THREAD_TITLE_MAX, `이름은 ${THREAD_TITLE_MAX}자까지입니다`) });

/** 대화 이름 바꾸기(원장 2026-11-06 *"대화 이름 변경도 가능하게"*) — 본인 대화만. `{ title }` → `{ title }`(정리된 이름). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  const body = RenameBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "이름을 읽지 못했습니다" }, { status: 400 });
  try {
    const title = await renameThread(viewer.owner, id.data, body.data.title);
    if (!title) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
    await logAction({ action: "assistant_thread_rename", targetType: "assistant", targetLabel: id.data });
    return NextResponse.json({ title });
  } catch (error) {
    reportError(error, { scope: "api.assistant.thread.rename", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "이름을 바꾸지 못했습니다" }, { status: 500 });
  }
}

/** 대화 지우기(목록에서 감춘다 — 기록은 남는다). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  try {
    const deleted = await deleteThread(viewer.owner, id.data);
    if (deleted === "running") return NextResponse.json({ error: "답을 만드는 중인 대화는 지울 수 없습니다. 멈추거나 끝난 뒤 지워 주세요" }, { status: 409 });
    if (deleted === "missing") return NextResponse.json({ error: "대화를 찾지 못했습니다" }, { status: 404 });
    await logAction({ action: "assistant_thread_delete", targetType: "assistant", targetLabel: id.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError(error, { scope: "api.assistant.thread.delete", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "대화를 지우지 못했습니다" }, { status: 500 });
  }
}
