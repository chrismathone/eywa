"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isEieMonthlyClass, sessionPricingAmount, validSessionQuantity, type SessionPricingMode } from "@/features/billing/session-pricing";
import { monthRange } from "../plan";
import { isVirtualTermId } from "../month-roster";
import type { SessionTermPatch } from "./actions";
import { materializeVirtualTerms } from "./term-materialize";
import { autoReallocateAfterConfirm } from "./auto-reallocate";
import { applyCarrySync, syncCarrySessionsAfter } from "./carry-session-sync";

/** `monthly` = 화면이 이 행을 EiE 월 정액으로 보고 있었는가(서버 판정과 다르면 그 행은 쓰지 않는다). */
export type SelectedTermInput = { id: string; sessions: number; unitPrice: number; monthly: boolean };

/** 한 번에 받는 최대 행 수 — 한 반 학생 수보다 넉넉하게. */
const MAX_ITEMS = 200;
/** update 한 번에 싣는 id 수 — `.in()` URL 길이([[#53]]). */
const WRITE_CHUNK = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_ERROR = "확정하지 못했습니다. 다시 시도해 주세요";

/** DB가 돌려준 사유 — 한글 문장(트리거 `raise exception`)만 그대로 보여 주고 나머지는 한글 요약으로(raw 노출 금지). */
const reasonOf = (message: string | undefined) => (message && /[가-힣]/.test(message) ? message : FALLBACK_ERROR);

type TermRow = {
  id: string;
  subject: string;
  confirmed_sessions: number | null;
  class: { english_track?: string | null } | { english_track?: string | null }[] | null;
};

/**
 * 선택 일괄 확정 — 원장 2026-09-17 *"체크할 수 있는 체크박스 마련해주고, 선택 일괄 확정 기능 추가해줘. 선택 일괄 확정은
 * '단가 일괄 입력' 버튼 우측에"*. 한 반에서 체크한 **미확정** 학생을 **각 행에 보이는 시수 × 단가**로 한 번에 확정한다
 * (개별 '확정'을 여러 번 누르는 것과 같은 결과 — 반 일괄 확정처럼 모두에게 같은 값을 박지 않는다).
 *
 * 🔴 규칙은 개별 확정(`confirmSessionTerm`)과 같다: 시수 0~99·소수 한 자리 · 단가 0 이상 원 단위 · 월 정액 판정은
 *    **회차 행의 과목 + 반의 영어 구분**(같은 함수 `isEieMonthlyClass`) · EiE는 **서버 설정의 월 금액**(화면 단가 무시) ·
 *    `quantity_basis = attendance_units`. 화면이 본 단위(`monthly`)와 서버 판정이 다르면 그 행은 쓰지 않는다 —
 *    낡은 화면이 월 금액을 회당 단가로 보내 `시수 × 월 금액`이 저장되는 것을 막는다(적대적 리뷰 2026-09-17).
 * 🔴 이미 확정된 행은 건너뛴다(`confirmed_sessions is null` 조건으로만 쓴다) — 다른 창에서 먼저 확정한 값을 덮지 않는다.
 * 🔴 이 반·이 청구월의 행만 쓴다 — 화면이 보낸 id라도 다른 반·다른 달이면 무시한다(#77).
 * 🔴 한 명이 DB 규칙(예: 배분금액이 있는 반을 0시수로 확정 — 0267b 트리거)에 걸려도 **나머지는 확정**한다 — 묶음이 실패하면
 *    한 명씩 다시 써서 걸린 사람만 골라내고, 그 사유를 그대로 돌려준다(같은 묶음 전체가 영원히 실패하던 결함).
 * 🔴 **가상 id**(출석부 줄인데 회차 행이 없는 학생, 원장 2026-09-18)는 먼저 행을 만들고(`term-materialize.ts` — 반이 이 반인지·
 *    그 달 줄 집합에 있는지·청구서가 살아 있는지 서버가 다시 본다) 실 id로 확정한다. 못 만든 학생은 실패 목록에 **가상 id 그대로**
 *    남긴다(화면 선택이 그 행에 남아 고쳐서 다시 누를 수 있다). 응답 `created`가 0보다 크면 화면은 새로고침한다.
 */
