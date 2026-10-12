import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reconcileVideoHomework } from "@/features/video-homework/server/reconcile-outcomes";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const users = await fetchAllPaged<{ tenant_id: string }>((from, to) => db.from("users").select("tenant_id")
    .eq("system_role", "master").eq("status", "active").order("id").range(from, to));
  let checked = 0, updated = 0, notifications = 0, failed = 0;
  for (const tenantId of new Set(users.map(user => user.tenant_id))) {
    try {
      const result = await reconcileVideoHomework(tenantId);
      checked += result.checked; updated += result.updated; notifications += result.notifications;
    } catch (error) { failed++; reportError(error, { scope: "cron.video-homework", tenantId }); }
  }
  return NextResponse.json({ ok: failed === 0, checked, updated, notifications, failed }, { status: failed ? 500 : 200 });
}
