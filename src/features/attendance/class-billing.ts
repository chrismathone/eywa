import { classInvoiceAmount, type LineItemLike } from "@/features/billing/session-terms/class-amount";
import { effectiveAllocations, receiptLines } from "@/features/billing/session-terms/receipt-allocation";
import { invoiceAllocationStates } from "@/features/billing/session-terms/allocation-state";
import { canReceiveCarry, carryInTotal, carryOutValid, type MoneyCarryIn } from "@/features/billing/session-terms/money-carryover";
import { monthRosterKey } from "@/features/billing/session-terms/month-roster";
import { round1 } from "./session-units";
import { rowKey } from "./grid/model";

/** `status`는 선택 — 금액 이월 유효성(전액 환불 판정)에만 쓴다. */
export type AttendanceInvoice = { id: string; student_id: string; line_items: unknown; status?: string | null };
export type AttendanceBillingTerm = {
  id: string;
  invoice_id: string;
  class_id: string | null;
  amount: number | null;
  confirmed_sessions: number | null;
  /**
   * 확정 시 저장한 회당 단가(월 정액이면 월 금액) — 확정 해제면 null. 「단가」 표식 연동 재료(원장 2026-09-18).
   * ⚠️ 선택 필드 — 금액·차수 계산은 이 값을 안 읽는다(청구액은 배분·반 매칭, 차수는 `confirmed_sessions`).
   */
  unit_price?: number | null;
  allocation_line_index: number | null;
  allocation_amount: number | null;
  allocation_source: unknown;
  allocation_base_amount: number | null;
  /** 확정 당시 세는 단위 — `attendance_units`(시수)가 아니면 **옛 일수 기준**이다(null도 일수, 회차 확정과 같은 폴백). */
  quantity_basis: string | null;
  /** 월 정액(EiE)은 일수·시수 축이 아예 없다 — 일수 기준 표식에서 뺀다(회차 확정 화면과 같은 규약). */
  pricing_mode: string | null;
};
export type AttendanceBillingClass = { classId: string; className: string; studentIds: readonly string[] };

/**
 * 학생의 **그 달 청구서 상태** — 회차 확정 화면의 `termRowState`(billing/session-terms/month-roster.ts)와 같은 갈래
 * (원장 2026-09-18 *"출석부에 존재하는 행 개수와, 회차 확정의 행 개수가 서로 유기적으로 일치해야해"* — 두 화면이 같은 줄을
 * 같은 말로 불러야 한다).
 *  · `ok`   취소(void) 아닌 청구서가 하나라도 있다 → 회차 행이 없어도 회차 확정에서 만들 수 있다('미확정').
 *  · `void` 청구서가 있긴 한데 **전부** 취소됐다 → 확정·배분할 수납이 없다('—').
 *  · `none` 그 달 청구서가 없다 → 붙일 청구서가 없다('—').
 * 🔴 raw 코드다 — 화면은 사전(`att.row.noInvoice*`)을 거친 글자만 내보낸다.
 */
export type AttendanceInvoiceState = "ok" | "none" | "void";

/** '—'로 서는 이유 — `ok`가 아닌 두 갈래(화면·툴팁이 문구를 가른다). */
export type AttendanceInvoiceGap = Exclude<AttendanceInvoiceState, "ok">;

/**
 * 학생별 청구서 상태 — 입력 청구서는 **void 포함**으로 읽은 그 달 것이어야 한다(void를 빼고 읽으면 `void`와 `none`이 안 갈린다).
 * ⚠️ `studentIds`에 든 학생만 키를 만든다(출석부가 물어본 학생 밖은 판정 대상이 아니다) — 청구서가 없는 학생도 `none`으로
 *    **반드시** 키가 선다(없는 키 = "판정 안 함"이라 '미확정' 그대로다).
 */
export function attendanceInvoiceStateByStudent(
  studentIds: readonly string[],
  invoices: readonly { student_id: string; status: string | null }[],
): Record<string, AttendanceInvoiceState> {
  const out: Record<string, AttendanceInvoiceState> = {};
  for (const id of studentIds) out[id] = "none";
  for (const invoice of invoices) {
    if (!(invoice.student_id in out)) continue;
    // 하나라도 살아 있으면 ok — void는 다른 청구서가 없을 때만 남는다.
    if (invoice.status !== "void") out[invoice.student_id] = "ok";
    else if (out[invoice.student_id] === "none") out[invoice.student_id] = "void";
  }
  return out;
}

