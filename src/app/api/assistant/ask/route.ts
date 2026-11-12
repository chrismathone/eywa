import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prepareAsk } from "@/features/assistant/server/ask";
import { ASSISTANT_LEVELS } from "@/features/assistant/levels";
import { ASSISTANT_QUESTION_MAX, type AskEvent } from "@/features/assistant/protocol";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
/**
 * Vercel Pro 최대(800초) — 원장 2026-11-06 *"한도 두지마"*: 조회 횟수 한도를 없앴고, 전수 조회 + 깊은 분석은 몇 분이 걸릴 수 있다.
 * 서버는 ASSISTANT_HARD_DEADLINE_MS(760초)에 스스로 끊고 저장한다.
 */
export const maxDuration = 800;

const Body = z.object({
  threadId: z.string().uuid().nullish(),
  question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX),
  level: z.enum(ASSISTANT_LEVELS),
  // 화면이 보낼 때 만든 번호 — 질문 번호를 받기 전에 누른 멈춤·마무리가 이 질문을 찾는다(SQL s2_0034).
  clientRef: z.string().uuid().nullish(),
  // 강도를 올려 다시 묻는 원래 질문 — 그 답을 이력에서 뺀다(2026-11-12).
  redoOf: z.string().uuid().nullish(),
});

/**
 * 학원 비서 질문 — 응답은 한 줄에 JSON 하나(NDJSON) 흐름(`AskEvent`). 시작 전에 막히면 JSON 오류.
 * 🔴 화면 연결이 끊겨도 서버는 끝까지 돌고 저장한다(`after`로 함수 수명을 잡는다) — 화면은 대화를 다시 읽는다.
 *    멈춤은 사람이 누른 '멈춤'(`POST /api/assistant/messages/[id]/stop`)만 · '바로 결과 보기'는 `/finish`.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "질문을 읽지 못했습니다. 다시 보내 주세요" }, { status: 400 });
  let prepared: Awaited<ReturnType<typeof prepareAsk>>;
  try {
    prepared = await prepareAsk(parsed.data);
  } catch (error) {
    reportError(error, { scope: "api.assistant.ask.prepare" });
    return NextResponse.json({ error: "학원 비서를 시작하지 못했습니다. 잠시 뒤 다시 물어봐 주세요" }, { status: 500 });
  }
  if ("error" in prepared) return NextResponse.json({ error: prepared.error, ...(prepared.code ? { code: prepared.code } : {}) }, { status: prepared.status });
  const { run, messageId } = prepared;

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const push = (event: AskEvent) => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      open = false; // 화면이 떠났다 — 일은 계속한다
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  const work = run(push)
    .catch((error: unknown) => {
      reportError(error, { scope: "api.assistant.ask.run" });
      push({ type: "error", message: "답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요", messageId });
    })
    .finally(() => {
      if (!open) return;
      open = false;
      try {
        controller?.close();
      } catch {
        // 이미 닫혔다
      }
    });
  after(() => work);
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
