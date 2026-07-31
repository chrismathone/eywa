import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContractRow } from "../contract";

/**
 * 그 직원의 계약 이력(차수 오름차순). 테넌트 격리는 RLS(0149a).
 * ⚠️ error를 삼키지 말 것 — 조회 실패가 "계약 이력 없음"으로 위장되면 화면이 거짓말을 한다.
 */
export async function getStaffContracts(userId: string): Promise<ContractRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_contracts")
    .select("id, seq, kind, start_date, end_date, terms, memo, line_no")
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
