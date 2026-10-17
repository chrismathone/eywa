import { bearerMatches } from "@/lib/http/secret-compare";
import { syncTodaysMathResults } from "@/features/integrations/todays-math/results-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** 오늘 수학 채점 결과 끌어오기 — 신호(results-wake)가 빠졌을 때의 안전망, 1시간마다(0371a). 지점 이름·학생 정보는 응답에 싣지 않는다. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !bearerMatches(request.headers.get("authorization") ?? "", secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return Response.json({ tenants: await syncTodaysMathResults() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "results_sync_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
