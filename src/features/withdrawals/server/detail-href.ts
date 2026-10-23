import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 퇴원보고서(새 보고서·원본) 상세 → '퇴원 상세' 링크(원장 2026-10-23 *"퇴원보고서 연동"*).
 * 학생이 **지금 퇴원 상태**이고, 보는 사람이 퇴원관리 화면을 열 수 있을 때만(`requireAccess("withdrawals")`와 같은 판정).
 * 퇴원 예약(퇴원일이 미래라 아직 재원)·재원·휴원 학생엔 링크가 없다. 실패하면 링크만 빠진다.
 */
export async function withdrawalDetailHref(studentId: string | null | undefined): Promise<string | null> {
  if (!studentId) return null;
  try {
    const user = await getCurrentUser();
    if (!user || !(await canAccessTenant(user.systemRole, "withdrawals"))) return null;
    // 사용자 클라이언트(RLS가 지점을 가른다) — 퇴원 상세(`getWithdrawalDetail`)가 학생을 읽는 길과 같다.
    const { data, error } = await (await createClient())
      .from("students")
      .select("status")
      .eq("id", studentId)
      .maybeSingle();
    if (error) {
      logDbError(error, "withdrawals.detail-href");
      return null;
    }
    return data?.status === "withdrawn" ? `/withdrawals/${studentId}` : null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[withdrawals] 퇴원 상세 링크 판정 실패", error);
    return null;
  }
}
