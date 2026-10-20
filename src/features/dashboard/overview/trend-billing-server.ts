import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isCleanupExit } from "@/features/withdrawals/system-bulk";
import { billedTuitionMonths } from "./trend-billing";
import { coverageStartFromCounts } from "./coverage-rules";

type Admin = ReturnType<typeof createAdminClient>;
/** 캐시에 담기는 모양(JSON) — 청구가 지점을 덮기 시작한 달 · [장부 정리 학생 id, 청구가 살아 있는 달들]. */
export type CleanupBilling = { billingFrom: string | null; billed: [string, string[]][] };

/** 청구 판정을 찾아보는 창 — 원생 통계가 그리는 가장 긴 창(36개월)과 같다. 그보다 옛 청구월(오타 등)은 보지 않는다. */
const SEARCH_MONTHS = 36;

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};
/** PostgREST 오류는 일반 객체라 그대로 던지면 로그에 `[object Object]`만 남는다([[#118]]) — 글을 실어 던진다. */
const fail = (scope: string, error: { message?: string }) => new Error(`${scope}: ${error.message ?? "알 수 없는 오류"}`);

/**
 * 장부 정리 학생을 청구로 세는 재료(원장 2026-10-20 '청구 기록으로 맞추기') — 청구가 지점을 덮기 시작한 달 + 장부 정리 학생마다
 * 청구가 살아 있는 달(`billedTuitionMonths` — 취소·환불 제외). 장부 정리 학생이 없으면 청구는 읽지 않는다(종전대로 퇴원일로 센다).
 * 원생 원본과 **따로** 캐시한다 — 🔴 실패하면 던진다(캐시에 대체값을 굳히지 않는다, 적대 재리뷰 2026-10-20). 대체(종전 규칙)는 부르는 쪽이
 * 그 요청에서만 한다. 장부 정리 학생의 청구만 100명씩 읽는다(B3 청크 · 청크 안 페이징 B2) · RLS 우회라 `tenant_id`까지 좁힌다([[#104]]).
 */
export async function loadCleanupBilling(db: Admin, tenantId: string, today: string): Promise<CleanupBilling> {
  const withdrawn = await fetchAllPaged<{ id: string; withdrawal_metadata: unknown }>((from, to) =>
    db.from("students").select("id,withdrawal_metadata").eq("tenant_id", tenantId).eq("status", "withdrawn").order("id").range(from, to),
  );
  const ids = withdrawn.filter((s) => isCleanupExit(s.withdrawal_metadata)).map((s) => s.id);
  if (!ids.length) return { billingFrom: null, billed: [] };
  const [billingFrom, rows] = await Promise.all([
    billingStartMonth(db, tenantId, today.slice(0, 7)),
    fetchAllPagedInChunks<{ student_id: string; period: string | null; status: string | null; category: string | null }>(ids, (chunk, from, to) =>
      db.from("invoices").select("student_id,period,status,category").eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(from, to),
    ),
  ]);
  const byStudent = new Map<string, typeof rows>();
  for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r]);
  // 본 장부 정리 학생은 **모두** 싣는다(청구가 없으면 빈 목록) — 실리지 않은 학생 = 이 재료를 만든 뒤 정리된 학생이라 종전 규칙으로
  // 센다(`billedOn`이 null) · 원본 캐시보다 청구 캐시가 한 주기 늦을 때 과거 추이에서 통째로 빠지지 않게(적대 재리뷰 2026-10-20).
  return { billingFrom, billed: ids.map((id) => [id, billedTuitionMonths(byStudent.get(id) ?? [])]) };
}

/**
 * 청구가 지점을 덮기 시작한 달 = **최근 36개월 안**의 살아 있는 수업료 청구(취소·환불 제외)로 `coverageStartFromCounts`(등록 판정·'지난 기록'과
 * **같은 함수 · 같은 입력** — 적대 재리뷰 2026-10-20: 여기만 모든 청구 줄을 세어 시작 달이 갈릴 수 있었다). 창 안 가장 이른 청구 달부터
 * 이번 달까지 달마다 건수만 센다(`head` — 줄을 받지 않는다 · 한꺼번에). 청구가 없으면 null(종전대로 퇴원일로 센다).
 * ⚠️ 창보다 오래전부터 청구한 지점은 창의 첫 달이 시작 달이 된다 — 그보다 옛 점(연도별)은 종전 규칙으로 센다.
 */
async function billingStartMonth(db: Admin, tenantId: string, thisMonth: string): Promise<string | null> {
  const first = await db
    .from("invoices")
    .select("period")
    .eq("tenant_id", tenantId)
    .eq("category", "tuition")
    .not("status", "in", "(void,refunded)")
    .like("period", "____-__")
    .gte("period", shiftMonth(thisMonth, -(SEARCH_MONTHS - 1)))
    .lte("period", thisMonth)
    .order("period", { ascending: true })
    .limit(1);
  if (first.error) throw fail("청구 시작 달", first.error);
  const start = (first.data?.[0] as { period: string | null } | undefined)?.period ?? null;
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return null;
  const months: string[] = [];
  for (let m = start; m <= thisMonth && months.length < SEARCH_MONTHS; m = shiftMonth(m, 1)) months.push(m);
  const counts = await Promise.all(
    months.map(async (month) => {
      const { count, error } = await db
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("category", "tuition")
        .not("status", "in", "(void,refunded)")
        .eq("period", month);
      if (error) throw fail("청구 건수", error);
      return count ?? 0;
    }),
  );
  // 시작 달 규칙은 등록 판정·'지난 기록'과 한 벌(`coverageStartFromCounts` — 0건 달을 넘기든 빼든 결과가 같다).
  return coverageStartFromCounts(new Map(months.map((m, i) => [m, counts[i]!])), thisMonth);
}
