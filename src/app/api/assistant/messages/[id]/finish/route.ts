import { requestWrap } from "@/features/assistant/server/store";
import { controlRunning } from "../control";

export const dynamic = "force-dynamic";

/**
 * '여기서 끝내고 결과 보기'(원장 2026-11-06 *"조회 멈추고, 지금까지 조회한 내용으로만 결과 출력"*) — 도는 질문에 표시만 남긴다.
 * 도는 쪽이 2초마다 보고 더 조회하지 않고 지금까지의 결과로 보고서를 쓴다(agent.ts wrapSignal). id·`?by=ref`는 control.ts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return controlRunning(request, params, requestWrap, "api.assistant.finish", "결과 정리를 부탁하지 못했습니다");
}
