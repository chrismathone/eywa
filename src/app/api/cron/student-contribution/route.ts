import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActionAs } from "@/features/audit/server/log";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { refreshStudentContribution } from "@/features/student-contribution/server/refresh";
import { CONTRIBUTION_PILOT_TENANT } from "@/features/student-contribution/model/access";
import { contributionSnapshotTag } from "@/features/student-contribution/server/snapshot-cache";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization") ?? "", secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = CONTRIBUTION_PILOT_TENANT;
  if (!(await isLaboratoryMenuAvailable(tenant, "student_contribution"))) return NextResponse.json({ skipped: true });
  try {
    const result = await refreshStudentContribution(createAdminClient(), tenant, { nightly: true, deadline: Date.now() + 250_000 });
    if (result.written) await logActionAs({ tenantId: tenant, actorName: "system:student-contribution" },
      { action: "student_contribution_refresh", targetType: "student_contribution", targetLabel: "원생 로열티", metadata: { ...result, trigger: "cron" } });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[student-contribution] 집계 실패", error);
    return NextResponse.json({ error: "기여도 집계 실패" }, { status: 500 });
  } finally {
    // 부분 저장 후 실패한 경우에도 다음 조회에서 새 월 기록을 읽는다.
    revalidateTag(contributionSnapshotTag(tenant), { expire: 0 });
  }
}
