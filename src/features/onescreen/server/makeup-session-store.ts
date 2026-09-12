import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { SessionProgress } from "../makeup-session";

/** 세션의 보강 항목만 바꾼다. 다른 창이 진도·멘트를 저장하면 새 리비전에서 다시 병합한다. */
export async function changeMakeupSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: { tenantId: string; teacherId: string; studentId: string; date: string },
  change: (progress: SessionProgress) => SessionProgress,
): Promise<{ ok: true; updatedAt: string; previousUpdatedAt: string | null } | { ok: false; error: string }> {
  const table = () => supabase.from("onescreen_daily_sessions");
  const scoped = () => table().select("id, subject_progress, updated_at")
    .eq("tenant_id", scope.tenantId).eq("updated_by", scope.teacherId)
    .eq("student_id", scope.studentId).eq("session_date", scope.date);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: prior, error } = await scoped().maybeSingle();
    if (error) return { ok: false, error: "보강 명단을 불러오지 못했습니다" };
    const progress = change((prior?.subject_progress ?? {}) as SessionProgress);
    const updatedAt = new Date(Math.max(Date.now(), prior ? Date.parse(prior.updated_at) + 1 : 0)).toISOString();
    if (prior) {
      const result = await table().update({ subject_progress: progress, updated_at: updatedAt })
        .eq("tenant_id", scope.tenantId).eq("updated_by", scope.teacherId)
        .eq("id", prior.id).eq("updated_at", prior.updated_at).select("updated_at").maybeSingle();
      if (result.error) return { ok: false, error: "보강 명단을 저장하지 못했습니다" };
      if (result.data) return { ok: true, updatedAt: result.data.updated_at, previousUpdatedAt: prior.updated_at };
    } else {
      const result = await table().insert({
        tenant_id: scope.tenantId, updated_by: scope.teacherId, student_id: scope.studentId,
        session_date: scope.date, subject_progress: progress, updated_at: updatedAt,
      });
      if (!result.error) return { ok: true, updatedAt, previousUpdatedAt: null };
      if (result.error.code !== "23505") return { ok: false, error: "보강 명단을 저장하지 못했습니다" };
    }
  }
  return { ok: false, error: "다른 창에서 수정 중입니다. 보강 추가를 다시 눌러 주세요" };
}
