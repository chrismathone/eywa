import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { kstToday } from "@/lib/date-kst";
import { closeActiveEnrollmentsClamped, listOpenEnrollments } from "@/features/students/server/enrollment-sync";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import type { createClient } from "@/lib/supabase/server";
import { applyDueWithdrawalReports } from "@/features/withdrawal-reports/server/scheduled";

/**
 * **퇴원 예약을 그날 적용**하는 cron(매일 00:05 KST — 퇴원일이 된 날 자정 직후).
 *
 * 원장 2026-09-28: *"퇴원이 미래인학생은 퇴원당일전까지 '재원'임."* → 미래 퇴원일로 저장하면 상태·수강은 그대로 두고
 * 퇴원일·사유만 적는다(`changeStudentStatus`·`updateStudent`). 여기서 그날이 된 예약을 **퇴원 저장과 같은 함수**
 * (`closeActiveEnrollmentsClamped`, 종료일 = 퇴원일)로 마저 처리한다.
 * 예약 표식 = 상태가 퇴원이 아닌데 `withdrawn_at`이 있다(복구·예약 취소는 둘 다 비운다 — 실측 2026-09-28 그런 행 0건).
 *
 * 🔴 조건부 갱신 — 그 사이 누가 예약을 취소하거나 날짜를 바꿨으면(`withdrawn_at` 불일치) 건드리지 않는다.
 * 🔴 감사로그는 학생마다 — 로그인한 사람이 없어 행위자는 문 이름(`logActionAs`)이다.
 * ⚠️ 하루를 놓쳐도(cron 실패) 다음 날 `withdrawn_at ≤ 오늘`로 다시 잡힌다 — 종료일은 예약된 날 그대로다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTOR = "시스템(퇴원일 도래)";

type Due = {
  id: string;
  tenant_id: string;
  status: string;
  name: string | null;
  withdrawn_at: string;
  withdrawal_metadata: { reason?: string | null } | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // admin은 RLS 우회 — 테넌트는 행마다 들고 다니며(tenant_id) 갱신·수강 종료는 학생 id로만 좁힌다.
  const db = admin as unknown as Awaited<ReturnType<typeof createClient>>;
  const today = kstToday();
  const { data, error } = await admin
    .from("students")
    .select("id, tenant_id, status, name, withdrawn_at, withdrawal_metadata")
    .neq("status", "withdrawn")
    .not("withdrawn_at", "is", null)
    .lte("withdrawn_at", today)
    .order("id")
    .limit(500);
  if (error) {
    reportError(error, { where: "apply-due-withdrawals" });
    return NextResponse.json({ ok: false, error: "퇴원 예약을 불러오지 못했습니다" }, { status: 500 });
  }

  let applied = 0;
  let failed = 0;
  for (const s of (data ?? []) as Due[]) {
    const date = String(s.withdrawn_at).slice(0, 10);
    const reason = s.withdrawal_metadata?.reason ?? null;
    try {
      const { rows: closing } = await listOpenEnrollments(db, s.id);
      const { data: upd, error: uErr } = await admin
        .from("students")
        .update({ status: "withdrawn" })
        .eq("id", s.id)
        .eq("tenant_id", s.tenant_id)
        .neq("status", "withdrawn")
        .eq("withdrawn_at", s.withdrawn_at)
        .select("id");
      if (uErr) throw uErr;
      if (!upd || upd.length === 0) continue; // 그 사이 취소·변경됨
      const enrErr = await closeActiveEnrollmentsClamped(db, s.id, date, reason ? { withdrawal_reason: reason } : {});
      if (enrErr) {
        // 🔴 상태만 퇴원이고 수강이 열린 채로 남으면 다음 날 조회(`status ≠ 퇴원`)에서 빠져 영영 안 고쳐진다 —
        //    상태를 되돌려 다음 실행이 다시 잡게 한다(수강 종료는 `end_date is null`만 건드려 다시 돌아도 안전).
        const { error: revertErr } = await admin
          .from("students")
          .update({ status: s.status })
          .eq("id", s.id)
          .eq("tenant_id", s.tenant_id)
          .eq("withdrawn_at", s.withdrawn_at);
        if (revertErr) reportError(revertErr, { where: "apply-due-withdrawals.revert", studentId: s.id });
        failed++;
        reportError(new Error(enrErr), { where: "apply-due-withdrawals.enrollments", studentId: s.id });
        continue;
      }
      await logActionAs(
        { tenantId: s.tenant_id, actorName: ACTOR },
        {
          action: "student_withdraw",
          targetType: "student",
          targetLabel: s.name,
          metadata: {
            studentId: s.id,
            date,
            reason,
            applied: "scheduled",
            enrollmentIds: closing.map((r) => r.id),
            classIds: closing.map((r) => r.classId),
          },
        },
      );
      // 수학 퇴원이면 '퇴원생 관리 차트' 시트에 적는다(원장 2026-10-07) — 던지지 않는다(실패는 로그만).
      await recordMathWithdrawalToSheet({ tenantId: s.tenant_id, studentId: s.id, date });
      applied++;
    } catch (e) {
      failed++;
      reportError(e, { where: "apply-due-withdrawals", studentId: s.id });
    }
  }
  const reports = await applyDueWithdrawalReports();
  if (applied + failed + reports.applied + reports.blocked + reports.released > 0) {
    revalidatePath("/withdrawal-reports", "layout");
    revalidatePath("/students", "layout");
    revalidatePath("/withdrawals", "layout");
    revalidatePath("/dashboard", "layout");
    revalidatePath("/timetable", "layout");
  }
  return NextResponse.json({ ok: failed + reports.failed === 0, applied, failed, reports });
}
