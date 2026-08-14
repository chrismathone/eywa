"use server";
/**
 * 폴링용 경량 카운트 — 오늘 출결 화면이 20초마다 부른다.
 *
 * 🔑 **행을 받지 않는다**(`count: "exact", head: true`) — 창마다 도는 폴링이라 왕복 하나가 비싸다(B2·B6).
 *    보드 전체를 다시 계산하는 건 값이 **바뀌었을 때만**(호출부가 router.refresh).
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

/** 그날 출결 기록 수(테넌트 전체). 권한 없거나 실패면 null — 호출부는 조용히 넘어간다. */
export async function getLiveRecordedCount(date: string): Promise<number | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "none") return null;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("session_date", date);
  if (error) return null;
  return count ?? 0;
}
