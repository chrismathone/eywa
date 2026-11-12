import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import type { DutyAdminScope, VideoRow } from "../view-admin";

/** 함수가 아직 없다(SQL 적용 전 — #95). 이때는 열을 세우지 않는다. */
const missing = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return /PGRST202|42883|duty_video_homework/.test(m) && /function|schema cache|does not exist/i.test(m); };

/**
 * 영상 숙제 출제 · 회수(s2_0094) — 업무 완성도 선생님 표의 참고 열. 등급 · 전체 · 등수에는 들지 않는다(숙제를 많이 낸 선생님이 손해 보지 않게 — 원장 2026-11-12).
 * 합계는 DB에서(B2) · 기간 = 숙제일 · 과목 범위 = 반 과목. 읽지 못하면 로그만 남기고 열이 안 선다(평점 · 퇴원보고서 열과 같은 규칙).
 */
export async function loadVideoHomeworkRows(tenantId: string, from: string, to: string, scope: DutyAdminScope): Promise<VideoRow[] | undefined> {
  try {
    const rows = await fetchAllPaged<{ owner_id: string | null; subject: string | null; issued: number; judged: number; collected: number }>((a, b) =>
      createAdminClient().rpc("duty_video_homework_rollup", { p_tenant: tenantId, p_from: from, p_to: to, p_subjects: scope.subjects, p_owner: scope.ownerId })
        .order("owner_id").order("subject").range(a, b));
    return rows.filter((r): r is typeof r & { owner_id: string } => !!r.owner_id)
      .map((r) => ({ ownerId: r.owner_id, subject: r.subject, issued: Number(r.issued), judged: Number(r.judged), collected: Number(r.collected) }));
  } catch (e) {
    if (!missing(e)) logDbError(e, "duties.video-homework", { from, to });
    return undefined;
  }
}
