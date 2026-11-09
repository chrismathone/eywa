import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftMonth } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { invoiceAllocationStates, type AllocationTermRow } from "../allocation-state";
import { carryLanding, carryOutValid, isCarryColumnMissing, type CarrySource, type MoneyCarryIn, type MoneyCarryLanding, type MoneyCarryOut } from "../money-carryover";
import { monthRosterKey } from "../month-roster";
import { loadMonthRoster } from "./month-roster";

// 금액 이월(0278a) 조회 — 회차 확정 면·시수 검증(분배)·출석부 금액 열이 같은 함수들을 쓴다.
// 🔴 **fail-soft**: 0278a 컬럼은 본 조회에 섞지 않고 따로 읽는다. 컬럼이 없으면(미적용) 이월 자체가 없으니 조용히 빈 결과,
//    그 밖의 실패는 빈 결과 + `failed: true` — 화면은 살리고 **분배 저장은 거절**한다(실패를 '이월 없음'으로 삼키면
//    보낸 달·받은 달 스냅샷에 같은 돈이 두 번/0번 들어간다 — 적대 리뷰 2026-09-21).
// ⚠️ admin 클라이언트로 부를 때는 `tenantId`를 반드시 넘긴다(RLS 우회 — [[#104]]).

type Db = SupabaseClient;
type ClassEmbed = { class_name?: string | null } | { class_name?: string | null }[] | null;
type InvoiceEmbed<T> = T | T[] | null;
const one = <T,>(v: InvoiceEmbed<T> | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const nameOf = (c: ClassEmbed | undefined) => one(c)?.class_name ?? null;

/** 0278a 미적용(컬럼·함수 없음)이면 실패가 아니라 '이월 없음'(`isCarryColumnMissing`). 그 밖은 실패로 기록한다. */
function classify(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (isCarryColumnMissing(message)) return false;
  console.error("[money-carryover] 이월 조회 실패", message);
  return true;
}

async function classNames(db: Db, ids: string[], tenantId?: string): Promise<Map<string, string>> {
  const rows = await fetchInChunks<{ id: string; class_name: string | null }>(ids, (chunk) => {
    const q = db.from("classes").select("id, class_name").in("id", chunk);
    return tenantId ? q.eq("tenant_id", tenantId) : q;
  });
  return new Map(rows.flatMap((r) => (r.class_name ? [[r.id, r.class_name] as const] : [])));
}

const ALLOCATION_COLS = "id, invoice_id, class_id, amount, confirmed_sessions, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount, class:class_id ( class_name )";
type SiblingTerm = Omit<AllocationTermRow, "className"> & { invoice_id: string; class?: ClassEmbed };

/** 청구서들의 회차 행 전부(같은 수납 항목을 나누는 반까지 봐야 배분 유효성을 안다) → 청구서 id별. */
async function siblingsByInvoice(db: Db, invoiceIds: string[], tenantId?: string): Promise<Map<string, AllocationTermRow[]>> {
  const siblings = await fetchInChunks<SiblingTerm>(invoiceIds, (chunk) => {
    const q = db.from("invoice_session_terms").select(ALLOCATION_COLS).in("invoice_id", chunk);
    return tenantId ? q.eq("tenant_id", tenantId) : q;
  });
  const out = new Map<string, AllocationTermRow[]>();
  for (const s of siblings) (out.get(s.invoice_id) ?? out.set(s.invoice_id, []).get(s.invoice_id)!).push({ ...s, className: nameOf(s.class) });
  return out;
}

type CarriedRow = {
  id: string;
  invoice_id: string;
  class_id: string | null;
  amount: number | string | null;
  confirmed_sessions: number | string | null;
  allocation_carry_out: number | string;
  allocation_carry_class_id: string | null;
  allocation_carry_note: string | null;
  allocation_carry_at: string | null;
  class?: ClassEmbed;
  invoice: InvoiceEmbed<{ student_id: string; status: string | null; line_items: unknown }>;
};

/** 그 달 청구서의 이월 행 — 한 번의 조회(이월 행은 한 달에 몇 건이다, 청구서 id 전체를 청크로 훑지 않는다). */
async function carriedRowsOf(db: Db, period: string, tenantId?: string): Promise<CarriedRow[]> {
  // 조건(`> 0`)은 DB가 걸지만 한 번 더 — 숫자가 아닌 값이 섞여 NaN 이월이 표식으로 서지 않게.
  return (await fetchAllPaged<CarriedRow>((from, to) => {
    const q = db.from("invoice_session_terms")
      .select("id, invoice_id, class_id, amount, confirmed_sessions, allocation_carry_out, allocation_carry_class_id, allocation_carry_note, allocation_carry_at, class:class_id ( class_name ), invoice:invoice_id!inner ( student_id, status, line_items, period )")
      .gt("allocation_carry_out", 0).eq("invoice.period", period).order("id").range(from, to);
    return tenantId ? q.eq("tenant_id", tenantId) : q;
  })).filter((r) => Number(r.allocation_carry_out) > 0);
}

/**
 * 이 달 청구서들의 **보낸 이월**(회차 행 id → 이월). 유효성은 부르는 쪽이 그 행의 배분 상태로 `carryOutValid`를 본다
 * (회차 확정 면은 행에 이미 `allocatedAmount`·`allocationStale`이 있다). `invoiceIds`로 좁힌다(취소된 청구서 행은 안 싣는다).
 */
export async function loadMoneyCarryOuts(db: Db, period: string, invoiceIds: readonly string[], tenantId?: string): Promise<{ map: Map<string, MoneyCarryOut>; failed: boolean }> {
  try {
    const shown = new Set(invoiceIds);
    const rows = (await carriedRowsOf(db, period, tenantId)).filter((r) => shown.has(r.invoice_id));
    if (rows.length === 0) return { map: new Map(), failed: false };
    const names = await classNames(db, [...new Set(rows.flatMap((r) => (r.allocation_carry_class_id ? [r.allocation_carry_class_id] : [])))], tenantId);
    const toPeriod = shiftMonth(period, 1);
    return { map: new Map(rows.map((r) => [r.id, {
      amount: Number(r.allocation_carry_out),
      toClassId: r.allocation_carry_class_id,
      toClassName: r.allocation_carry_class_id ? names.get(r.allocation_carry_class_id) ?? null : null,
      toPeriod,
      note: r.allocation_carry_note,
      at: r.allocation_carry_at,
    }])), failed: false };
  } catch (e) {
    return { map: new Map(), failed: classify(e) };
  }
}

/**
 * 연쇄 이월을 거슬러 읽는 깊이의 **안전 상한**(달) — 사슬은 (학생, 반)마다 제 몫으로 덮이지 않는 이월이 끊긴 달에서 저절로 멈춘다
 * (받은 이월을 다시 넘긴 달만 이어진다 · 0278a 2026-09부터라 실제로는 몇 달). 넘으면 조용히 끊지 않고 **조회 실패**로 올린다(`failed` → 분배 저장 거절) — 끊어 읽으면 보내는 달 화면(한 달 덜 거슬러 본다)과
 * 받는 달이 다른 답을 내 돈이 사라진다(적대 리뷰 2026-11-09).
 */
const CARRY_CHAIN_MAX_MONTHS = 120;

const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

/** 거슬러 읽는 범위 — 맨 위는 학생(없으면 전부), 그 아래는 **보내는 줄의 (학생, 반)**으로 그 반에 온 이월만 따라간다. */
type CarryInsScope = { students: ReadonlySet<string> | null } | { keys: ReadonlySet<string> };

/**
 * `period`에 받은 이월(키 = `monthRosterKey(학생, 받을 반)`) — `loadMoneyCarryIns`의 본체. 실패는 throw(바깥이 `failed`로 접는다).
 * 🔑 보내는 달 행의 유효성(`carryOutValid` → `carrySurplus`)에는 **그 행이 그 앞 달에서 받은 이월**도 든다(연쇄 이월, 원장 2026-11-09) —
 *    그래서 보내는 줄의 (학생, 반)으로 온 이월을 같은 함수로 한 달씩 거슬러 읽어 그 줄에 붙인다.
 * 🔑 붙는 줄 = 그 (학생, 반)의 그 달 회차 행 **하나뿐**이다 — 청구서는 (지점, 학생, 달)당 한 장(`invoices_tenant_student_period_idx`),
 *    회차 행은 (청구서, 반)당 하나(`invoice_session_terms_tenant_id_invoice_id_class_id_key`)라 화면(`attachMoneyCarry`)이 고르는 줄과 같다.
 *    그 줄이 받을 수 없는 줄(배분 없음·재확인·환불)이면 `receivedCarry`가 0으로 본다 — 화면의 orphan·환불 처리와 같은 답.
 */
async function carryInsInto(db: Db, period: string, scope: CarryInsScope, tenantId: string | undefined, depth: number): Promise<Map<string, MoneyCarryIn[]>> {
  const fromPeriod = shiftMonth(period, -1);
  const carried = (await carriedRowsOf(db, fromPeriod, tenantId)).filter((t) => {
    const inv = one(t.invoice);
    if (!inv || inv.status === "void" || !t.allocation_carry_class_id) return false;
    return "keys" in scope ? scope.keys.has(monthRosterKey(inv.student_id, t.allocation_carry_class_id)) : !scope.students || scope.students.has(inv.student_id);
  });
  if (carried.length === 0) return new Map();
  if (depth >= CARRY_CHAIN_MAX_MONTHS) throw new Error(`금액 이월 사슬이 ${CARRY_CHAIN_MAX_MONTHS}달을 넘습니다(${fromPeriod})`);
  const byInvoice = await siblingsByInvoice(db, [...new Set(carried.map((t) => t.invoice_id))], tenantId);
  const judged = carried.map((t) => {
    const inv = one(t.invoice)!;
    const s = invoiceAllocationStates({ id: t.invoice_id, line_items: inv.line_items, status: inv.status }, byInvoice.get(t.invoice_id) ?? []).get(t.id);
    const own: CarrySource | null = s ? {
      allocatedAmount: s.allocatedAmount, allocationStale: s.allocationStale, refundState: s.refundState, refundedAllocation: s.refundedAllocation,
      amount: numOrNull(t.amount), confirmedSessions: numOrNull(t.confirmed_sessions),
    } : null;
    return { t, inv, own, amount: Number(t.allocation_carry_out) };
  });
  // 제 몫(배분 − 확정액)으로 덮이는 이월은 받은 이월과 무관하게 유효하다 — **모자란 줄**의 (학생, 반)만 거슬러 읽는다
  // (매달 제 몫 잔돈을 같은 반으로 넘기는 학생 때문에 사슬이 달마다 깊어지지 않게 — 적대 재리뷰 2026-11-09). 그 반으로 온 이월만 든다.
  const needKeys = new Set(judged.flatMap(({ t, inv, own, amount }) => (own && t.class_id && !carryOutValid(own, amount) ? [monthRosterKey(inv.student_id, t.class_id)] : [])));
  const prior = needKeys.size > 0 ? await carryInsInto(db, fromPeriod, { keys: needKeys }, tenantId, depth + 1) : new Map<string, MoneyCarryIn[]>();
  const out = new Map<string, MoneyCarryIn[]>();
  for (const { t, inv, own, amount } of judged) {
    const source: CarrySource | null = own ? { ...own, carryIns: t.class_id ? prior.get(monthRosterKey(inv.student_id, t.class_id)) : undefined } : null;
    const valid = !!source && carryOutValid(source, amount);
    const key = monthRosterKey(inv.student_id, t.allocation_carry_class_id!);
    (out.get(key) ?? out.set(key, []).get(key)!).push({ amount, fromPeriod, fromClassName: nameOf(t.class), note: t.allocation_carry_note, valid });
  }
  return out;
}

/**
 * `period`에 **받은 이월** — 지난 달 청구서의 이월 행을 읽어 `monthRosterKey(학생, 받을 반)` → 이월 목록.
 * 🔴 유효성은 보내는 달 행을 **같은 판정**(`invoiceAllocationStates` → `carryOutValid`)으로 다시 본다 — 그 행이 받은 이월까지(연쇄).
 * 🔴 취소된 청구서의 이월은 **목록에서 뺀다**(보내는 달 화면에 그 행이 없어 취소할 수도 없다 — 영구 경고가 된다).
 * `studentIds`를 주면 그 학생 것만 돌려준다(메모리 필터).
 */
export async function loadMoneyCarryIns(db: Db, period: string, studentIds: ReadonlySet<string> | null, tenantId?: string): Promise<{ map: Map<string, MoneyCarryIn[]>; failed: boolean }> {
  try {
    return { map: await carryInsInto(db, period, { students: studentIds }, tenantId, 0), failed: false };
  } catch (e) {
    return { map: new Map(), failed: classify(e) };
  }
}

/**
 * 보낸 이월이 **다음 달에 어떻게 착지했나** — 받는 달 화면(`attachMoneyCarry`)과 같은 규칙으로 본다:
 *  · `orphan`  다음 달에 (학생, 받을 반) 줄이 없다(출석부 줄 집합에도 회차 행에도) — 받는 달이 더하지 않는다. 분배 저장을 막는다.
 *  · `landed`  그 줄에 유효 배분이 있다(전액 환불 아님) — 받는 달 실납·분배에 더해졌다.
 *  · `waiting` 줄은 있는데 아직 배분 전 — 받는 달 배분을 저장하면 더해진다(정상적인 '가는 중').
 * 🔴 세션 클라이언트 전용(줄 집합 `loadMonthRoster`가 RLS로 테넌트를 가른다). 실패하면 `failed`(분배 저장 거절).
 */
export async function loadMoneyCarryLanding(db: Db, period: string, carried: readonly { termId: string; studentId: string; toClassId: string }[]): Promise<{ map: Map<string, MoneyCarryLanding>; failed: boolean }> {
  if (carried.length === 0) return { map: new Map(), failed: false };
  const next = shiftMonth(period, 1);
  const studentIds = [...new Set(carried.map((c) => c.studentId))];
  try {
    const [roster, invoices] = await Promise.all([
      loadMonthRoster(db as Parameters<typeof loadMonthRoster>[0], next, { studentIds }),
      fetchInChunks<{ id: string; student_id: string; line_items: unknown; status: string | null }>(studentIds, (chunk) =>
        db.from("invoices").select("id, student_id, line_items, status").eq("period", next).neq("status", "void").in("student_id", chunk)),
    ]);
    const byInvoice = await siblingsByInvoice(db, invoices.map((i) => i.id));
    // (학생, 반)마다 받는 달 회차 행의 배분 상태 — 받는 달 화면이 쓰는 `carryTargetRank`와 같은 재료(`carryLanding`).
    const termStates = new Map<string, CarrySource[]>();
    for (const inv of invoices) {
      const terms = byInvoice.get(inv.id) ?? [];
      const states = invoiceAllocationStates(inv, terms);
      for (const t of terms) {
        const s = states.get(t.id);
        if (!t.class_id || !s) continue;
        const key = monthRosterKey(inv.student_id, t.class_id);
        (termStates.get(key) ?? termStates.set(key, []).get(key)!).push({
          allocatedAmount: s.allocatedAmount, allocationStale: s.allocationStale, refundState: s.refundState, refundedAllocation: s.refundedAllocation,
          amount: t.amount === null ? null : Number(t.amount), confirmedSessions: t.confirmed_sessions === null ? null : Number(t.confirmed_sessions),
        });
      }
    }
    return { map: new Map(carried.map((c) => {
      const key = monthRosterKey(c.studentId, c.toClassId);
      return [c.termId, carryLanding(termStates.get(key) ?? [], roster.byKey.has(key))];
    })), failed: false };
  } catch (e) {
    return { map: new Map(), failed: classify(e) };
  }
}
