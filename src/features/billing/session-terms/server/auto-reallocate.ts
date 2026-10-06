import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { logAction } from "@/features/audit/server/log";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { planAutoReallocation, type AutoInvoice, type AutoRow, type AutoTerm } from "../auto-reallocation";

// 시수 확정 뒤 **배분 자동 재확정**(원장 2026-10-06) — 판정은 순수 함수(`planAutoReallocation`), 저장은 사람이 누르는 것과
// **같은 DB 함수**(`save_session_receipt_allocations` — 권한·잠금·합계·청구 항목·확정값 대조를 거기서 다시 본다).
// 🔴 best effort — 실패해도 확정은 이미 끝났다. 어떤 실패든 조용히 지금처럼 '배분 재확인'으로 남긴다(확정 응답을 막지 않는다).
// 🔴 확정 응답 **전에** 끝낸다 — 화면이 확정 직후 다시 읽어 갈 때 이미 정상으로 보이도록(`SessionTermsState.apply`).
// ⚠️ 알려진 한계: 저장 함수는 청구 항목·확정값만 대조하고 **기존 배분은 대조하지 않는다** — 여기서 읽은 뒤 저장하기 전(수십~수백 ms)에
//    사람이 같은 청구서의 배분 창에서 저장하면 그 저장을 읽기 전 배분으로 덮는다(사람끼리 동시에 저장할 때와 같은 모양). 막으려면 SQL에
//    배분 스냅샷 대조 인자가 필요하다.
// 쿼리: 청구서 id 1회 · 형제 행 + 청구서 1회(페이징) + 저장할 청구서마다 RPC 1회(동시 4개, B4).

type Db = SupabaseClient;
type Embed<T> = T | T[] | null | undefined;
type TermRow = Omit<AutoTerm, "className"> & { invoice_id: string; class?: Embed<{ class_name?: string | null }>; invoice?: Embed<AutoInvoice> };

const COLS = "id, invoice_id, class_id, subject, amount, confirmed_sessions, confirmed_at, pricing_mode, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount, class:class_id ( class_name ), invoice:invoice_id ( id, line_items, status )";
const CONCURRENCY = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = <T,>(v: Embed<T>) => (Array.isArray(v) ? v[0] : v) ?? null;

export type AutoReallocateResult = { saved: number; skipped: number };

/** `termIds` = 방금 확정한 회차 행들. 그 청구서 가운데 배분을 저장해 둔 것만 본다. */
export async function autoReallocateAfterConfirm(db: Db, termIds: readonly string[], trigger: string): Promise<AutoReallocateResult> {
  const ids = [...new Set(termIds)].filter((id) => UUID.test(id));
  if (!ids.length) return { saved: 0, skipped: 0 };
  try {
    const own = await fetchInChunks<{ invoice_id: string }>(ids, (chunk) => db.from("invoice_session_terms").select("invoice_id").in("id", chunk));
    const invoiceIds = [...new Set(own.map((r) => r.invoice_id))];
    // 한 청구서에 반이 여럿이라 청크 안에서도 1,000행을 넘을 수 있다(B2) — 페이징 + 고정 정렬.
    const siblings = await fetchAllPagedInChunks<TermRow>(invoiceIds, (chunk, from, to) =>
      db.from("invoice_session_terms").select(COLS).in("invoice_id", chunk).order("id").range(from, to));
    const byInvoice = new Map<string, { inv: AutoInvoice | null; terms: AutoTerm[] }>();
    for (const s of siblings) {
      const { invoice_id: invoiceId, class: cls, invoice, ...rest } = s;
      const entry = byInvoice.get(invoiceId) ?? byInvoice.set(invoiceId, { inv: one(invoice), terms: [] }).get(invoiceId)!;
      entry.terms.push({ ...rest, className: one(cls)?.class_name ?? null });
    }
    const plans = [...byInvoice.values()].flatMap(({ inv, terms }) => (inv ? [{ inv, plan: planAutoReallocation(inv, terms) }] : []));
    const todo = plans.flatMap(({ inv, plan }) => (plan.kind === "save" ? [{ inv, rows: plan.rows, linked: plan.linked }] : []));
    let saved = 0;
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const done = await Promise.all(todo.slice(i, i + CONCURRENCY).map((job) => saveOne(db, job.inv, job.rows)));
      for (const [k, ok] of done.entries()) {
        if (!ok) continue;
        saved++;
        const job = todo[i + k]!;
        after(() => logAction({
          action: "session_term_receipt_allocate_auto",
          targetType: "invoice",
          metadata: { invoiceId: job.inv.id, basis: "gross_bill", trigger, allocations: job.rows, linkedTermIds: job.linked },
        }));
      }
    }
    return { saved, skipped: plans.length - saved };
  } catch (error) {
    logDbError(error, "billing.session-terms.autoReallocateAfterConfirm", { trigger });
    return { saved: 0, skipped: 0 };
  }
}

async function saveOne(db: Db, inv: AutoInvoice, rows: AutoRow[]): Promise<boolean> {
  try {
    const { error } = await db.rpc("save_session_receipt_allocations", { p_invoice_id: inv.id, p_expected_lines: inv.line_items, p_rows: rows });
    // 그 사이 청구 항목·확정값이 바뀌었으면 DB 함수가 거절한다 — 그대로 '재확인'으로 둔다.
    if (error) logDbError(error, "billing.session-terms.autoReallocateAfterConfirm.save", { invoiceId: inv.id });
    return !error;
  } catch (error) {
    logDbError(error, "billing.session-terms.autoReallocateAfterConfirm.save", { invoiceId: inv.id });
    return false;
  }
}
