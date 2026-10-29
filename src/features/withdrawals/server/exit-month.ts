import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { exitCountDate, paidTuitionMonths, type PaidTuitionRow } from "../exit-month";

/**
 * 퇴원생마다 **기간 판정 날짜**(`exitCountDate` — 수강료를 낸 마지막 달 기준, 원장 2026-10-29). 운영실·퇴원관리·원생 통계·퇴원 시트가 이 한 함수를 쓴다.
 * 🔴 청구는 admin으로 읽는다 — 청구 표는 수납 권한이 있어야 보여서(0158a) 사용자 클라이언트로 읽으면 사람마다 퇴원월이 갈린다.
 *    RLS 우회라 `tenant_id`로 좁힌다([[#104]]) — 지점은 학생 행(사용자가 볼 수 있는 행)에서 가져온다.
 * 청크 × 페이징(B2·B3) · 실패하면 던진다(대체값으로 다른 달에 세지 않는다).
 */
export async function loadExitCountDates(
  students: readonly { id: string; tenantId: string; withdrawnAt: string | null }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dated = students.filter((s): s is typeof s & { withdrawnAt: string } => !!s.withdrawnAt);
  if (!dated.length) return out;
  const db = createAdminClient();
  const byTenant = new Map<string, typeof dated>();
  for (const s of dated) byTenant.set(s.tenantId, [...(byTenant.get(s.tenantId) ?? []), s]);
  await Promise.all(
    [...byTenant].map(async ([tenantId, list]) => {
      const lastMonth = list.reduce((m, s) => (s.withdrawnAt.slice(0, 7) > m ? s.withdrawnAt.slice(0, 7) : m), "");
      const rows = await fetchAllPagedInChunks<PaidTuitionRow>(
        list.map((s) => s.id),
        (chunk, from, to) =>
          db
            .from("invoices")
            .select("student_id,period,status,category,amount_paid,line_items")
            .eq("tenant_id", tenantId)
            .eq("category", "tuition")
            .not("status", "in", "(void,refunded)")
            .gt("amount_paid", 0)
            .lte("period", lastMonth)
            .in("student_id", chunk)
            .order("id")
            .range(from, to),
      );
      const byStudent = new Map<string, PaidTuitionRow[]>();
      for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r]);
      for (const s of list) out.set(s.id, exitCountDate(s.withdrawnAt, paidTuitionMonths(byStudent.get(s.id) ?? [])));
    }),
  );
  return out;
}