/**
 * 출석부에서 **'미확정' 대신 `—`로 적을 줄**(`rowKey`) → 이유(원장 2026-09-18 선택 = *'—'(해당 없음)*: 청구서가 없거나
 * 취소된 줄. 청구서는 있는데 회차 행만 없는 줄은 종전대로 '미확정' — 회차 확정 화면에서 확정할 수 있으니).
 * 🔑 판정은 **학생 단위**다(청구서는 학생 × 달) — 그 학생의 모든 반 줄이 같은 이유를 받는다. 회차 행은 청구서에 매달리므로
 *    상태가 `ok`가 아닌 학생에겐 살아 있는 회차 행이 있을 수 없다(= "회차 행이 없는 줄에만").
 * ⚠️ 상태 맵에 없는 학생(출석부가 안 물어본 반)은 넣지 않는다 — 모르는 것을 '청구서 없음'으로 읽지 않는다.
 */
export function attendanceNoInvoiceRows(
  roster: readonly { classId: string; studentIds: readonly string[] }[],
  invoiceStateByStudent: Readonly<Record<string, AttendanceInvoiceState>>,
): Map<string, AttendanceInvoiceGap> {
  const out = new Map<string, AttendanceInvoiceGap>();
  for (const c of roster) {
    for (const studentId of c.studentIds) {
      const state = invoiceStateByStudent[studentId];
      if (state === "none" || state === "void") out.set(rowKey(c.classId, studentId), state);
    }
  }
  return out;
}

/** 금액 이월(0278a) — 보낸 이월(회차 행 id → 원) · 받은 이월(`monthRosterKey(학생, 반)` → 목록). 없으면 빈 맵. */
export type AttendanceMoneyCarry = { outs: ReadonlyMap<string, number>; ins: ReadonlyMap<string, readonly MoneyCarryIn[]> };
const NO_CARRY: AttendanceMoneyCarry = { outs: new Map(), ins: new Map() };

/**
 * 회차 확정의 '이 반 청구액'과 동일: 유효한 배분 우선, 없으면 반 이름 매칭.
 * 배분이 있는 줄은 **금액 이월을 반영한 실납**(배분액 − 유효한 보낸 이월 + 유효한 받은 이월, 회차 확정 면의 `netAllocatedAmount`와 같은 규칙).
 * 보낸 이월의 유효성은 회차 확정 면과 같은 판정(`invoiceAllocationStates` → `carryOutValid`)으로 본다.
 */
