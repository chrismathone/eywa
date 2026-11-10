import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { runConsultationRatingCycle } from "@/features/consultation-rating/server/cycle";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 원생상담 평점 정기 처리(2026-11-11 · s2_0044) — 새로 입력됐거나 고쳐진 상담 줄 세우기 · 배치 수거 · 배치 보내기.
 * 🔴 기본 꺼짐: 지점 스위치('consult_rating', 운영 콘솔)가 꺼진 지점은 runConsultationRatingCycle이 바로 돌아선다.
 * 수업보고서 평점(/api/cron/report-ratings)과 같은 모양 — 상담은 하루 수십 건이라 30분마다 한 바퀴면 충분하다(정각을 피해 12·42분).
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
      const report = await runConsultationRatingCycle(tenantId);
      if (report) reports[tenantId] = report;
    } catch (error) { failed++; reportError(error, { scope: "cron.consultation-ratings", tenantId }); }
  }
  return NextResponse.json({ ok: failed === 0, reports, failed }, { status: failed ? 500 : 200 });
}
