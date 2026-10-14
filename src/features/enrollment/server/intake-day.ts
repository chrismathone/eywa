import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstDayBounds } from "../kst-bounds";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** `subject` = 상담 과목 키(안 골랐으면 null) — 운영실 과목 관리자 카드가 담당 과목으로 거른다. */
export type IntakeRow = { id: string; name: string; createdAt: string; subject: string | null };

/**
 * 그날(KST) 접수된 콜&상담 — 운영실 '신규문의' 카드·팝업과 일일 브리핑 '오늘 접수' 신호의 **단일 소스**.
 * 목록 `received=` 필터는 같은 경계(`kstDayBounds`)를 같은 컬럼에 건다.
 *
 * 🔑 접수 시각은 `received_date`(사람이 적는 폼 값)가 아니라 **행이 생긴 시각(created_at)**이다 — QR 공개접수는
 *    그 칸을 안 채운다.
 * ⚠️ 하루치라 전건을 받는다(상한을 걸면 배열 길이가 건수로 새어 "20"에 갇힌다 — [[#89]]).
 * @param deps cron(admin) 경로 — admin은 RLS 우회라 tenantId 필터가 필수다.
 */
export async function getIntakeOnDay(
  date: string,
  deps?: { supabase: Supabase; tenantId?: string },
): Promise<IntakeRow[]> {
  const supabase = deps?.supabase ?? (await createClient());
  const { startIso, endIso } = kstDayBounds(date);
  const rows = await fetchAllPaged<{ id: string; prospect_name: string | null; created_at: string; subject: string | null }>(
    (from, to) => {
      let q = supabase
        .from("enrollment_consultations")
        .select("id, prospect_name, created_at, subject")
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      if (deps?.tenantId) q = q.eq("tenant_id", deps.tenantId);
      return q.order("created_at", { ascending: false }).order("id").range(from, to);
    },
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.prospect_name?.trim() || "(이름 미상)",
    createdAt: row.created_at,
    subject: row.subject ?? null,
  }));
}