export function attendanceClassBilledAmounts(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
  carry: AttendanceMoneyCarry = NO_CARRY,
): Record<string, number> {
  const classById = new Map(classes.map((c) => [c.classId, { ...c, students: new Set(c.studentIds) }]));
  const termsByInvoice = new Map<string, AttendanceBillingTerm[]>();
  for (const term of terms) {
    const rows = termsByInvoice.get(term.invoice_id) ?? [];
    rows.push(term);
    termsByInvoice.set(term.invoice_id, rows);
  }
  const out: Record<string, number> = {};
  const carriedIn = new Set<string>(); // 같은 학생·반이 청구서 여러 장에 있어도 받은 이월은 한 번만.
  for (const invoice of invoices) {
    const invoiceTerms = termsByInvoice.get(invoice.id) ?? [];
    // 이월 판정 재료(회차 확정 면과 같은 판정) — 이 청구서에 보낸 이월이나 받은 이월이 있을 때만 계산한다.
    const needsStates = invoiceTerms.some((t) => carry.outs.has(t.id) || (t.class_id !== null && carry.ins.has(monthRosterKey(invoice.student_id, t.class_id))));
    const states = needsStates
      ? invoiceAllocationStates({ ...invoice, status: invoice.status ?? null },
        invoiceTerms.map((t) => ({ ...t, className: t.class_id ? classById.get(t.class_id)?.className ?? null : null })))
      : null;
    // 같은 청구 항목을 나누는 다른 반까지 검증한 뒤 표시할 반만 고른다.
    const allocated = effectiveAllocations(receiptLines(invoice.line_items), invoiceTerms.map((term) => ({
      id: term.id,
      amount: term.amount === null ? null : Number(term.amount),
      confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null,
      allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source,
      baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    const lineItems = (Array.isArray(invoice.line_items) ? invoice.line_items : []) as LineItemLike[];
    // 🔴 유효한 자유 배분(0279a — 연결 없이 금액)이 있는 청구서는 금액을 안 받은 반을 반 이름 매칭으로 채우지 않는다(0) — 채우면
    //    관리자가 수업 청구액을 전부 한 반에 줬을 때 다른 반에 청구액이 또 떠 합계가 받은 돈을 넘는다(적대 리뷰 2026-09-21).
    const freeActive = invoiceTerms.some((t) => t.allocation_line_index == null && Number(t.allocation_amount ?? 0) > 0 && allocated.has(t.id));
    for (const term of invoiceTerms) {
      const cls = term.class_id ? classById.get(term.class_id) : undefined;
      if (!cls?.students.has(invoice.student_id)) continue;
      const base = allocated.get(term.id);
      let amount = base ?? (freeActive ? 0 : classInvoiceAmount(cls.className, lineItems));
      if (amount === null) continue;
      if (base !== undefined) {
        const sent = carry.outs.get(term.id) ?? 0;
        const state = states?.get(term.id);
        if (sent > 0 && state && carryOutValid({ ...state, amount: term.amount === null ? null : Number(term.amount), confirmedSessions: term.confirmed_sessions === null ? null : Number(term.confirmed_sessions) }, sent)) amount -= sent;
        const inKey = monthRosterKey(invoice.student_id, cls.classId);
        // 받은 이월은 받을 수 있는 줄에만(회차 확정 `netAllocatedAmount`와 같은 `canReceiveCarry` — 환불로 만든 0이면 안 싣는다).
        const receivable = !!state && canReceiveCarry({ ...state, amount: term.amount === null ? null : Number(term.amount), confirmedSessions: term.confirmed_sessions === null ? null : Number(term.confirmed_sessions) });
        if (!carriedIn.has(inKey) && carry.ins.has(inKey) && receivable) {
          carriedIn.add(inKey);
          amount += carryInTotal(carry.ins.get(inKey));
        }
      }
      const key = rowKey(cls.classId, invoice.student_id);
      out[key] = (out[key] ?? 0) + amount;
    }
  }
  return out;
}

/**
 * 학생×반 등록 차수 한 칸 — 값과 **그 값의 단위**.
 * 🔴 `daysBasis`는 "이 숫자는 시수가 아니라 **출석 일수**"라는 뜻이다(회차 확정이 붉게 칠하는 그 값).
 */
export type AttendanceTermSessions = {
  units: number;
  daysBasis: boolean;
  /** Full class confirmation, before the teacher's scheduled share is applied. */
  classUnits?: number;
  allocationPending?: boolean;
};

/** 회차 확정에 저장된 단가. 월 정액은 회당 단가와 구분하고, 서로 다른 단가는 더하지 않는다. */
export type AttendanceConfirmedPrice = { unitPrice: number; monthly: boolean; daysBasis: boolean };

export function attendanceClassConfirmedPrices(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): Record<string, AttendanceConfirmedPrice[]> {
  const classById = new Map(classes.map((c) => [c.classId, new Set(c.studentIds)]));
  const studentByInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  const out: Record<string, AttendanceConfirmedPrice[]> = {};
  const pending = new Set<string>();
  for (const term of terms) {
    if (!term.class_id) continue;
    const studentId = studentByInvoice.get(term.invoice_id);
    if (!studentId || !classById.get(term.class_id)?.has(studentId)) continue;
    const key = rowKey(term.class_id, studentId);
    const unitPrice = Number(term.unit_price);
    if (term.confirmed_sessions == null || term.unit_price == null || !Number.isFinite(unitPrice) || unitPrice < 0) {
      pending.add(key);
      continue;
    }
    const price = { unitPrice, monthly: term.pricing_mode === "monthly", daysBasis: isDaysBasisTerm(term) };
    const prices = out[key] ??= [];
    if (!prices.some((p) => p.unitPrice === price.unitPrice && p.monthly === price.monthly && p.daysBasis === price.daysBasis)) {
      prices.push(price);
    }
  }
  // 일부 회차만 확정됐다면 전체가 확정된 것처럼 보이지 않게 한다.
  for (const key of pending) delete out[key];
  return out;
}

/** 확정 당시 단위 — 회차 확정 화면과 **같은 폴백**(null이면 옛 일수 기준). 월 정액은 이 축이 없다. */
function isDaysBasisTerm(term: AttendanceBillingTerm): boolean {
  if (term.pricing_mode === "monthly") return false;
  return (term.quantity_basis ?? "days") === "days";
}

/**
 * 학생×반 **등록 차수** — 회차 확정(`invoice_session_terms.confirmed_sessions`)에서 확정한 시수(원장 2026-09-17
 * *"등록 차수 열 추가하고. 그걸 회차 확정에서 확정된 시수로 보여줄것"*).
 *
 * 🔴 **확정한 것만** 담는다 — 미확정(null)은 키를 만들지 않는다(화면이 '미확정'으로 적는다). 0을 지어내면
 *    "등록 0차수"가 확정된 사실처럼 읽힌다.
 * 🔴 **옛 일수 기준 확정은 단위가 다르다** — 회차 확정 화면이 붉은 숫자 + 카드로 *"재확정 필요"*라 적는 그 값이라
 *    (원장 2026-09-16), 여기서도 `daysBasis`로 표시해 넘긴다. 감추거나 '미확정'으로 바꾸지 말 것(둘 다 거짓이다).
 * ⚠️ 같은 학생·반에 청구서가 둘이면(재발행·중복) **합친다** — 청구액과 같은 규약(위 함수도 더한다).
 *    합은 `round1`을 지난다(1.1을 여러 번 더하면 꼬리가 남아 "1"이 "1.0"으로 찍힌다).
 */
export function attendanceClassConfirmedSessions(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): Record<string, AttendanceTermSessions> {
  const classById = new Map(classes.map((c) => [c.classId, { ...c, students: new Set(c.studentIds) }]));
  const studentByInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  const out: Record<string, AttendanceTermSessions> = {};
  for (const term of terms) {
    if (term.confirmed_sessions === null || !term.class_id) continue;
    const studentId = studentByInvoice.get(term.invoice_id);
    const cls = classById.get(term.class_id);
    if (!studentId || !cls?.students.has(studentId)) continue;
    const key = rowKey(cls.classId, studentId);
    const prev = out[key];
    out[key] = {
      units: round1((prev?.units ?? 0) + Number(term.confirmed_sessions)),
      // 하나라도 옛 일수 기준이면 그 합은 단위가 섞였다 — 섞였다는 사실을 알린다.
      daysBasis: (prev?.daysBasis ?? false) || isDaysBasisTerm(term),
    };
  }
  return out;
}

/**
 * 회차 확정에서 **단가까지 확정된** 학생×반 줄(`rowKey`) — 출석부 「단가」 표식을 떼는 재료(원장 2026-09-18
 * *"회차 확정의 단가가 확정되었으면 출석부 단가 라벨 지울것. 해당 단가와 연동하면 될듯"*).
 *
 * 🔴 그 줄의 회차 행이 **전부** 확정(`confirmed_sessions`)이고 단가(`unit_price`)가 있을 때만 담는다 — 같은 학생·반에
 *    청구서가 둘이라 한쪽이 아직 미확정이면 회차 확정 화면엔 그 행이 '미확정'으로 남아 있다(표식도 남긴다).
 * 🔴 회차 행이 없는 줄(청구서 없음·반 미매칭)은 안 담는다 — 확정한 사실이 없다.
 * ⚠️ **표시 전용**이다 — 정산액은 이 값을 읽지 않는다. 수학 반의 정산 단가는 정산 조립이 **따로** 회차 단가를 읽는다
 *    ([`collectTierRows`](@/features/payroll/server/tier-rows) — 같은 날 원장 결정). 그래서 수학 줄은 이 목록이 없어도
 *    표식이 빠지고, 이 목록이 떼는 것은 **영어 줄**(티어 정산 대상이 아니다)과 정산에 못 쓰는 확정분(옛 일수 기준 등)뿐이다.
 *    그 줄들은 정산에서 빠진 채라 합계 줄의 '단가 미지정 N명 · N시수 제외'는 계속 설 수 있다(그게 사실이다).
 */
export function attendanceClassPriceConfirmedRows(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): string[] {
  return Object.keys(attendanceClassConfirmedPrices(classes, invoices, terms));
}
