import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { runManagementAgent } from "@/features/management-agent/server/worker";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const db = createAdminClient();
    const masters = await fetchAllPaged<{ tenant_id: string }>((from,to) => db.from("users").select("tenant_id")
      .eq("system_role", "master").eq("status", "active").order("id").range(from,to));
    let changed = 0, failed = 0;
    for (const tenantId of new Set(masters.map((u) => u.tenant_id))) {
      try { const result = await runManagementAgent(tenantId); changed += result.changed; if (result.error) failed++; }
      catch { failed++; reportError(new Error("후속조치 확인 실패"), { scope: "cron.management-agent" }); }
    }
    return NextResponse.json({ ok: failed === 0, changed, failed }, { status: failed ? 503 : 200 });
  } catch {
    reportError(new Error("후속조치 대상 조회 실패"), { scope: "cron.management-agent" });
    return NextResponse.json({ error: "대상 학원을 확인하지 못했습니다." }, { status: 503 });
  }
}