export async function confirmSelectedTerms(
  period: string,
  classId: string,
  items: SelectedTermInput[],
): Promise<{ error?: string; confirmed?: number; skipped?: number; created?: number; materialized?: number; failedIds?: string[]; terms?: SessionTermPatch[] }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };
  if (!UUID_RE.test(classId)) return { error: "반이 지정되지 않았습니다" };
  if (!Array.isArray(items) || items.length === 0) return { error: "확정할 학생을 선택해 주세요" };
  if (items.length > MAX_ITEMS) return { error: `한 번에 ${MAX_ITEMS}명까지 확정할 수 있습니다` };
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) return { error: "확정할 학생을 확인해 주세요" };
    ids.add(item.id);
    if (!validSessionQuantity(item.sessions)) return { error: "확정 시수는 0~99 사이, 소수 한 자리까지 입력하세요" };
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };
    if (typeof item.monthly !== "boolean") return { error: "확정할 학생을 확인해 주세요" };
  }

  const supabase = await createClient();
  const failures: { id: string; reason: string }[] = [];
  // 가상 id → 실 행. 실패는 가상 id 그대로 실패 목록에.
  let created = 0;
  let materialized = 0;
  const realOf = new Map<string, string>();
  const virtualIds = items.map((i) => i.id).filter(isVirtualTermId);
  if (virtualIds.length > 0) {
    const made = await materializeVirtualTerms(supabase, { tenantId: user.tenantId, period, reason: "confirm_selected", classId }, virtualIds);
    if (made.error) return { error: made.error };
    created = made.created;
    materialized = made.ids.size;
    for (const [virtualId, realId] of made.ids) realOf.set(virtualId, realId);
    for (const [virtualId, reason] of made.failed) failures.push({ id: virtualId, reason });
  }
  const failedVirtual = new Set(failures.map((f) => f.id));
  const resolved = items.filter((i) => !failedVirtual.has(i.id)).map((i) => ({ ...i, id: realOf.get(i.id) ?? i.id }));
  /** 실 id → 화면이 보낸 id(가상이면 가상 id) — 실패 목록은 화면이 아는 id로 돌려준다. */
  const sentIdOf = new Map(items.map((i) => [realOf.get(i.id) ?? i.id, i.id]));

  let rows: TermRow[];
  try {
    rows = await fetchInChunks<TermRow>(resolved.map((i) => i.id), (chunk) =>
      supabase
        .from("invoice_session_terms")
        .select("id, subject, confirmed_sessions, class:class_id ( english_track ), invoice:invoice_id!inner ( period )")
        .eq("class_id", classId)
        .eq("invoice.period", period)
        .in("id", chunk),
    );
  } catch {
    return { error: "확정할 학생을 읽지 못했습니다. 다시 시도해 주세요" };
  }
  const modeById = new Map<string, SessionPricingMode>();
  for (const row of rows) {
    if (row.confirmed_sessions !== null) continue;
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    modeById.set(row.id, isEieMonthlyClass(row.subject, cls?.english_track) ? "monthly" : "per_session");
  }
  const monthlyPrice = [...modeById.values()].includes("monthly") ? (await getTenantSettings()).billing.eieMonthlyPrice : null;

  // 같은 단위·시수·단가끼리 묶어 쓴다(금액이 같아 한 번의 update로 끝난다).
  const groups = new Map<string, { mode: SessionPricingMode; sessions: number; unitPrice: number; ids: string[] }>();
  for (const item of resolved) {
    const mode = modeById.get(item.id);
    if (!mode) continue; // 이미 확정됐거나 이 반·이 달의 행이 아니다(건너뜀)
    if ((mode === "monthly") !== item.monthly) {
      failures.push({ id: sentIdOf.get(item.id) ?? item.id, reason: "반의 수강료 방식이 바뀌었습니다. 새로고침한 뒤 다시 확정해 주세요" });
      continue;
    }
    const unitPrice = mode === "monthly" ? monthlyPrice! : Math.round(item.unitPrice);
    const key = `${mode}|${item.sessions}|${unitPrice}`;
    (groups.get(key) ?? groups.set(key, { mode, sessions: item.sessions, unitPrice, ids: [] }).get(key)!).ids.push(item.id);
  }

  const confirmedAt = new Date().toISOString();
  const terms: SessionTermPatch[] = [];
  const logged: { termId: string; sessions: number; unitPrice: number; amount: number; pricingMode: SessionPricingMode }[] = [];
  for (const { mode, sessions, unitPrice, ids: groupIds } of groups.values()) {
    const amount = sessionPricingAmount(mode, sessions, unitPrice);
    const write = (chunk: string[]) =>
      supabase
        .from("invoice_session_terms")
        .update({
          confirmed_sessions: sessions,
          unit_price: unitPrice,
          pricing_mode: mode,
          quantity_basis: "attendance_units",
          amount,
          confirmed_by: user.id,
          confirmed_at: confirmedAt,
        })
        .in("id", chunk)
        .is("confirmed_sessions", null)
        .select("id");
    const record = (saved: { id: string }[] | null) => {
      for (const row of saved ?? []) {
        terms.push({ id: row.id, confirmedSessions: sessions, unitPrice, pricingMode: mode, amount, confirmedAt, quantityBasis: "attendance_units" });
        logged.push({ termId: row.id, sessions, unitPrice, amount, pricingMode: mode });
      }
    };
    for (let i = 0; i < groupIds.length; i += WRITE_CHUNK) {
      const chunk = groupIds.slice(i, i + WRITE_CHUNK);
      const { data, error } = await write(chunk);
      if (!error) {
        record(data);
        continue;
      }
      // 묶음이 실패하면(한 문장이라 한 명만 걸려도 전부 롤백) 한 명씩 다시 써서 걸린 사람만 골라낸다.
      if (chunk.length === 1) {
        failures.push({ id: sentIdOf.get(chunk[0]!) ?? chunk[0]!, reason: reasonOf(error.message) });
        continue;
      }
      for (const id of chunk) {
        const one = await write([id]);
        if (one.error) failures.push({ id: sentIdOf.get(id) ?? id, reason: reasonOf(one.error.message) });
        else record(one.data);
      }
    }
  }

  const failedIds = failures.map((f) => f.id);
  const skipped = items.length - terms.length - failures.length;
  // 응답에 싣는 행 값 — 받은 금액 이월 때문에 확정 시수를 맞춘 줄은 고친 값으로(원장 2026-10-07). 건수는 `terms`로 센다.
  let patched: SessionTermPatch[] = terms;
  if (terms.length > 0) {
    // 배분을 저장해 둔 청구서는 사람이 다시 저장할 일만 대신한다(원장 2026-10-06) — 응답 전에 끝낸다.
    await autoReallocateAfterConfirm(supabase, terms.map((t) => t.id), "confirm_selected");
    patched = applyCarrySync(terms, await syncCarrySessionsAfter(supabase, { termIds: terms.map((t) => t.id) }, user.id, "confirm_selected"));
    // 돈이 결정되는 자리 — 학생마다 시수·단가·금액을 남긴다(반 일괄 확정은 한 값이라 한 줄이지만 여기선 행마다 다르다).
    after(async () => {
      revalidatePath("/billing");
      await logAction({
        action: "session_term_confirm_selected",
        targetType: "invoice_session_term",
        targetLabel: `${period} 선택 일괄 확정`,
        metadata: { period, classId, confirmedCount: terms.length, skipped, failedCount: failures.length, items: logged, ...(created ? { createdRows: created } : {}) },
      });
    });
  }
  // `materialized` > 0 = 가상 줄이 실제 행이 됐다(확정 쓰기가 실패한 줄도) → 화면이 새로 읽어 갈아끼운다.
  const createdPart = { ...(created ? { created } : {}), ...(materialized ? { materialized } : {}) };
  if (failures.length) {
    return { confirmed: terms.length, skipped, failedIds, terms: patched, ...createdPart, error: `${failures.length}명은 확정하지 못했습니다 — ${failures[0]!.reason}` };
  }
  if (terms.length === 0) return { error: "선택한 학생이 이미 확정됐거나 이 반에 없습니다", confirmed: 0, skipped, failedIds, terms, ...createdPart };
  return { confirmed: terms.length, skipped, failedIds, terms: patched, ...createdPart };
}
