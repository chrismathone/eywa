import { NextResponse } from "next/server";
import { z } from "zod";
import { logAction } from "@/features/audit/server/log";
import { ADVICE_RATINGS, ADVICE_STATUSES, ADVICE_STATUS_LABEL } from "@/features/assistant/advice";
import { updateAdvice } from "@/features/assistant/server/advice-store";
import { isGateFailure, scopedViewer } from "@/features/assistant/server/gate";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
const Id = z.string().uuid();
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 처리 시각(낙관적 잠금) — DB가 돌려준 timestamptz 글자 그대로. 모양이 틀리면 DB 형식 오류(500) 대신 400(적대 리뷰 2026-11-09).
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

const Body = z.object({
  status: z.enum(ADVICE_STATUSES, { message: "처리 상태를 읽지 못했습니다" }),
  statusAt: z.string({ message: "처리 시각을 읽지 못했습니다. 대화를 다시 열어 주세요" }).regex(TIMESTAMP, "처리 시각을 읽지 못했습니다. 대화를 다시 열어 주세요"),
  memo: z.string().max(500, "메모는 500자까지입니다").nullable().optional(),
  doneOn: z
    .string()
    .regex(YMD, "날짜를 읽지 못했습니다")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "있는 날짜가 아닙니다")
    .nullable()
    .optional(),
  selfRating: z.enum(ADVICE_RATINGS, { message: "평가를 읽지 못했습니다" }).nullable().optional(),
});

/**
 * 비서 의견 처리(제안 → 결과 → 학습 1단계 · 2026-11-09) — 채택 · 완료 · 보류 · 안 함 · 처리 전으로. 본인 대화의 의견만.
 * `{ status, statusAt, memo?, doneOn?, selfRating? }` → `{ advice }`. 그 사이 다른 곳에서 바꿨으면 409.
 * 감사 기록에 메모 원문은 남기지 않는다(원생 이름·사정이 들 수 있다 — 처리 이력 표에만).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "의견을 찾지 못했습니다" }, { status: 404 });
  const viewer = await scopedViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "처리 내용을 읽지 못했습니다" }, { status: 400 });
  if (body.data.doneOn && body.data.doneOn > kstToday()) return NextResponse.json({ error: "한 날은 오늘보다 뒤일 수 없습니다" }, { status: 400 });
  try {
    const out = await updateAdvice(viewer.owner, id.data, body.data, viewer.scope);
    if (!out.ok) {
      return out.reason === "missing"
        ? NextResponse.json({ error: "의견을 찾지 못했습니다" }, { status: 404 })
        : out.reason === "deleted"
          ? NextResponse.json({ error: "지운 대화의 의견이라 처리할 수 없습니다" }, { status: 404 })
          : NextResponse.json({ error: "다른 곳에서 먼저 바꿨습니다. 대화를 다시 열거나 '지난 의견'을 새로 고쳐 확인해 주세요", code: "stale" }, { status: 409 });
    }
    await logAction({
      action: "assistant_advice_update",
      targetType: "assistant",
      targetLabel: `비서 의견 ${ADVICE_STATUS_LABEL[out.from]} → ${ADVICE_STATUS_LABEL[body.data.status]}`,
      metadata: { adviceId: id.data, from: out.from, to: body.data.status, ...(out.view.selfRating ? { selfRating: out.view.selfRating } : {}) },
    });
    return NextResponse.json({ advice: out.view });
  } catch (error) {
    reportError(error, { scope: "api.assistant.advice.update", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ error: "처리를 저장하지 못했습니다" }, { status: 500 });
  }
}
