import { analyticsAccess } from "@/features/management-analytics/server/access";
import { analyzeUpload, readUpload } from "@/features/management-analytics/server/upload";
import { AnalysisError, type AnalysisResult } from "@/features/management-analytics/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(body: AnalysisResult, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request) {
  try {
    const access = await analyticsAccess();
    if (!access.ok) return respond({ ok: false, error: access.status === 401 ? "로그인이 필요합니다." : "분석 권한이 없습니다." }, access.status);
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("x-aywa-analytics") !== "1")
      return respond({ ok: false, error: "현재 화면에서 다시 시도해 주세요." }, 403);
    const result = await analyzeUpload(await readUpload(request), access.user.tenantId);
    return respond(result, result.ok ? 200 : 422);
  } catch (error) {
    // Deliberately do not log exceptions, filenames, CSV values, or row identifiers.
    return respond({ ok: false, error: error instanceof AnalysisError ? error.message : "분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." }, error instanceof AnalysisError ? error.status : 500);
  }
}
