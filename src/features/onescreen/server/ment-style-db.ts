import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { isMentStyleTableMissingError, parseMentStyleProfile, type MentStyleProfile } from "../ment-style";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 강사별 말투 프로파일(0262a) — **읽기**의 서버 헬퍼(빌드는 ./ment-style-build.ts). 규칙은 전부 ../ment-style.ts(순수)에서 온다.
 *
 * 🔴 admin 클라이언트 전용(표에 정책이 0개) → 모든 조회에 tenant_id 명시 필터.
 * 🔴 fail-soft([[#95]]): 표가 아직 없으면(0262a 미적용) 읽기는 null, 목록은 `tableMissing` — 자동작성은 종전대로 돈다.
 */

/** 자동작성 직전 한 번 읽는다 — 실패는 null(프로파일 없이 종전 프롬프트). */
export async function loadTeacherMentStyle(admin: SupabaseClient, tenantId: string, teacherId: string): Promise<MentStyleProfile | null> {
  const { data, error } = await admin
    .from("teacher_ment_styles")
    .select("profile")
    .eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (error) {
    // 표 부재(미적용)는 정상 경로라 조용히. 그 밖의 실패는 "말투가 안 붙었다"가 보이게 남긴다([[#89]]).
    if (!isMentStyleTableMissingError(error)) reportWarning("강사 말투 프로파일 조회 실패", { scope: "loadTeacherMentStyle", message: error.message });
    return null;
  }
  return data ? parseMentStyleProfile(data.profile) : null;
}

export type MentStyleListRow = {
  teacherId: string;
  teacherName: string;
  profile: MentStyleProfile;
  sampleCount: number;
  manualCount: number;
  editedCount: number;
  corpusUntil: string | null;
  builtAt: string;
  builtBy: string;
  model: string | null;
};

/** 학원설정 카드용 목록 — 강사 이름은 users에서 한 번에. */
export async function listTeacherMentStyles(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: MentStyleListRow[]; tableMissing: boolean; error?: string }> {
  const { data, error } = await admin
    .from("teacher_ment_styles")
    .select("teacher_id, profile, sample_count, manual_count, edited_count, corpus_until, built_at, built_by, model")
    .eq("tenant_id", tenantId)
    .order("built_at", { ascending: false });
  if (error) {
    if (isMentStyleTableMissingError(error)) return { rows: [], tableMissing: true };
    return { rows: [], tableMissing: false, error: explainDbError(error, { scope: "onescreen.ment-style-db.listTeacherMentStyles", fallback: "말투 목록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }
  const ids = [...new Set((data ?? []).map((r) => r.teacher_id as string))];
  const users = await fetchInChunks(ids, (chunk) => admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk));
  const nameOf = new Map(users.map((u) => [u.id as string, (u.display_name as string | null) ?? ""]));
  const rows: MentStyleListRow[] = [];
  for (const r of data ?? []) {
    const profile = parseMentStyleProfile(r.profile);
    if (!profile) continue; // 모양이 깨진 행은 화면에 세우지 않는다(자동작성도 같은 parse를 지나 안 붙는다)
    rows.push({
      teacherId: r.teacher_id as string,
      teacherName: nameOf.get(r.teacher_id as string) || "(이름 없음)",
      profile,
      sampleCount: Number(r.sample_count ?? 0),
      manualCount: Number(r.manual_count ?? 0),
      editedCount: Number(r.edited_count ?? 0),
      corpusUntil: (r.corpus_until as string | null) ?? null,
      builtAt: r.built_at as string,
      builtBy: (r.built_by as string) ?? "cron",
      model: (r.model as string | null) ?? null,
    });
  }
  return { rows, tableMissing: false };
}
