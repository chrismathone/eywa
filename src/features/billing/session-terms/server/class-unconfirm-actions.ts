"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import type { SessionPricingMode } from "@/features/billing/session-pricing";
import { monthRange } from "../plan";
import { isVirtualTermId } from "../month-roster";
import type { SessionTermPatch } from "./actions";

/** 한 번에 받는 최대 행 수 — 선택 일괄 확정과 같은 값. */
const MAX_ITEMS = 200;
/** update 한 번에 싣는 id 수 — `.in()` URL 길이([[#53]]). */
const WRITE_CHUNK = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_ERROR = "해제하지 못했습니다. 다시 시도해 주세요";

/** DB가 돌려준 사유 — 한글 문장(트리거 `raise exception`)만 그대로, 나머지는 한글 요약으로(raw 노출 금지). */
const reasonOf = (message: string | undefined) => (message && /[가-힣]/.test(message) ? message : FALLBACK_ERROR);

type TermRow = {
  id: string;
  confirmed_sessions: number | null;
  unit_price: number | string | null;
  amount: number | string | null;
  pricing_mode: SessionPricingMode | null;
};

const toNumber = (v: number | string | null) => (v === null ? null : Number(v));

/**
 * 반 전체 확정 해제 — 원장 2026-09-17 *"반전체가 확정이 된 경우는 '전체 확정 해제' 버튼으로 대체"*. 반 머리 줄에서 그 반의
 * 확정 행을 한 번에 미확정으로 되돌린다(개별 '해제'를 여러 번 누르는 것과 같은 결과 — 계획 N은 유지).
 *
 * 🔴 대상은 **화면이 보낸 id**(그 반에 지금 보이는 학생)다 — 검색·보기 필터('미배분' 등)로 좁혀 보고 있으면 안 보이는 학생은 건드리지 않는다.
 * 🔴 이 반·이 청구월의 행만 쓴다 — 화면이 보낸 id라도 다른 반·다른 달이면 무시한다(#77).
 * 🔴 지우기 전에 읽는다 — 해제는 확정값을 null로 지워서, 읽지 않으면 "얼마였는지"가 감사로그에도 안 남는다(개별 해제와 같은 규약).
 * 🔴 이미 미확정인 행은 건너뛴다(`confirmed_sessions is not null` 조건으로만 쓴다). 한 명이 DB 규칙에 걸려도 나머지는 해제한다.
 */
export async function unconfirmClassTerms(
  period: string,
  classId: string,
  ids: string[],
): Promise<{ error?: string; unconfirmed?: number; skipped?: number; failedIds?: string[]; /** 해제한 행 + 이미 미확정이던 행(화면 보정용) */ terms?: SessionTermPatch[] }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };
  if (!UUID_RE.test(classId)) return { error: "반이 지정되지 않았습니다" };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "해제할 학생이 없습니다" };
  if (ids.length > MAX_ITEMS) return { error: `한 번에 ${MAX_ITEMS}명까지 해제할 수 있습니다` };
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !id || unique.has(id)) return { error: "해제할 학생을 확인해 주세요" };
    unique.add(id);
  }

  // 회차 행이 없는 줄(가상 id)은 확정된 적이 없어 해제할 것이 없다 — uuid 열 조회에 섞으면 묶음 전체가 실패한다.
  for (const id of [...unique]) if (isVirtualTermId(id)) unique.delete(id);
  if (unique.size === 0) return { error: "해제할 확정이 없습니다" };

  const supabase = await createClient();
  let rows: TermRow[];
  try {
    rows = await fetchInChunks<TermRow>([...unique], (chunk) =>
      supabase
        .from("invoice_session_terms")
        .select("id, confirmed_sessions, unit_price, amount, pricing_mode, invoice:invoice_id!inner ( period )")
        .eq("class_id", classId)
        .eq("invoice.period", period)
        .in("id", chunk),
    );
  } catch {
    return { error: "해제할 학생을 읽지 못했습니다. 다시 시도해 주세요" };
  }
  const before = new Map(rows.filter((r) => r.confirmed_sessions !== null).map((r) => [r.id, r]));
  const targets = ids.filter((id) => before.has(id));

  const terms: SessionTermPatch[] = [];
  const failures: { id: string; reason: string }[] = [];
  const write = (chunk: string[]) =>
    supabase
      .from("invoice_session_terms")
      .update({ confirmed_sessions: null, unit_price: null, amount: null, confirmed_by: null, confirmed_at: null })
      .in("id", chunk)
      .not("confirmed_sessions", "is", null)
      .select("id");
  const record = (saved: { id: string }[] | null) => {
    for (const row of saved ?? []) {
      terms.push({ id: row.id, confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null, pricingMode: before.get(row.id)?.pricing_mode ?? "per_session" });
    }
  };
  for (let i = 0; i < targets.length; i += WRITE_CHUNK) {
    const chunk = targets.slice(i, i + WRITE_CHUNK);
    const { data, error } = await write(chunk);
    if (!error) {
      record(data);
      continue;
    }
    // 묶음이 실패하면(한 문장이라 한 명만 걸려도 전부 롤백) 한 명씩 다시 써서 걸린 사람만 골라낸다.
    if (chunk.length === 1) {
      failures.push({ id: chunk[0]!, reason: reasonOf(error.message) });
      continue;
    }
    for (const id of chunk) {
      const one = await write([id]);
      if (one.error) failures.push({ id, reason: reasonOf(one.error.message) });
      else record(one.data);
    }
  }

  const released = terms.length;
  const skipped = ids.length - released - failures.length;
  // 화면이 낡아 이미 미확정인 행을 '확정'으로 보고 있었다면 그 행도 미확정으로 돌려준다(개별 해제가 화면을 바로잡는 것과 같게).
  // 감사로그·해제 수에는 세지 않는다.
  const patchesForStale: SessionTermPatch[] = rows
    .filter((r) => r.confirmed_sessions === null)
    .map((r) => ({ id: r.id, confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null, pricingMode: r.pricing_mode ?? "per_session" }));
  if (released > 0) {
    // 돈이 결정돼 있던 값을 지우는 자리 — 학생마다 지우기 전 시수·단가·금액을 남긴다.
    const items = terms.map(({ id }) => {
      const b = before.get(id)!;
      return { termId: id, sessionsBefore: b.confirmed_sessions, unitPriceBefore: toNumber(b.unit_price), amountBefore: toNumber(b.amount), pricingMode: b.pricing_mode ?? "per_session" };
    });
    after(async () => {
      revalidatePath("/billing");
      await logAction({
        action: "session_term_unconfirm_class",
        targetType: "invoice_session_term",
        targetLabel: `${period} 전체 확정 해제`,
        metadata: { period, classId, unconfirmedCount: released, skipped, failedCount: failures.length, items },
      });
    });
  }
  const failedIds = failures.map((f) => f.id);
  const allTerms = [...terms, ...patchesForStale];
  if (failures.length) {
    return { unconfirmed: released, skipped, failedIds, terms: allTerms, error: `${failures.length}명은 해제하지 못했습니다 — ${failures[0]!.reason}` };
  }
  if (released === 0) return { error: "이미 해제됐거나 이 반에 없는 학생입니다", unconfirmed: 0, skipped, failedIds, terms: allTerms };
  return { unconfirmed: released, skipped, failedIds, terms: allTerms };
}
