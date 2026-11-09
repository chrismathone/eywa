import { NextResponse } from "next/server";
import { z } from "zod";
import { assistantViewer, isGateFailure } from "@/features/assistant/server/gate";
import type { MessageTarget, Owner } from "@/features/assistant/server/store";
import { reportError } from "@/lib/observability/report-error";

/**
 * 도는 질문에 표시만 남기는 두 손잡이('멈춤' · '바로 결과 보기')의 공통 — 도는 쪽이 2초마다 보고 따른다(다른 서버 인스턴스에서 돌아도 같다).
 * id = 질문 번호(`started`). `?by=ref`면 화면이 보낼 때 만든 번호(clientRef) — 질문 번호를 받기 전에 누른 경우(동시에 여러 질문이 돌 수 있어
 * '지금 도는 내 질문'으로는 어느 것인지 모른다 · SQL s2_0033).
 */
export async function controlRunning(
  request: Request,
  params: Promise<{ id: string }>,
  act: (owner: Owner, target: MessageTarget) => Promise<boolean>,
  scope: string,
  failMessage: string,
  opts: { allowLatest?: boolean } = {},
): Promise<NextResponse> {
  const raw = (await params).id;
  const byRef = new URL(request.url).searchParams.get("by") === "ref";
  // 배포 전에 열린 옛 화면은 `current`(그 화면은 한 번에 하나만 묻는다)를 보낸다 — 멈춤에만 받는다(적대 리뷰 2026-11-09).
  const latest = raw === "current" && opts.allowLatest;
  const id = z.string().uuid().safeParse(raw);
  if (!latest && !id.success) return NextResponse.json({ error: "질문을 찾지 못했습니다" }, { status: 404 });
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  try {
    const target: MessageTarget = latest ? { latest: true } : byRef ? { clientRef: id.data! } : { messageId: id.data! };
    return NextResponse.json({ ok: await act(viewer.owner, target) });
  } catch (error) {
    reportError(error, { scope, tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: failMessage }, { status: 500 });
  }
}
