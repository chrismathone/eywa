import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { runReportRatingCycle } from "@/features/report-rating/server/cycle";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 수업보고서 평점 정기 처리(2026-10-26 크레딧 MVP · 0455a) — 새 발송분 줄 세우기 · 배치 수거 · 배치 보내기.
 * 🔴 기본 꺼짐: 지점 스위치('report_rating', 운영 콘솔)가 꺼진 지점은 runReportRatingCycle이 바로 돌아선다.
 * vercel.json에 30분마다 등록(2026-10-26 원장 "진행해") — 스위치가 꺼진 지점은 바로 돌아서고, 0455a가 없으면 '준비 안 됨'으로 멈춘다.
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
      const report = await runReportRatingCycle(tenantId);
      if (report) reports[tenantId] = report;
    } catch (error) { failed++; reportError(error, { scope: "cron.report-ratings", tenantId }); }
  }
  return NextResponse.json({ ok: failed === 0, reports, failed }, { status: failed ? 500 : 200 });
}
