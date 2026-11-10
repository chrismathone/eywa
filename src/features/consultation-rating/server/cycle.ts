import "server-only";
import { isFeatureLicensed } from "@/lib/license/server";
import { reportWarning } from "@/lib/observability/report-error";
import { collectRatingBatches, errorText, submitRatingBatch } from "./batch";
import { QUEUE, consultationRatingEnabled, db, enqueueConsultations, ratingQueueReady } from "./queue";

export type RatingCycleReport = Record<string, number | string>;

/** 선점만 하고 배치 번호가 붙지 않은 채 15분 넘은 줄(보내다 죽은 실행)을 queued로 되돌린다. */
async function recoverStuck(tenantId: string): Promise<number> {
  const before = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await db().from(QUEUE).update({ stage: "queued", lock_token: null, locked_at: null, error: "보내기가 끝나지 않아 되돌렸습니다", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("stage", "submitting").is("batch_id", null).lt("updated_at", before).select("consultation_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * 지점 하나의 한 바퀴 — 스위치(consult_rating)가 꺼진 지점은 아무것도 하지 않는다(대기열도 만들지 않는다).
 * 단계마다 따로 감싼다 — 한 단계 실패가 뒤 단계를 막지 않게. 실패는 한글로.
 * ⚠️ 페이지 로드·화면 버튼으로는 돌지 않는다(AI는 명시 트리거만) — cron만 부른다.
 */
export async function runConsultationRatingCycle(tenantId: string): Promise<RatingCycleReport | null> {
  if (!(await consultationRatingEnabled(tenantId))) return null;
  // AI 분석 라이선스가 꺼진 지점은 generateJSON 관문이 모든 요청을 거절한다 — 매 바퀴 60건을 선점·거절·되돌리지 않고 여기서 멈춘다(재리뷰 2026-11-11).
  if (!(await isFeatureLicensed(tenantId, "ai_analysis"))) return { license: "AI 분석 기능이 꺼진 지점이라 평점을 매기지 않습니다" };
  if (!(await ratingQueueReady(tenantId))) return { ready: "대기열 표가 없습니다(s2_0044 적용 전)" };
  const report: RatingCycleReport = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try { report[name] = await fn(); }
    catch (e) { report[name] = `실패: ${errorText(e)}`.slice(0, 200); reportWarning("상담 평점 정기 처리 단계 실패", { scope: `consultation-rating.${name}`, tenantId, error: errorText(e) }); }
  };
  await step("enqueued", () => enqueueConsultations(tenantId));
  await step("recovered", () => recoverStuck(tenantId));
  await step("saved", () => collectRatingBatches(tenantId));
  await step("submitted", () => submitRatingBatch(tenantId));
  return report;
}
