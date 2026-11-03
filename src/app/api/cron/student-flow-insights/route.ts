import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { reportError } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isFeatureLicensed } from "@/lib/license/server";
import { refreshFlowInsight, timelineRefreshCandidates } from "@/features/explore/server/flow-insights";

/**
 * **원생 타임라인 흐름 분석** cron(매일 01:20 KST) — 지점마다 타임라인 분석이 없거나 마지막 분석 뒤 새 기록이 생긴 재원생만 골라
 * 이전 분석에 합산한다(원장 2026-11-03 *"타임라인도 비슷하게"* — 출처가 여럿이라 저장마다 걸지 않고 밤에 한 번).
 * 비용 바닥 = 지점당 하루 `PER_TENANT`명(첫 전체 분석은 며칠에 나눠 쌓인다). AI 라이선스가 꺼진 지점은 건너뛴다.
 * 상담 흐름은 상담 저장 뒤 바로 갱신되므로 여기서 돌리지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const PER_TENANT = 40;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary: Record<string, { updated: number; unchanged: number; empty: number; failed: number; skipped?: string }> = {};
  try {
    const admin = createAdminClient();
    const tenants = await fetchAllPaged<{ id: string }>((from, to) => admin.from("tenants").select("id").order("id").range(from, to));
    // 후보는 지점마다 먼저 모으고, 실행은 **지점을 번갈아**(round-robin) — 한 호출이 7초 안팎이라 지점 하나가 시간 예산(300초)을 다
    //    쓰면 뒤 지점은 매일 0명이 된다(dev 실측 2026-11-03: 첫 지점 38명에 4.7분, 나머지 지점 0).
    const queues: { tenantId: string; ids: string[]; stopped: boolean }[] = [];
    for (const t of tenants) {
      const tally = { updated: 0, unchanged: 0, empty: 0, failed: 0 };
      summary[t.id] = tally;
      if (!(await isFeatureLicensed(t.id, "ai_analysis"))) {
        summary[t.id] = { ...tally, skipped: "ai_analysis off" };
        continue;
      }
      const ids = await timelineRefreshCandidates(t.id, PER_TENANT).catch((e: unknown) => {
        reportError(e, { where: "student-flow-insights", tenantId: t.id });
        return [] as string[];
      });
      if (ids.length > 0) queues.push({ tenantId: t.id, ids, stopped: false });
    }
    for (let round = 0; queues.some((q) => !q.stopped && round < q.ids.length); round++) {
      for (const q of queues) {
        if (q.stopped || round >= q.ids.length) continue;
        if (Date.now() - started > 270_000) {
          q.stopped = true;
          continue;
        }
        const r = await refreshFlowInsight({ tenantId: q.tenantId, studentId: q.ids[round], kind: "timeline", reason: "nightly" });
        summary[q.tenantId][r.status] += 1;
        // 라이선스·키 문제는 학생마다 되풀이될 뿐이라 그 지점은 멈춘다.
        if (r.status === "failed" && /라이선스|license|API key|api key/i.test(r.error)) q.stopped = true;
      }
    }
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    reportError(error, { where: "student-flow-insights" });
    return NextResponse.json({ ok: false, error: "원생 흐름 분석 배치에 실패했습니다", summary }, { status: 500 });
  }
}
