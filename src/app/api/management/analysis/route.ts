import { z } from "zod";
import { monthSchema } from "@/features/management/model";
import { managementAccess } from "@/features/management/server/access";
import { runManagementAiReview } from "@/features/management/server/ai-review";
import { failure, forbidden, noStore, sameOrigin, wrongOrigin } from "@/features/management/server/http";

export const runtime = "nodejs";
export const maxDuration = 120; // 지표 다시 계산 + AI 50초 + 저장 — 60초면 AI 과금 뒤 저장 전에 끊길 수 있다

/** 'AI 검토' 버튼 전용 — 페이지 로드는 이 라우트를 부르지 않는다. 결과는 DB에 남고 화면은 그 값을 다시 읽는다. */
export async function POST(request: Request) {
  try { await managementAccess(true); } catch { return forbidden(); }
  if (!sameOrigin(request)) return wrongOrigin();
  try {
    const input = z.object({ month: monthSchema }).strict().parse(await request.json());
    return noStore({ review: await runManagementAiReview(input.month) });
  } catch (e) {
    return failure(e, "api/management/analysis", "분석 월을 확인해 주세요", "AI 검토를 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}
