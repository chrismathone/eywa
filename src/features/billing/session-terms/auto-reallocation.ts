// 시수 확정 뒤 **배분 자동 재확정** — 사람이 창을 열어 그대로 다시 저장할 일만 대신한다(순수 함수 · Vitest).
//
// 원장 2026-10-06: *"배분을 자꾸 재확정해줘야하는데 스마트하게 재확정 알아서 시켜주면 더 좋겠네."* · *"자꾸 확정이 풀려서 번거로움"*
// 실측(9월~ 감사로그, 다시 저장 196번): 같은 배분을 그대로 다시 저장 47 · 배분 뒤 그 학생의 다른 반을 확정해서 다시 저장 113.
//
// 자동으로 하는 것(판단이 필요 없는 것만):
//   ① 수납 항목을 **한 반이 혼자** 받는 줄 — 그 반을 다시 확정해도 배분액은 그 항목 금액 전부라 바뀔 것이 없다(기준액만 새 확정금액).
//   ② 배분 뒤 **새로 확정한 반** — 어느 반도 안 받은 수업 항목 가운데 그 반과 맞는 것(반 연결 · 반 이름 — 판정 함수는 배분 창의
//      `receiptMatchesClass`)이 **딱 하나**이고, 그 항목이 이 청구서의 다른 어떤 반과도 안 맞을 때만 그 항목 전액. 배분 창의 반 이동 묶음
//      (`transferComponents`)은 여기서 안 본다 — 대신 같은 과목에 아직 확정도 배분도 안 된 반이 있으면(반 이동으로 나눌 수 있다) 건너뛴다.
//   ③ 여러 반이 **나누는** 항목(원장 2026-10-07 *"자꾸 일일이 재확정하지않고 스마트하게 자동확정될 수 있으면 자동확정을 선호함"*) —
//      답이 하나로 정해질 때만: (가) **저장 때도 확정금액대로 나눴던** 묶음이고 나누는 반들의 새 확정금액 합이 그 항목 금액과 같다 →
//      각 반 확정금액대로(JJ↔MS처럼 반끼리 시수를 옮긴 경우). 저장 때 일부러 다르게 나눈 묶음(반반 · 더 받은 몫을 다음 달로 이월)은
//      합이 우연히 맞아도 손대지 않는다 — 사람이 정한 분할과 보낸 이월이 조용히 바뀐다(적대 리뷰 2026-10-07) · (나) 금액을 받는 반이 **하나뿐**이다(나머지는 0원) → 금액 그대로, 기준액만 새 확정금액(0원이던 반의
//      확정금액이 바뀐 경우는 빼고 — 그 0원이 더는 맞는지 모른다).
// 🔴 하지 않는 것: 위 둘에 안 맞는 나누는 줄의 재분배(사람마다 나누는 법이 다르다 — 실측 90번 중 33번이 확정금액 비례가 아니었다) ·
//    자유 배분(관리자 전용, 0279a) · 부분 환불 · 저장 뒤 청구 항목이 바뀐 줄 · 0시수인데 금액이 가는 반 · **확정을 풀어 둔 반이 있는 청구서** ·
//    확정금액이 바뀐 '연결 안 함 0원' 반 · 이름이 안 맞는 빈 항목(특강·다른 반 몫일 수 있다) · 사람이 0원으로 남겨 둔 청구서의 금액 있는 빈 항목.
//    이런 청구서는 지금처럼 '배분 재확인'.
// 🔴 마지막 관문 = **화면과 같은 판정**(`invoiceAllocationStates`)으로 저장 뒤 모습을 미리 보고, 한 반이라도 재확인이 남으면 저장하지 않는다.
import { invoiceAllocationStates, type AllocationTermRow } from "./allocation-state";
import { receiptLines, sameBillAt, sameTuitionLines } from "./receipt-allocation";
import { receiptRefundState } from "./receipt-refund";
import { receiptMatchesClass } from "./receipt-suggestion";
import { isTuitionReceipt } from "./tuition-receipt";
import { unlinkedZeroBlockers } from "./unlinked-zero";

export type AutoInvoice = { id: string; line_items: unknown; status: string | null };
export type AutoTerm = AllocationTermRow & { confirmed_at: string | null; pricing_mode: string; subject: string | null };
/** `save_session_receipt_allocations`에 그대로 넘기는 행(서버 액션 `ReceiptAllocationInput`과 같은 모양). */
export type AutoRow = { termId: string; lineIndex: number | null; amount: number; baseAmount: number | null; confirmedAt: string | null; ackUnlinked?: boolean };
export type AutoSkip = "void" | "none" | "free" | "valid" | "refund" | "released" | "line-changed" | "zero-changed" | "shared" | "zero" | "new-class" | "zero-row" | "still-stale";
export type AutoPlan = { kind: "save"; rows: AutoRow[]; linked: string[] } | { kind: "skip"; reason: AutoSkip };

