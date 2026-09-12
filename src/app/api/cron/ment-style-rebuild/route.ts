import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { rebuildTenantMentStyles, summarizeRebuild } from "@/features/onescreen/server/ment-style-build";

/**
 * 강사별 **멘트 말투 프로파일** 주간 갱신 cron (매주 일요일 20:00 KST = 11:00 UTC, vercel.json).
 *
 * 원장 2026-09-12 *"주기적으로 업그레이드 되도록도 배선"* — 그 주에 직접 쓰거나 고친 멘트가 쌓이면 다음 주
 * 자동작성부터 그 말투가 반영된다. 규칙·빌드는 features/onescreen/ment-style(.ts · server/ment-style-db.ts)
 * 한 벌이고 학원설정 [지금 갱신]도 같은 함수를 부른다.
 *
 * 대상 테넌트 = 활성 master가 1명 이상인 테넌트(daily-briefing 선례 — 휴면 테넌트에 AI 비용을 안 태운다).
 * 강사별 표본 지문이 저장값과 같으면 AI를 부르지 않으므로(변동 없음), 조용한 주엔 비용 0이다.
 * ⚠️ 예산은 호출 전체로 하나다 — 뒤 테넌트는 앞 테넌트가 남긴 만큼만 돈다(지금 활성 테넌트는 하나 · 늘면 cron을 가를 것).
 * ⚠️ admin 클라이언트 = RLS 우회 → 빌드 함수 안의 모든 조회·쓰기가 tenant_id를 명시한다.
 * ⚠️ 0262a 미적용 테넌트는 `tableMissing`으로 건너뛴다(에러 아님 — "아직 안 켜짐").
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120; // sheets-sync·daily-briefing과 같은 검증된 상한 — 빌드는 동시성 3 + 아래 예산 안에서 돌고 남은 강사는 다음 주로
/**
 * 이 호출 전체의 빌드 예산(테넌트 합산) — 상한 안에서 감사로그·응답까지 남기려고 20s를 뺀다. 빌드 함수가 진행 중인 AI 호출까지
 * 남은 예산에서 끊으므로(Promise.race) 예산 = 실제 상한이다. 테넌트가 둘 이상이면 앞 테넌트가 쓴 만큼 뒤 테넌트 예산이 준다.
 */
const BUDGET_MS = 100_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: masters, error } = await admin.from("users").select("tenant_id").eq("system_role", "master").eq("status", "active");
  if (error) {
    reportError(error, { scope: "cron.ment-style-rebuild", step: "list-tenants" });
    return NextResponse.json({ error: `대상 테넌트 조회 실패: ${error.message}` }, { status: 500 });
  }

  const tenantIds = [...new Set((masters ?? []).map((row) => row.tenant_id as string))];
  const results: Record<string, string> = {};
  const startedAt = Date.now();
  for (const tenantId of tenantIds) {
    try {
      const budgetMs = Math.max(0, BUDGET_MS - (Date.now() - startedAt));
      const summary = await rebuildTenantMentStyles(admin, tenantId, { builtBy: "cron", budgetMs });
      if (summary.tableMissing) {
        results[tenantId] = "표 미적용(0262a) — 건너뜀";
        continue;
      }
      const c = summarizeRebuild(summary);
      results[tenantId] = `갱신 ${c.built} · 변동 없음 ${c.unchanged} · 표본 부족 ${c.insufficient} · 반려 ${c.rejected} · 실패 ${c.failed}`;
      // 🔴 세션 없는 쓰기 — 행위자는 사람이 아니라 이 cron(시스템 라벨은 describe.ts SYSTEM_ACTOR_LABEL).
      //    AI 산출물의 내용을 바꾸는 일이라 갱신이 0건이어도 돌았다는 사실을 남긴다(안 돌았는지 되짚을 근거).
      await logActionAs(
        { tenantId, actorName: "system:ment-style-rebuild" },
        {
          action: "ment_style_rebuild",
          targetType: "ment_style",
          targetLabel: "강사 말투 프로파일",
          metadata: {
            trigger: "cron",
            ...c,
            teachers: summary.teachers.map((t) => ({ name: t.teacherName, outcome: t.outcome, samples: t.samples, reason: t.reason ?? null })),
          },
        },
      );
    } catch (e) {
      reportError(e, { scope: "cron.ment-style-rebuild", tenantId });
      results[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json({ ok: true, tenants: tenantIds.length, results });
}
