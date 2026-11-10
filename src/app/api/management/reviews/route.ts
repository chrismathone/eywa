import { managementAccess } from "@/features/management/server/access";
import { appendReview } from "@/features/management/server/reviews";
import { failure, forbidden, noStore, sameOrigin, wrongOrigin } from "@/features/management/server/http";
import { ManagementInputError } from "@/features/management/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 원본 대사 확인 항목에 상태·담당·기한·메모를 덧붙인다(버전 비교 · 청구 수정·회계 마감 확정이 아니다). */
export async function POST(request: Request) {
  try { await managementAccess(true); } catch { return forbidden(); }
  if (!sameOrigin(request)) return wrongOrigin();
  try {
    const raw = await request.text();
    if (raw.length > 10_000) throw new ManagementInputError("확인 기록이 너무 깁니다");
    return noStore({ version: await appendReview(JSON.parse(raw)) });
  } catch (e) {
    return failure(e, "api/management/reviews", "확인 항목·상태·메모를 확인해 주세요", "확인 기록을 저장하지 못했습니다");
  }
}
