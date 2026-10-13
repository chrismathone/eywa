import { NextResponse } from "next/server";
import { logActionAs } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { refreshTenantPortfolio, rotateForDay } from "@/features/teacher-portfolio/server/refresh";
import { kstToday } from "@/lib/date-kst";
import { bearerMatches } from "@/lib/http/secret-compare";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { isModuleEnabled } from "@/lib/modules";
import { reportError } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * **직원 포트폴리오 매일 집계** cron (매일 00:10 KST = 15:10 UTC, vercel.json).
 *
 * 수업 대상은 한국 시간 어제까지다. 1일 새벽에 돌면 지난달이 말일까지 다 찬 달이 되어 그때 마감된다
 * (원장 2026-10-12: *"모든 점수는 말일 마감하고 1일부터 새점수"*). 마감한 달은 다시 쓰지 않는다.
 * 계산은 화면의 [지금 집계]와 같은 함수다(features/teacher-portfolio/server/refresh.ts).
 *
 * 대상 = 활성 원장이 있고 직원 평가 기능이 켜진 지점. 꺼진 지점은 화면도 없으니 집계도 하지 않는다.
 * 직원 평가는 실험실 메뉴다(원장 2026-10-13 *"강사평가는 일단 실험실 메뉴로 편입해서 침산만 오픈"*) —
 * 실험실 기능을 켜지 않은 지점도 화면이 닫히니 건너뛴다(판정은 화면과 같은 `isLaboratoryMenuAvailable`).
 * ⚠️ 하루를 놓쳐도 다음 실행이 아직 마감하지 않은 달을 마감한다(날짜가 아니라 상태로 잡는다).
 * ⚠️ admin 클라이언트 = RLS 우회 → 집계 함수 안의 모든 조회·쓰기가 tenant_id를 명시한다.
 * ⚠️ 0357a 미적용이면 `tableMissing`으로 건너뛴다(에러 아님 — "아직 안 켜짐").
 * ⚠️ 감사로그는 달을 마감했을 때만 남긴다 — 매일의 재집계까지 남기면 기록이 묻힌다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** 새 지점을 시작하지 않는 시점 — 한 지점이 화면 집계 상한(120초)만큼 걸려도 300초 안에 저장·감사로그·응답까지 남긴다. */
const START_BUDGET_MS = 160_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: masters, error } = await admin.from("users").select("tenant_id").eq("system_role", "master").eq("status", "active");
  if (error) {
    reportError(error, { scope: "cron.teacher-portfolio", step: "list-tenants" });
    return NextResponse.json({ error: "대상 지점 조회 실패" }, { status: 500 });
  }

  const tenantIds = rotateForDay([...new Set((masters ?? []).map((row) => row.tenant_id as string))].sort(), kstToday());
  const results: Record<string, string> = {};
  const startedAt = Date.now();
  for (const tenantId of tenantIds) {
    if (Date.now() - startedAt > START_BUDGET_MS) {
      results[tenantId] = "건너뜀: 시간 부족 — 다음 실행에서 집계";
      continue;
    }
    try {
      if (!isModuleEnabled((await getTenantSettingsByTenantId(tenantId)).modules.disabled, "class_review")) {
        results[tenantId] = "건너뜀: 직원 평가 기능 꺼짐";
        continue;
      }
      if (!(await isLaboratoryMenuAvailable(tenantId, "class_review"))) {
        results[tenantId] = "건너뜀: 실험실 메뉴가 열리지 않은 지점";
        continue;
      }
      const summary = await refreshTenantPortfolio(admin, tenantId);
      if (summary.tableMissing) {
        results[tenantId] = "표 미적용(0357a) — 건너뜀";
        continue;
      }
      results[tenantId] = `강사 ${summary.teachers}명 · 저장 ${summary.written}건 · 마감 ${summary.closedMonths.join(", ") || "없음"}`;
      if (summary.closedMonths.length) {
        await logActionAs(
          { tenantId, actorName: "system:teacher-portfolio" },
          {
            action: "teacher_portfolio_refresh", targetType: "teacher_portfolio", targetLabel: "직원 포트폴리오",
            metadata: { trigger: "cron", periodEnd: summary.periodEnd, teachers: summary.teachers, written: summary.written, closedMonths: summary.closedMonths },
          },
        );
      }
    } catch (e) {
      reportError(e, { scope: "cron.teacher-portfolio", tenantId });
      results[tenantId] = "실패";
    }
  }
  return NextResponse.json({ ok: true, tenants: tenantIds.length, results });
}
