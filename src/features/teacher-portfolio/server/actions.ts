"use server";

// 직원 포트폴리오 [지금 집계] — 매일 cron을 기다리지 않고 이 지점의 점수를 다시 집계한다.
// 계산은 cron과 같은 함수(refresh.ts)다. 마감한 달은 다시 쓰지 않는다.
import { revalidatePath, updateTag } from "next/cache";
import { teacherChurnTag } from "@/features/withdrawals/teacher-churn";
import { logAction } from "@/features/audit/server/log";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortfolioGate } from "./queries";
import { refreshTenantPortfolio } from "./refresh";

export type PortfolioRefreshState = { ok: boolean; error?: string; notice?: string };

export async function refreshTeacherPortfolioNow(): Promise<PortfolioRefreshState> {
  const gate = await getPortfolioGate();
  const user = await getCurrentUser({ teacherView: true });
  if (!gate || !user) return { ok: false, error: "직원 포트폴리오를 집계할 권한이 없습니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  if (!(await canWriteTenant(user.systemRole, "class_review"))) return { ok: false, error: "직원 포트폴리오를 집계할 권한이 없습니다" };

  let summary;
  try {
    summary = await refreshTenantPortfolio(createAdminClient(), gate.tenantId);
  } catch (e) {
    // 화면엔 한글 요약만 — DB 원문은 로그로.
    reportWarning("직원 포트폴리오 집계 실패", { scope: "refreshTeacherPortfolioNow", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "집계에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }
  if (summary.tableMissing) return { ok: false, error: "직원 포트폴리오 저장 준비가 아직 끝나지 않았습니다" };
  await logAction({
    action: "teacher_portfolio_refresh", targetType: "teacher_portfolio", targetLabel: "직원 포트폴리오",
    metadata: { trigger: "manual", periodEnd: summary.periodEnd, teachers: summary.teachers, written: summary.written, closedMonths: summary.closedMonths },
  });
  revalidatePath("/class-review");
  // 퇴원관리 '강사별 퇴원율 추이'는 같은 저장값을 5분 캐시로 읽는다 — 방금 집계한 값이 그쪽에도 바로 서게 비운다.
  updateTag(teacherChurnTag(gate.tenantId));
  return {
    ok: true,
    notice: summary.closedMonths.length
      ? `강사 ${summary.teachers}명을 집계하고 ${summary.closedMonths.length}개 달을 마감했습니다`
      : `강사 ${summary.teachers}명을 집계했습니다`,
  };
}
