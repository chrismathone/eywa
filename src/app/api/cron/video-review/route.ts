import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { runVideoReviewCycle } from "@/features/video-review/server/cycle";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 영상 설명 AI 참고 메모(0390a) — 10분마다: 대기열 · 전사 맡기기·받기 · 배치 수거 · 확인 배치 · (밤에만) 판정 배치.
 * 지점 스위치(`video_review`)가 꺼진 지점은 runVideoReviewCycle이 바로 돌아선다.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const users = await fetchAllPaged<{ tenant_id: string }>((from, to) => db.from("users").select("tenant_id")
    .eq("system_role", "master").eq("status", "active").order("id").range(from, to));
  const reports: Record<string, unknown> = {};
  let failed = 0;
  for (const tenantId of new Set(users.map((user) => user.tenant_id))) {
    try {
      const report = await runVideoReviewCycle(tenantId);
      if (report) reports[tenantId] = report;
    } catch (error) { failed++; reportError(error, { scope: "cron.video-review", tenantId }); }
  }
  return NextResponse.json({ ok: failed === 0, reports, failed }, { status: failed ? 500 : 200 });
}
