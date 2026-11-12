import "server-only";
import { devCliEnabled } from "@/lib/ai/dev-cli";
import { reportWarning } from "@/lib/observability/report-error";
import { collectJudgeBatches, collectVerifyBatches, submitJudgeBatch, submitVerifyBatch } from "./batch";
import { enqueueNewVideos } from "./queue";
import { reconcileTranscriptions, submitTranscriptions } from "./transcribe";
import { aiAnalysisEnabled, db, errorText, videoReviewEnabled } from "./rows";

/** 판정 배치를 보내는 밤 시간(KST 21시~다음 날 6시) — 낮엔 추출·전사만 미리 해 둔다(원장 2026-10-20 "즉시 분석할 필요는 없음"). */
export function inJudgeWindow(now: Date): boolean {
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 21 || kstHour < 6;
}

/** 한 번의 cron에서 보내는 판정 배치 수 상한. */
const MAX_JUDGE_BATCHES = 3;

/**
 * 선점만 하고 끝나지 않은 줄을 되돌린다 — 15분 넘게 그대로면. 배치 번호가 붙기 전에 죽은 판정·확인 선점과
 * 도중에 죽은 '다시 분석'(judging · 배치 없음). 결과가 이미 있던 줄은 done으로(이전 결과를 지우지 않는다).
 */
async function recoverStuck(tenantId: string): Promise<void> {
  const before = new Date(Date.now() - 15 * 60_000).toISOString();
  for (const [stage, col, back] of [["judging", "judge_batch", "judge"], ["verifying", "verify_batch", "verify"]] as const) {
    const { data, error } = await db().from("homework_video_reviews").select("id,result,lock_token")
      .eq("tenant_id", tenantId).eq("stage", stage).is(col, null).lt("updated_at", before).limit(50);
    if (error) throw error;
    for (const r of data ?? []) {
      let q = db().from("homework_video_reviews")
        .update({ stage: stage === "judging" && r.result ? "done" : back, lock_token: null, locked_at: null, error: "처리가 끝나지 않아 되돌렸습니다" })
        .eq("tenant_id", tenantId).eq("id", r.id).eq("stage", stage).is(col, null);
      q = r.lock_token ? q.eq("lock_token", r.lock_token) : q.is("lock_token", null);
      const { error: e2 } = await q;
      if (e2) throw e2;
    }
  }
}

export type CycleReport = Record<string, number | string>;

/**
 * 지점 하나의 한 바퀴 — 영상 메모가 꺼진 지점은 아무것도 하지 않는다(대기열도 만들지 않는다).
 * AI 분석만 꺼졌으면 새 대기열·전사·판정/확인 제출은 멈추고, 이미 외부에 제출한 작업의 수거는 계속한다.
 * 단계마다 따로 감싼다 — 한 단계 실패(배치 조회 장애 등)가 뒤 단계(전송)를 막지 않게. 실패한 단계는 보고서에 한글로.
 */
export async function runVideoReviewCycle(tenantId: string, now: Date = new Date()): Promise<CycleReport | null> {
  if (!(await videoReviewEnabled(tenantId))) return null;
  const canSubmitAi = await aiAnalysisEnabled(tenantId);
  const report: CycleReport = {};
  const step = async (name: string, fn: () => Promise<number | void>) => {
    try { const n = await fn(); if (typeof n === "number") report[name] = n; }
    catch (e) { report[name] = `실패: ${errorText(e)}`.slice(0, 200); reportWarning("영상 메모 단계 실패", { scope: `video-review.${name}`, tenantId, error: errorText(e) }); }
  };
  if (canSubmitAi) {
    await step("enqueued", () => enqueueNewVideos(tenantId));
    // 개발 CLI 경로는 한 바퀴가 길어(판정을 그 자리에서 돌린다) 전사 제출을 한 번에 더 많이 — 운영은 기본 20(cron 10분 · 함수 시간 제한 안).
    await step("transcribing", () => submitTranscriptions(tenantId, devCliEnabled() ? 300 : undefined));
  }
  await step("transcribed", () => reconcileTranscriptions(tenantId));
  await step("recovered", () => recoverStuck(tenantId));
  await step("judged", () => collectJudgeBatches(tenantId));
  await step("verified", () => collectVerifyBatches(tenantId));
  if (canSubmitAi) await step("verifySent", () => submitVerifyBatch(tenantId));
  // 개발 CLI(내부 요금제)로 돌 때는 배치 할인도 밤도 의미가 없다 — 낮에도 보낸다(원장 2026-10-21 밀린 영상 전부 분석). 운영에선 devCliEnabled()가 늘 false.
  if (canSubmitAi && (inJudgeWindow(now) || devCliEnabled())) {
    await step("judgeSent", async () => {
      let total = 0;
      for (let i = 0; i < MAX_JUDGE_BATCHES; i++) { const n = await submitJudgeBatch(tenantId); total += n; if (n === 0) break; }
      return total;
    });
  }
  return report;
}
