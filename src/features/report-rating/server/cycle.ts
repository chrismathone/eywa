import "server-only";
import { reportWarning } from "@/lib/observability/report-error";
import { collectRatingBatches, errorText, submitRatingBatch } from "./batch";
import { QUEUE, db, enqueueNewReports, ratingQueueReady, reportRatingEnabled } from "./queue";

export type RatingCycleReport = Record<string, number | string>;

/** 선점만 하고 배치 번호가 붙지 않은 채 15분 넘은 줄(보내다 죽은 실행)을 queued로 되돌린다. */
async function recoverStuck(tenantId: string): Promise<number> {
  const before = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await db().from(QUEUE).update({ stage: "queued", lock_token: null, locked_at: null, error: "보내기가 끝나지 않아 되돌렸습니다", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("stage", "submitting").is("batch_id", null).lt("updated_at", before).select("report_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * 지점 하나의 한 바퀴 — 스위치(report_rating)가 꺼진 지점은 아무것도 하지 않는다(대기열도 만들지 않는다).
 * 단계마다 따로 감싼다 — 한 단계 실패가 뒤 단계를 막지 않게. 실패는 보고서에 한글로.
 * ⚠️ 페이지 로드·화면 버튼으로는 돌지 않는다(AI는 명시 트리거만) — cron만 부른다.
 */
export async function runReportRatingCycle(tenantId: string): Promise<RatingCycleReport | null> {
  if (!(await reportRatingEnabled(tenantId))) return null;
  if (!(await ratingQueueReady(tenantId))) return { ready: "대기열 표가 없습니다(0455a 적용 전)" };
  const report: RatingCycleReport = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try { report[name] = await fn(); }
    catch (e) { report[name] = `실패: ${errorText(e)}`.slice(0, 200); reportWarning("평점 정기 처리 단계 실패", { scope: `report-rating.${name}`, tenantId, error: errorText(e) }); }
  };
  await step("enqueued", () => enqueueNewReports(tenantId));
  await step("recovered", () => recoverStuck(tenantId));
  await step("saved", () => collectRatingBatches(tenantId));
  await step("submitted", () => submitRatingBatch(tenantId));
  return report;
}
