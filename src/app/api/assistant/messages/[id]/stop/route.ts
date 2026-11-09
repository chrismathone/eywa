import { requestStop } from "@/features/assistant/server/store";
import { controlRunning } from "../control";

export const dynamic = "force-dynamic";

/** '멈춤' — 도는 질문에 표시만 남긴다(도는 쪽이 2초마다 보고 '질문을 멈췄습니다'로 저장한다). id·`?by=ref`는 control.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return controlRunning(request, params, requestStop, "api.assistant.stop", "멈추지 못했습니다", { allowLatest: true });
}
