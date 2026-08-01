import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { ContractRow } from "../contract";

/**
 * 그 직원의 계약 이력(차수 오름차순).
 * 게이트 = **직원관리 메뉴 접근(개인 예외 반영)** 을 여기서 직접 검사한 뒤 admin client로 읽는다(2026-08-01) —
 * staff_contracts RLS(0167a)는 DB 함수(auth_menu_access)를 보는데, 개인 예외를 아는 0170a 갱신이 원장
 * Supabase 접근 불가로 보류돼 authenticated 조회로는 설현·이승엽(개인 허용 admin)이 빈 결과를 받는다.
 * ⚠️ admin 경로는 tenant_id 필터가 격리의 전부(빼먹으면 크로스테넌트).
 * ⚠️ error를 삼키지 말 것 — 조회 실패가 "계약 이력 없음"으로 위장되면 화면이 거짓말을 한다.
 */
export async function getStaffContracts(userId: string): Promise<ContractRow[]> {
  const viewer = await getCurrentUser();
  if (!viewer || !(await canAccessTenant(viewer.systemRole, "staff"))) {
    throw new Error("계약 이력을 열람할 권한이 없습니다");
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("staff_contracts")
    .select("id, seq, kind, start_date, end_date, terms, memo, line_no")
    .eq("tenant_id", viewer.tenantId)
    .eq("user_id", userId)
    .order("seq", { ascending: true })
    .order("line_no", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`계약 이력 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    seq: r.seq as number,
    kind: (r.kind as "contract" | "note" | null) ?? "contract",
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
    terms: (r.terms as string | null) ?? null,
    memo: (r.memo as string | null) ?? null,
    lineNo: (r.line_no as number | null) ?? null,
  }));
}
