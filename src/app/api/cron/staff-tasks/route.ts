import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";

/**
 * 할 일 30분 맞춤(0377a `staff_tasks_sync`) — 원래 기록과 다시 맞춘다: 기한 날이 된 상담 후속조치를 열고,
 * 트리거가 놓친 실패를 메우고, 이미 나간 보고서·완료한 후속조치·기한 지난 재발송을 닫는다. 지점마다 한 번 ·
 * 종류마다 따로(0378a `sync_<종류>`).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const users = await fetchAllPaged<{ tenant_id: string }>((from, to) => db.from("users").select("tenant_id")
    .eq("system_role", "master").eq("status", "active").order("id").range(from, to));
  let opened = 0, closed = 0, failed = 0;
  for (const tenantId of new Set(users.map((u) => u.tenant_id))) {
    const { data, error } = await db.rpc("staff_tasks_sync", { p_tenant: tenantId });
    if (error) { failed++; reportError(error, { scope: "cron.staff-tasks", tenantId }); continue; }
    const result = data as { opened?: number; closed?: number; errors?: Record<string, string> } | null;
    opened += Number(result?.opened ?? 0);
    closed += Number(result?.closed ?? 0);
    // 종류별로 따로 감싸 돈다(0378a) — 한 종류가 실패해도 나머지는 맞춰졌다. 실패한 종류는 조용히 넘기지 않는다.
    const kindErrors = Object.entries(result?.errors ?? {});
    if (kindErrors.length) {
      failed++;
      for (const [kind, message] of kindErrors) reportError(new Error(message), { scope: "cron.staff-tasks.kind", tenantId, kind });
    }
  }
  return NextResponse.json({ ok: failed === 0, opened, closed, failed }, { status: failed ? 500 : 200 });
}