const num = (v: number | string | null) => (v === null ? null : Number(v));
const confirmed = (t: AutoTerm) => t.confirmed_sessions !== null;
const hasSaved = (t: AutoTerm) => t.allocation_line_index != null || t.allocation_amount != null;
const matches = (source: unknown, t: AutoTerm) => receiptMatchesClass(source, { classId: t.class_id, className: t.className });
/** 0시수 반에는 금액을 줄 수 없다(저장 함수가 거절한다 — 월 정액은 예외). */
const zeroBlocked = (t: AutoTerm, amount: number) => t.pricing_mode !== "monthly" && num(t.confirmed_sessions) === 0 && amount > 0;

export function planAutoReallocation(inv: AutoInvoice, terms: readonly AutoTerm[]): AutoPlan {
  if (inv.status === "void") return { kind: "skip", reason: "void" };
  if (!terms.some(hasSaved)) return { kind: "skip", reason: "none" };
  // 자유 배분 = 연결한 행이 하나도 없고 금액이 있는 연결 없는 행 — 관리자만 다시 정한다.
  if (!terms.some((t) => t.allocation_line_index != null) && terms.some((t) => (num(t.allocation_amount) ?? 0) > 0)) return { kind: "skip", reason: "free" };
  const before = invoiceAllocationStates(inv, terms);
  if (![...before.values()].some((s) => s.allocationStale)) return { kind: "skip", reason: "valid" };
  if ([...before.values()].some((s) => s.refundState === "partial")) return { kind: "skip", reason: "refund" };
  // 확정을 풀어 둔 반(기준액이 남은 채 확정 해제) — 다시 확정할 때까지 사람이 보는 상태다. 다른 반 확정이 그 배분을 '정상'으로 덮지 않는다.
  // 덮으면 기준액이 비어, 다시 확정할 때 0267b 트리거가 **새 금액을 그대로 기준액으로** 받는다 — 나누는 항목이어도 재확인이 조용히 사라진다
  // (0시수 재확정도 막힌다).
  if (terms.some((t) => !confirmed(t) && hasSaved(t) && t.allocation_base_amount !== null)) return { kind: "skip", reason: "released" };

  const lines = receiptLines(inv.line_items);
  const rows: AutoRow[] = [];
  const fresh: AutoTerm[] = [];
  const row = (t: AutoTerm, lineIndex: number | null, amount: number, ackUnlinked?: boolean): AutoRow =>
    ({ termId: t.id, lineIndex, amount, baseAmount: num(t.amount), confirmedAt: t.confirmed_at, ...(ackUnlinked ? { ackUnlinked } : {}) });
  for (const t of terms) {
    const saved = num(t.allocation_amount);
    // 🔴 저장 뒤 청구 항목이 바뀌었으면(금액·묶음 · 순서가 바뀌어 같은 번호가 다른 항목) 사람 몫이다. 다시 저장하면 스냅샷이
    //    지금 항목으로 바뀌어 아래 마지막 관문으로는 이 차이가 안 보인다 — 여기서 저장 때 스냅샷과 먼저 맞춰 본다.
    //    ⚠️ 그 자리에서 **수납명만** 바뀐 것은 바뀐 것이 아니다(원장 2026-10-07 "금액이 바뀌지 않으면 그대로" — `sameBillAt`).
    if (t.allocation_line_index != null && !sameBillAt(t.allocation_source, lines.find((l) => l.index === t.allocation_line_index), lines)) return { kind: "skip", reason: "line-changed" };
    if (t.allocation_line_index == null && saved === 0 && !sameTuitionLines(t.allocation_source, lines)) return { kind: "skip", reason: "line-changed" };
    if (t.allocation_line_index != null && saved !== null) rows.push(row(t, t.allocation_line_index, saved));
    // 연결 안 함 0원(0269a) — 저장할 때 남는 항목을 확인받았다. 수업 항목이 그대로(위)이고 연결은 늘기만 하므로 그 확인은 그대로 유효하다.
    // 🔴 단 그 반의 확정금액이 바뀌었으면(0시수 → 5시수 등) '0원'이 더는 맞는지 모른다 — 다시 실으면 그 반 몫이 조용히 0원으로 굳는다.
    else if (t.allocation_line_index == null && saved === 0) {
      if (num(t.allocation_base_amount) !== num(t.amount)) return { kind: "skip", reason: "zero-changed" };
      rows.push(row(t, null, 0, true));
    }
    else if (confirmed(t)) fresh.push(t);
  }
  // 혼자 받는 줄은 저장 금액 그대로(= 항목 금액 — 마지막 관문이 확인한다). 나누는 줄에 재확인이 걸렸으면 **답이 하나일 때만** 맞춘다.
  for (const index of new Set(rows.map((r) => r.lineIndex))) {
    if (index === null) continue;
    const group = rows.filter((o) => o.lineIndex === index);
    if (group.length < 2 || !group.some((o) => before.get(o.termId)?.allocationStale)) continue;
    const termOf = (r: AutoRow) => terms.find((t) => t.id === r.termId)!;
    const line = lines.find((l) => l.index === index);
    // (나) 금액을 받는 반이 하나뿐 — 사람이 정한 "이 반이 전부 받는다"는 그대로다. 단 0원이던 반의 확정금액이 바뀌었으면 사람 몫.
    const zeroChanged = group.some((r) => r.amount === 0 && num(termOf(r).allocation_base_amount) !== num(termOf(r).amount));
    if (group.filter((r) => r.amount > 0).length <= 1 && !zeroChanged) continue;
    // (가) 나누는 반들의 새 확정금액 합 = 그 항목 금액 — 각 반 확정금액대로 나눈다(반끼리 시수만 옮긴 경우).
    // 🔴 저장 때도 확정금액대로 나눴던 묶음만(배분액 = 그때 기준액). 일부러 다르게 나눈 분할은 사람이 정한 것이다.
    const followedBase = group.every((r) => num(termOf(r).allocation_amount) === num(termOf(r).allocation_base_amount));
    const confirmedAmounts = group.map((r) => (confirmed(termOf(r)) ? num(termOf(r).amount) : null));
    if (line && followedBase && confirmedAmounts.every((a): a is number => a !== null && Number.isSafeInteger(a) && a >= 0)
      && confirmedAmounts.reduce((sum, a) => sum + a, 0) === line.amount) {
      group.forEach((r, i) => { r.amount = confirmedAmounts[i]!; });
      continue;
    }
    return { kind: "skip", reason: "shared" };
  }

  // 새로 확정한 반 — 어느 반도 안 받은(환불 아닌) 수업 항목 가운데 그 반과 맞는 것이 딱 하나이고, 그 항목이 다른 어떤 반과도 안 맞을 때만.
  const used = new Set(rows.map((r) => r.lineIndex));
  const open = lines.filter((l) => isTuitionReceipt(l.source) && l.amount >= 0 && !used.has(l.index) && receiptRefundState(l.source) === "none");
  const linked: string[] = [];
  // 사람이 '연결 안 함 0원'으로 저장한 청구서 = 금액 있는 빈 항목은 "남는다"고 확인받은 항목이다 — 새 반에 붙이는 것도 사람 몫.
  const acknowledged = rows.some((r) => r.lineIndex === null);
  const sameSubject = (a: AutoTerm, b: AutoTerm) => a.subject == null || b.subject == null || a.subject === b.subject;
  for (const t of fresh) {
    if (before.get(t.id)?.fullyRefunded) return { kind: "skip", reason: "new-class" };
    // 같은 과목에 확정도 배분도 안 된 반이 있으면 반 이동으로 한 항목을 나눌 수 있다(배분 창의 제안은 이동 이력으로 나눈다).
    if (terms.some((o) => o.id !== t.id && !confirmed(o) && !hasSaved(o) && sameSubject(o, t))) return { kind: "skip", reason: "new-class" };
    const named = open.filter((l) => matches(l.source, t));
    const pick = named.length === 1 && !terms.some((o) => o.id !== t.id && matches(named[0]!.source, o)) ? named[0] : undefined;
    if (!pick || used.has(pick.index) || (acknowledged && pick.amount > 0)) return { kind: "skip", reason: "new-class" };
    used.add(pick.index);
    rows.push(row(t, pick.index, pick.amount));
    linked.push(t.id);
  }
  for (const r of rows) {
    const t = terms.find((x) => x.id === r.termId)!;
    if (zeroBlocked(t, r.amount)) return { kind: "skip", reason: "zero" };
  }
  // '연결 안 함 0원' 반에 이름이 맞는 항목이 생겼으면 사람이 다시 본다(서버 액션과 같은 판정).
  const draft = Object.fromEntries(rows.map((r) => [r.termId, { line: r.lineIndex === null ? "" : String(r.lineIndex), amount: String(r.amount) }]));
  const zeroCheck = unlinkedZeroBlockers(lines.filter((l) => isTuitionReceipt(l.source)),
    terms.filter((t) => t.id in draft).map((t) => ({ id: t.id, classId: t.class_id, className: t.className, confirmedSessions: num(t.confirmed_sessions) })), draft);
  if (zeroCheck.matchedTerms.length) return { kind: "skip", reason: "zero-row" };

  // 마지막 관문 — 저장 함수가 쓸 모습(기준액 = 지금 확정금액 · 스냅샷 = 지금 청구 항목)을 화면 판정에 그대로 넣어 본다.
  const after = invoiceAllocationStates(inv, terms.map((t) => {
    const r = rows.find((x) => x.termId === t.id);
    if (!r) return { ...t, allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null };
    const source = r.lineIndex === null ? inv.line_items : (Array.isArray(inv.line_items) ? inv.line_items[r.lineIndex] : null);
    return { ...t, allocation_line_index: r.lineIndex, allocation_amount: r.amount, allocation_source: source, allocation_base_amount: t.amount };
  }));
  if (terms.some((t) => (confirmed(t) || rows.some((r) => r.termId === t.id)) && after.get(t.id)?.allocationStale)) return { kind: "skip", reason: "still-stale" };
  return { kind: "save", rows, linked };
}
