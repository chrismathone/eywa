import { NextResponse } from "next/server";
import { logActionAs } from "@/features/audit/server/log";
import { runAdviceOutcomes, type OutcomeTally } from "@/features/assistant/server/advice-outcomes";
import { openAssistantDb } from "@/features/assistant/server/executor";
import { userScopeKeys } from "@/features/assistant/server/scope";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { bearerMatches } from "@/lib/http/secret-compare";
import { isFeatureLicensed } from "@/lib/license/server";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";

/**
 * **학원 비서 의견 결과 재측정** cron(매일 05:10 KST) — 제안 → 결과 → 학습 2단계(원장 2026-11-06 *"그 해결책이 어떤 결과를 가져왔는지에 대한
 * 결과 피드백까지"* · SQL s2_0038). 다시 잴 날이 된 의견을 지점마다 `PER_TENANT`개까지 같은 조회문으로 다시 재어 판정한다
 * (server/advice-outcomes.ts). AI를 부르지 않는다(조회만) — 그래도 AI 라이선스가 꺼진 지점은 학원 비서가 없으니 건너뛴다.
 * 시간 예산 200초(한 의견 = 조회 2번 × 검사·실행 각 8초까지 — maxDuration 300초 안에 연결 닫기까지 끝나게) · 넘으면 남은 의견은 다음 날로.
 * 결과가 생긴 지점은 감사 기록 한 줄(system).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const PER_TENANT = 20;
const BUDGET_MS = 200_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const today = kstToday();
  const summary: Record<string, OutcomeTally | { skipped: string } | { error: string }> = {};
  try {
    const admin = createAdminClient();
    const tenants = await fetchAllPaged<{ id: string }>((from, to) => admin.from("tenants").select("id").order("id").range(from, to));
    for (const t of tenants) {
      if (Date.now() - started > BUDGET_MS) {
        summary[t.id] = { skipped: "time budget" };
        continue;
      }
      if (!(await isFeatureLicensed(t.id, "ai_analysis"))) {
        summary[t.id] = { skipped: "ai_analysis off" };
        continue;
      }
      try {
        const settings = await getTenantSettingsByTenantId(t.id);
        const holidays = new Set((settings.operations.holidays ?? []).map((h) => h.date));
        // 의견을 만든 사람의 지금 권한 범위로 잰다(s2_0096 · Codex 합의 6 — 권한이 줄었거나 퇴사했으면 재지 않는다).
        const tally = await runAdviceOutcomes({
          tenantId: t.id,
          today,
          limit: PER_TENANT,
          deadline: started + BUDGET_MS,
          holidays,
          openDb: (scope) => openAssistantDb(t.id, scope),
          scopeOf: (userId) => userScopeKeys(t.id, userId),
        });
        summary[t.id] = tally;
        if (tally.paused) reportWarning("학원 비서 의견 재측정이 일시 문제로 멈춤", { where: "assistant-outcomes", tenantId: t.id, error: tally.paused, left: tally.left });
        if (tally.measured + tally.broken + tally.stopped > 0) {
          await logActionAs(
            { tenantId: t.id, actorName: "system:assistant-outcomes" },
            { action: "assistant_advice_outcomes", targetType: "assistant", targetLabel: `비서 의견 결과 ${tally.measured}건`, metadata: { ...tally, today, trigger: "cron" } },
          );
        }
      } catch (error) {
        // 한 지점의 실패(연결·표 없음)가 다른 지점을 막지 않는다.
        reportError(error, { where: "assistant-outcomes", tenantId: t.id });
        summary[t.id] = { error: error instanceof Error ? error.message.slice(0, 200) : "실패" };
      }
    }
    return NextResponse.json({ ok: true, today, summary });
  } catch (error) {
    reportError(error, { where: "assistant-outcomes" });
    return NextResponse.json({ ok: false, error: "비서 의견 결과 재측정에 실패했습니다", summary }, { status: 500 });
  }
}
