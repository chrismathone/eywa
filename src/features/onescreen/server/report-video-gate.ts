import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { workerSupportsReportVideo } from "@/features/report-admin/worker-results";

/** 이 기간 안에 한 번이라도 보인 연동 PC는 다시 켜져 큐를 집을 수 있는 PC로 본다(반 공지 이미지 가드와 같은 7일). */
const WORKER_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export const REPORT_VIDEO_WORKER_BLOCKED =
  "연동 PC의 발송 프로그램이 아직 영상 첨부를 지원하지 않습니다 — 연동 PC를 최신 버전으로 바꾼 뒤 넣어 주세요";

/**
 * 보고서에 영상을 넣어도 되는가(롤아웃 가드, 2026-11-06) — **큐를 집을 수 있는 연동 PC가 전부** 영상을 올릴 수 있는 판인가.
 * 옛 판은 영상을 모른다: 첨부 표시가 켜져 있으면 영상을 문서 칸으로 올리다 실패해 보고서 발송이 통째로 막히고,
 * 꺼져 있으면 영상 없이 '발송 완료'로 적는다(빠진 줄 아무도 모른다). 그래서 업로드 단계에서 미리 막는다.
 * 판정 = 반 공지 이미지 가드(class-notice-actions `classNoticeImageGate`)와 같은 규칙 — 최근 7일 PC 전부 · dry-run PC 제외 ·
 * 7일 안에 없으면 가장 최근 PC · 하나도 없거나 읽지 못하면 막는다. 막히면 영상만 못 넣는다(보고서·사진은 그대로).
 */
export async function reportVideoWorkerGate(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data, error } = await supabase.from("classnote_workers").select("last_seen, last_results");
  if (error) return REPORT_VIDEO_WORKER_BLOCKED;
  const dryRun = (raw: unknown) =>
    !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).postMode === false;
  const seen = (data ?? [])
    .map((w) => ({ at: Date.parse(String(w.last_seen ?? "")), raw: w.last_results as unknown }))
    .filter((w) => Number.isFinite(w.at) && !dryRun(w.raw));
  if (!seen.length) return REPORT_VIDEO_WORKER_BLOCKED;
  const recent = seen.filter((w) => Date.now() - w.at < WORKER_RECENT_MS);
  const pool = recent.length ? recent : [seen.reduce((a, b) => (b.at > a.at ? b : a))];
  return pool.every((w) => workerSupportsReportVideo(w.raw)) ? null : REPORT_VIDEO_WORKER_BLOCKED;
}
