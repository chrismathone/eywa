import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { logAction } from "@/features/audit/server/log";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { planAutoReallocation } from "../auto-reallocation";
import { carryShortfall, planCarrySessionSync } from "../carry-session-sync";
import { carryOutValid } from "../money-carryover";
import { attachMoneyCarry } from "../money-carry-attach";
import { autoReallocateAfterConfirm, loadAutoInvoices } from "./auto-reallocate";
import { loadMoneyCarryIns, loadMoneyCarryOuts } from "./money-carryover-queries";
import { getSessionTermsView, type SessionTermRow } from "./queries";

// 금액 이월 → **확정 시수 자동 반영**(원장 2026-10-07) — 판정은 순수 함수(`planCarrySessionSync`), 저장은 사람이 다시 확정할 때와
// 같은 칸(확정 시수 · 확정액 · 확정한 사람·시각)만 고친다. 고친 뒤 배분은 `autoReallocateAfterConfirm`이 다시 확정한다.
// 🔴 **올리기만 한다** — 이월을 취소·줄였을 때는 자동으로 내리지 않고 덜 받게 된 줄을 알린다(`shorts`, 이유는 순수 모듈 머리 주석).
// 🔴 best effort — 어떤 실패든 부른 일(이월 저장 · 확정 · 배분 저장)은 이미 끝났다. 조용히 지금처럼 '사람이 고칠 줄'로 남긴다.
// 🔴 **배분이 다시 확정될 줄만** 고친다 — 확정액을 바꾸면 그 청구서의 배분이 '재확인'이 된다. 자동 재확정이 못 하는 청구서(여러 반이
//    나누는 항목 · 자유 배분 · 부분 환불 등)를 고치면 맞던 줄을 재확인 줄로 바꿔 놓는 꼴이라 손대지 않는다. 미리 본 것과 달리 재확정이
//    실패하면(그 사이 다른 저장과 겹침) **고친 값을 되돌린다** — 이월이 안 실린 '재확인' 줄로 남기지 않는다.
// ⚠️ 받은 이월이 있는 학생만 본다(이월은 한 달에 몇 건) — 없으면 조회 두 번으로 끝난다.

type Db = SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Embed<T> = T | T[] | null | undefined;
const one = <T,>(v: Embed<T>) => (Array.isArray(v) ? v[0] : v) ?? null;
const won = (n: number) => `${Math.abs(n).toLocaleString("ko-KR")}원`;
const month = (period: string) => `${Number(period.slice(5, 7))}월`;

/** 고친 줄 — 화면 안내와 감사로그의 재료. */
export type CarrySyncChange = {
  termId: string;
  period: string;
  studentName: string;
  className: string | null;
  sessionsBefore: number;
  sessions: number;
  amountBefore: number;
  amount: number;
  unitPrice: number;
  confirmedAt: string;
  /** 반영한 받은 이월(원). */
  byAmount: number;
  /** 고친 뒤 배분 재확정도, 되돌리기도 실패했다 — 줄이 '배분 재확인'으로 남았으니 사람이 배분을 다시 저장해야 한다. */
  needsAllocation?: true;
};

/** 이월이 빠져 **덜 받게 된** 줄 — 자동으로 내리지 않고 알리기만 한다. */
export type CarrySyncShort = { termId: string; period: string; studentName: string; className: string | null; sessions: number; amount: number; shortBy: number };

/**
 * 연쇄 이월이 **끊긴** 줄(2026-11-09) — 이번 저장으로 덜 받게 된 줄이 다음 달로 넘긴 이월이 무효가 됐다(받은 이월로 남았던 몫이 사라짐).
 * 그 다음 달 실납에서도 빠지므로, 사람이 그 이월을 고치거나 취소하고 다음 달을 확인해야 한다.
 */
export type CarryChainBreak = { period: string; toPeriod: string; studentName: string; className: string | null; amount: number };

/** 끊긴 연쇄 이월 안내 — "9월 조은준 중등E_중1 SKY: 10월로 넘긴 12,000원 이월이 무효가 되었습니다 …". */
export function carryChainBreakNotice(broken: readonly CarryChainBreak[]): string | undefined {
  if (broken.length === 0) return undefined;
  return broken
    .map((b) => `${lineName(b)}: 받은 이월이 줄어 ${month(b.toPeriod)}로 넘긴 ${won(b.amount)} 이월이 무효가 되었습니다 — ${month(b.toPeriod)} 실납에서도 빠졌으니 ${month(b.period)} 이월을 고치거나 취소하고 ${month(b.toPeriod)} 회차 확정을 확인해 주세요.`)
    .join("\n");
}

const lineName = (c: { period: string; studentName: string; className: string | null }) => `${month(c.period)} ${c.studentName}${c.className ? ` ${c.className}` : ""}`;

/** 화면에 보일 한 줄 — "9월 홍도연 중등M 개별: 확정 시수 5 → 6(받은 이월 24,000원 반영)". */
export function carrySyncNotice(changes: readonly CarrySyncChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  return changes
    .map((c) => `${lineName(c)}: 확정 시수 ${c.sessionsBefore} → ${c.sessions}(받은 이월 ${won(c.byAmount)} 반영)${c.needsAllocation ? " — 배분을 다시 저장해 주세요" : ""}`)
    .join(" · ");
}

/** 이월을 취소·줄인 뒤의 안내 — 확정 시수는 그대로 두었으니 사람이 확인하라고 말한다. */
export function carryShortNotice(shorts: readonly CarrySyncShort[]): string | undefined {
  if (shorts.length === 0) return undefined;
  return shorts
    .map((s) => `${lineName(s)}: 이월이 빠져 실납이 확정액보다 ${won(s.shortBy)} 적습니다 — 확정 시수 ${s.sessions}은(는) 그대로 두었습니다. 회차 확정에서 확인해 주세요.`)
    .join("\n");
}

/** 확정 응답의 행 패치 모양(`SessionTermPatch`) 가운데 여기서 고치는 칸. */
type PatchLike = { id: string; confirmedSessions: number | null; unitPrice: number | null; amount: number | null; pricingMode: "per_session" | "monthly"; confirmedAt: string | null; quantityBasis?: "days" | "attendance_units"; carryNotice?: string };

/**
 * 확정 응답의 행 패치에 자동 조정을 싣는다 — 방금 확정한 줄이 고쳐졌으면 그 줄의 값을 바꾸고, 같은 학생의 **다른 줄**이 고쳐졌으면
 * (이 확정으로 그 청구서의 배분이 살아나 이월이 실린 줄) 패치를 하나 더한다. 화면은 `carryNotice`를 한 번 알린다.
 */
export function applyCarrySync<T extends PatchLike>(terms: readonly T[], changes: readonly CarrySyncChange[]): (T | PatchLike)[] {
  if (changes.length === 0) return [...terms];
  const byId = new Map(changes.map((c) => [c.termId, c]));
  const patched: (T | PatchLike)[] = terms.map((t) => {
    const c = byId.get(t.id);
    return c ? { ...t, confirmedSessions: c.sessions, amount: c.amount, confirmedAt: c.confirmedAt, carryNotice: carrySyncNotice([c]) } : t;
  });
  const known = new Set(terms.map((t) => t.id));
  for (const c of changes) {
    if (known.has(c.termId)) continue;
    patched.push({ id: c.termId, confirmedSessions: c.sessions, unitPrice: c.unitPrice, amount: c.amount, pricingMode: "per_session", confirmedAt: c.confirmedAt, quantityBasis: "attendance_units", carryNotice: carrySyncNotice([c]) });
  }
  return patched;
}

/** 받는 달(`period`) 그 학생의 살아 있는 청구서들. */
async function liveInvoiceIds(db: Db, period: string, studentId: string): Promise<string[]> {
  const { data, error } = await db.from("invoices").select("id").eq("period", period).eq("student_id", studentId).neq("status", "void").order("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

/**
 * 그 학생의 `period` 줄 전부(청구서가 여러 장이면 합쳐서) + 금액 이월 — 회차 확정 화면과 **같은 함수**(`attachMoneyCarry`)로 받을 줄을 고른다.
 * 이월 조회가 실패했으면 null(판정하지 않는다).
 */
async function studentRows(db: Db, period: string, invoiceIds: readonly string[], studentId: string): Promise<SessionTermRow[] | null> {
  const [views, outs, ins] = await Promise.all([
    Promise.all(invoiceIds.map((id) => getSessionTermsView(period, id))),
    loadMoneyCarryOuts(db, period, invoiceIds),
    loadMoneyCarryIns(db, period, new Set([studentId])),
  ]);
  if (outs.failed || ins.failed) return null;
  const rows = views.flatMap((v) => v.rows);
  attachMoneyCarry(rows, outs.map, ins.map);
  return rows;
}

/**
 * 그 학생의 `period` 줄 전부 + 금액 이월 — 이월 창·저장(`money-carryover-actions`)이 더 받은 몫을 **회차 확정 화면과 같은 값**으로
 * 다시 구할 때 쓴다(연쇄 이월: 받은 이월도 더 받은 몫에 든다 — 배분 창 모드 조회는 이월을 안 붙인다). 이월 조회가 실패하면 null.
 */
export async function loadStudentCarryRows(db: Db, period: string, studentId: string): Promise<SessionTermRow[] | null> {
  return studentRows(db, period, await liveInvoiceIds(db, period, studentId), studentId);
}

/** 보낸 이월이 있는 줄의 상태 — 확정·배분 저장 **전후**를 비교해 이번 저장이 그 이월을 무효로 만들었는지 본다. */
export type CarryOutState = { valid: boolean; amount: number; toPeriod: string; period: string; studentName: string; className: string | null; allocationStale: boolean };

/**
 * 줄들 가운데 **다음 달로 보낸 이월이 있는 줄**의 유효 여부(회차 확정 화면과 같은 줄·같은 붙이기 — `studentRows`).
 * 보낸 이월이 없으면 조회 한 번으로 끝난다(대부분의 확정·배분 저장). 조회 실패 = null(경고하지 않는다 — 저장은 이미 끝났다).
 * 원장 2026-11-09 *"남은 한계는 근본 해결해"* — 확정·배분 저장으로 보낸 이월이 조용히 '이월 재확인'이 되고 다음 달 실납에서 빠지던 한계.
 */
export async function loadCarryOutStates(db: Db, termIds: readonly string[]): Promise<Map<string, CarryOutState> | null> {
  const ids = [...new Set(termIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  try {
    type Sending = { id: string; invoice: Embed<{ period: string; student_id: string; status: string | null }> };
    const sending = await fetchInChunks<Sending>(ids, (chunk) =>
      db.from("invoice_session_terms").select("id, invoice:invoice_id ( period, student_id, status )").gt("allocation_carry_out", 0).in("id", chunk));
    const want = new Set<string>();
    const pairs = new Map<string, { period: string; studentId: string }>();
    for (const s of sending) {
      const inv = one(s.invoice);
      if (!inv || inv.status === "void") continue;
      want.add(s.id);
      pairs.set(`${inv.period}|${inv.student_id}`, { period: inv.period, studentId: inv.student_id });
    }
    const out = new Map<string, CarryOutState>();
    // 학생마다 따로 읽는다 — 서로 기다릴 이유가 없다(B4).
    const loaded = await Promise.all([...pairs.values()].map(async ({ period, studentId }) =>
      ({ period, rows: await studentRows(db, period, await liveInvoiceIds(db, period, studentId), studentId) })));
    for (const { period, rows } of loaded) {
      if (!rows) return null;
      for (const r of rows) {
        if (!want.has(r.id) || !r.carryOut) continue;
        out.set(r.id, {
          valid: carryOutValid(r, r.carryOut.amount), amount: r.carryOut.amount, toPeriod: r.carryOut.toPeriod, period,
          studentName: r.studentName, className: r.className, allocationStale: !!r.allocationStale,
        });
      }
    }
    return out;
  } catch (error) {
    logDbError(error, "billing.session-terms.carryOutStates", {});
    return null;
  }
}

/**
 * 저장 **전에는 유효**했는데 **뒤에는 무효**가 된 보낸 이월의 경고(줄 id → 문구). 원래 무효였던 이월('이월 재확인')은 이번 저장 탓이 아니라 뺀다 —
 * 단 저장 전 무효의 이유가 **배분 재확인뿐**이었는데 이번 저장으로 재확인이 풀렸는데도 무효면 알린다(배분을 다시 저장하면 될 줄 알았는데
 * 확정액이 함께 커져 모자란 경우 — 적대 재리뷰 2026-11-09). 어느 쪽이든 모르면(null) 비운다.
 */
export function carryOutBreakWarnings(
  before: ReadonlyMap<string, CarryOutState> | null,
  after: ReadonlyMap<string, CarryOutState> | null,
  cause: "change" | "unconfirm" = "change",
): Map<string, string> {
  const out = new Map<string, string>();
  if (!before || !after) return out;
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a || a.valid) continue;
    const staleOnlyBefore = !b.valid && b.allocationStale && !a.allocationStale;
    if (!b.valid && !staleOnlyBefore) continue;
    // 확정 해제 — 다시 확정하기 전까지 이월이 무효다(배분·이월을 고칠 일이 아니라 다시 확정할 일 — 2026-11-09).
    if (cause === "unconfirm") {
      out.set(id, `${lineName(a)}: 확정을 해제해 ${month(a.toPeriod)}로 넘긴 ${won(a.amount)} 이월이 다시 확정할 때까지 무효입니다(${month(a.toPeriod)} 실납에서 빠짐) — 다시 확정하면 유효해집니다(수납 배분이 재확인으로 남으면 배분도 다시 저장 · 확정액이 커지면 이월을 고쳐야 합니다).`);
      continue;
    }
    if (staleOnlyBefore) {
      out.set(id, `${lineName(a)}: 수납 배분을 다시 저장했지만 ${month(a.toPeriod)}로 넘긴 ${won(a.amount)} 이월이 여전히 무효입니다(확정액보다 더 받은 몫이 모자람 · ${month(a.toPeriod)} 실납에서 빠짐) — 이월을 고치거나 취소하고, 다음 달 회차 확정을 확인해 주세요.`);
      continue;
    }
    // 배분이 재확인 상태가 되어 무효가 된 것이면 고칠 것은 이월이 아니라 배분이다(배분을 다시 저장하면 저절로 다시 유효해진다 — 적대 리뷰 2026-11-09).
    out.set(id, a.allocationStale
      ? `${lineName(a)}: 수납 배분이 재확인 상태가 되어 ${month(a.toPeriod)}로 넘긴 ${won(a.amount)} 이월이 잠시 무효입니다(${month(a.toPeriod)} 실납에서 빠짐) — 이 달 수납 배분을 먼저 다시 저장해 주세요. 그래도 '이월 재확인'이면 이월을 고치거나 취소하세요.`
      : `${lineName(a)}: 확정·배분이 바뀌어 ${month(a.toPeriod)}로 넘긴 ${won(a.amount)} 이월이 무효가 되었습니다 — ${month(a.toPeriod)} 실납에서도 빠졌습니다. 이월을 고치거나 취소하고, 다음 달 회차 확정을 확인해 주세요.`);
  }
  return out;
}

/** 저장 뒤 상태를 읽어 경고를 만든다 — 저장 전에 유효했거나 배분 재확인 때문에만 무효였던 보낸 이월만 다시 읽는다(대부분 0건이라 조회 없음). */
export async function carryBreaksAfter(db: Db, before: ReadonlyMap<string, CarryOutState> | null, cause: "change" | "unconfirm" = "change"): Promise<Map<string, string>> {
  // 유효했던 줄 + 배분 재확인 때문에만 무효였던 줄(이번 저장으로 재확인이 풀렸는데도 무효면 알린다).
  const ids = before ? [...before].filter(([, s]) => s.valid || s.allocationStale).map(([id]) => id) : [];
  if (ids.length === 0) return new Map();
  return carryOutBreakWarnings(before, await loadCarryOutStates(db, ids), cause);
}

/** 낮춘 시수 되돌리기의 결과 — 시수·배분 모두 원래대로 · 시수만 되돌림(배분 재확인) · 되돌리지 못함(낮춘 시수로 남음). */
export type CarryRevertResult = "reverted" | "reverted_needs_allocation" | "stuck";

/**
 * 받은 이월을 다음 달로 넘기며 **확정 시수를 낮춘다**(이월 창 — 순수 모듈 `planCarryUnreflect` 🔑, 원장 2026-11-09).
 * 자동 맞춤(`raiseRows`)과 같은 길: 낮춘 뒤 그 청구서의 배분이 자동으로 다시 확정될 때만 · 읽은 값 그대로일 때만 저장 · 재확정에 실패하면
 * 되돌린다. 성공하면 `revert`(이월 저장이 실패했을 때 되돌리기 — `reverted` 시수·배분 모두 원래대로 · `reverted_needs_allocation`
 * 시수는 되돌렸지만 배분 재확정 실패 · `stuck` 시수를 되돌리지 못함)를 돌려준다.
 * 실패는 한글 사유 — 되돌리지 못해 낮춘 시수로 남았으면 `stuck`(사람이 회차 확정에서 확인해야 한다 · 숨기지 않는다).
 */
export async function lowerConfirmedForCarry(
  db: Db,
  row: SessionTermRow,
  next: { sessions: number; amount: number },
  userId: string,
): Promise<{ ok: true; revert: () => Promise<CarryRevertResult> } | { ok: false; error: string; stuck?: true }> {
  const busy = "확정 시수를 낮추지 못했습니다 — 그 사이 회차 확정이 바뀌었을 수 있습니다. 창을 다시 열어 확인해 주세요";
  if (!row.invoiceId || !UUID.test(row.id) || row.confirmedSessions == null || row.amount == null) return { ok: false, error: busy };
  try {
    const [autos, holder] = await Promise.all([
      loadAutoInvoices(db, [row.invoiceId]),
      db.from("invoice_session_terms").select("confirmed_by").eq("id", row.id).maybeSingle(),
    ]);
    const entry = autos.get(row.invoiceId);
    const hypothetical = entry?.terms.map((t) => (t.id === row.id ? { ...t, confirmed_sessions: next.sessions, amount: next.amount } : t));
    if (!entry?.inv || !hypothetical || planAutoReallocation(entry.inv, hypothetical).kind !== "save") {
      return { ok: false, error: "이 청구서는 확정 시수를 낮춘 뒤 수납 배분을 자동으로 다시 맞출 수 없습니다 — 회차 확정에서 시수를 낮추고 배분을 저장한 뒤 더 받은 몫을 넘겨 주세요" };
    }
    const now = new Date().toISOString();
    const { data, error } = await db.from("invoice_session_terms")
      .update({ confirmed_sessions: next.sessions, amount: next.amount, confirmed_by: userId, confirmed_at: now })
      .eq("id", row.id).eq("confirmed_sessions", row.confirmedSessions).eq("amount", row.amount).eq("unit_price", row.unitPrice as number)
      .select("id").maybeSingle();
    if (error) logDbError(error, "billing.session-terms.carryUnreflect.update", { termId: row.id });
    if (error || !data) return { ok: false, error: busy };
    const before = { confirmed_sessions: row.confirmedSessions, amount: row.amount, confirmed_by: (holder.data as { confirmed_by: string | null } | null)?.confirmed_by ?? null, confirmed_at: row.confirmedAt };
    // 되돌리기 — 낮춘 값 그대로일 때만(0행 = 그 사이 누가 고침 → 되돌리지 못함) · 되돌린 뒤 배분도 다시 맞춰야 끝이다.
    const revert = async (): Promise<CarryRevertResult> => {
      const { data: back, error: revertError } = await db.from("invoice_session_terms").update(before)
        .eq("id", row.id).eq("confirmed_sessions", next.sessions).eq("amount", next.amount).select("id").maybeSingle();
      if (revertError) logDbError(revertError, "billing.session-terms.carryUnreflect.revert", { termId: row.id });
      if (revertError || !back) return "stuck";
      return (await autoReallocateAfterConfirm(db, [row.id], "carry_unreflect_revert")).saved > 0 ? "reverted" : "reverted_needs_allocation";
    };
    const realloc = await autoReallocateAfterConfirm(db, [row.id], "carry_unreflect");
    if (realloc.saved === 0) {
      const back = await revert();
      if (back === "reverted") return { ok: false, error: "확정 시수를 낮춘 뒤 수납 배분을 다시 맞추지 못해 되돌렸습니다. 잠시 뒤 다시 시도해 주세요" };
      if (back === "reverted_needs_allocation") return { ok: false, error: `확정 시수는 ${row.confirmedSessions}(으)로 되돌렸지만 수납 배분을 다시 맞추지 못했습니다 — 회차 확정에서 배분을 다시 저장해 주세요` };
      return { ok: false, stuck: true, error: `확정 시수를 ${next.sessions}(으)로 낮춘 뒤 수납 배분을 다시 맞추지 못했고 되돌리지도 못했습니다 — 회차 확정에서 확정 시수를 확인하고 배분을 다시 저장해 주세요` };
    }
    return { ok: true, revert };
  } catch (error) {
    logDbError(error, "billing.session-terms.carryUnreflect", { termId: row.id });
    return { ok: false, error: busy };
  }
}

type Planned = { row: SessionTermRow; plan: Extract<ReturnType<typeof planCarrySessionSync>, { kind: "adjust" }>; invoiceId: string };

/**
 * 줄들을 판정해 올린다 — 더 받은 몫이 지금 실린 받은 이월 합계와 같은 줄만.
 * `added` = 이월을 방금 저장한 계기에서 **그 반에 늘어난 몫**(이미 한 번 올린 줄에 이월이 더 실린 경우를 잡는다).
 */
async function raiseRows(
  db: Db,
  rows: readonly SessionTermRow[],
  input: { period: string; userId: string; trigger: string; added?: { classId: string; amount: number } | null },
): Promise<CarrySyncChange[]> {
  const planned = rows.flatMap<Planned>((row) => {
    const plan = planCarrySessionSync(row, input.added && row.classId === input.added.classId ? input.added.amount : 0);
    return plan.kind === "adjust" && row.invoiceId ? [{ row, plan, invoiceId: row.invoiceId }] : [];
  });
  if (planned.length === 0) return [];

  // 고친 뒤 그 청구서의 배분이 자동으로 다시 확정되는가 — 안 되면 그 청구서의 줄은 손대지 않는다.
  const [autos, holders] = await Promise.all([
    loadAutoInvoices(db, [...new Set(planned.map((p) => p.invoiceId))]),
    fetchInChunks<{ id: string; confirmed_by: string | null }>(planned.map((p) => p.row.id), (chunk) =>
      db.from("invoice_session_terms").select("id, confirmed_by").in("id", chunk)),
  ]);
  const confirmedBy = new Map(holders.map((h) => [h.id, h.confirmed_by]));
  const byInvoice = new Map<string, Planned[]>();
  for (const p of planned) (byInvoice.get(p.invoiceId) ?? byInvoice.set(p.invoiceId, []).get(p.invoiceId)!).push(p);

  const now = new Date().toISOString();
  const changes: CarrySyncChange[] = [];
  for (const [invoiceId, list] of byInvoice) {
    const entry = autos.get(invoiceId);
    if (!entry?.inv) continue;
    const mine = new Map(list.map((x) => [x.row.id, x.plan]));
    const hypothetical = entry.terms.map((t) => {
      const change = mine.get(t.id);
      return change ? { ...t, confirmed_sessions: change.sessions, amount: change.amount } : t;
    });
    if (planAutoReallocation(entry.inv, hypothetical).kind !== "save") continue;

    const saved: Planned[] = [];
    for (const p of list) {
      // 읽은 뒤 누가 이 줄을 고쳤으면(확정 해제·다시 확정) 아무것도 하지 않는다 — 읽은 값 그대로일 때만.
      const { data, error } = await db.from("invoice_session_terms")
        .update({ confirmed_sessions: p.plan.sessions, amount: p.plan.amount, confirmed_by: input.userId, confirmed_at: now })
        .eq("id", p.row.id).eq("confirmed_sessions", p.row.confirmedSessions as number).eq("amount", p.row.amount as number).eq("unit_price", p.row.unitPrice as number)
        .select("id").maybeSingle();
      if (error) logDbError(error, "billing.session-terms.carrySync.update", { termId: p.row.id, trigger: input.trigger });
      else if (data) saved.push(p);
    }
    if (saved.length === 0) continue;

    // 배분을 다시 확정한다. 못 했으면(그 사이 다른 저장과 겹침) 고친 값을 되돌린다 — 이월이 안 실린 '재확인' 줄로 남기지 않는다.
    const realloc = await autoReallocateAfterConfirm(db, saved.map((p) => p.row.id), `carry_sync:${input.trigger}`);
    // 되돌리지도 못한 줄 — 올린 값 + '배분 재확인'으로 남는다. 숨기지 않고 고친 줄로 알린다(사람이 배분을 다시 저장해야 한다).
    const stuck = new Set<string>();
    let kept = saved;
    if (realloc.saved === 0) {
      for (const p of saved) {
        const { error } = await db.from("invoice_session_terms")
          .update({ confirmed_sessions: p.row.confirmedSessions, amount: p.row.amount, confirmed_by: confirmedBy.get(p.row.id) ?? null, confirmed_at: p.row.confirmedAt })
          .eq("id", p.row.id).eq("confirmed_sessions", p.plan.sessions).eq("amount", p.plan.amount);
        if (error) {
          logDbError(error, "billing.session-terms.carrySync.revert", { termId: p.row.id, trigger: input.trigger });
          stuck.add(p.row.id);
        }
      }
      kept = saved.filter((p) => stuck.has(p.row.id));
    }
    for (const { row, plan } of kept) {
      changes.push({
        termId: row.id, period: input.period, studentName: row.studentName, className: row.className,
        sessionsBefore: row.confirmedSessions as number, sessions: plan.sessions, amountBefore: row.amount as number, amount: plan.amount,
        unitPrice: row.unitPrice as number, confirmedAt: now, byAmount: plan.byAmount, ...(stuck.has(row.id) ? { needsAllocation: true as const } : {}),
      });
      after(() => logAction({
        action: "session_term_carry_sync",
        targetType: "invoice_session_term",
        targetLabel: `${input.period} ${row.studentName} 확정 시수 자동 조정`,
        metadata: {
          termId: row.id, invoiceId: row.invoiceId, studentId: row.studentId, studentName: row.studentName, classId: row.classId, period: input.period,
          sessionsBefore: row.confirmedSessions, sessions: plan.sessions, amountBefore: row.amount, amount: plan.amount, unitPrice: row.unitPrice,
          carryAmount: plan.byAmount, trigger: input.trigger, ...(stuck.has(row.id) ? { needsAllocation: true } : {}),
        },
      }));
    }
  }
  return changes;
}

/** 이월 한 건의 받는 쪽 — 받을 반과 금액(없으면 null = 이월 없음). */
export type CarryTarget = { classId: string | null; amount: number } | null;

/**
 * 이월을 저장·취소한 직후 — 받는 달 그 학생의 줄을 본다.
 * · 이월이 실려 더 받게 된 줄은 확정 시수를 올린다.
 * · 이월이 빠지거나 줄어든 반(`previous`)의 줄이 덜 받게 됐으면 **알리기만** 한다(자동으로 내리지 않는다).
 */
export async function syncCarrySessionsAfterCarry(
  db: Db,
  input: { period: string; studentId: string; previous: CarryTarget; next: CarryTarget },
  userId: string,
): Promise<{ changes: CarrySyncChange[]; shorts: CarrySyncShort[]; broken?: CarryChainBreak[] }> {
  try {
    const invoiceIds = await liveInvoiceIds(db, input.period, input.studentId);
    if (invoiceIds.length === 0) return { changes: [], shorts: [] };
    const rows = await studentRows(db, input.period, invoiceIds, input.studentId);
    if (!rows) return { changes: [], shorts: [] };
    const prev = input.previous;
    const next = input.next;
    // 이번 저장으로 받을 반에 **늘어난 몫** — 같은 반으로 가던 옛 이월이 있으면 그 차이만.
    const addedAmount = next?.classId ? next.amount - (prev && prev.classId === next.classId ? prev.amount : 0) : 0;
    const changes = await raiseRows(db, rows, {
      period: input.period, userId, trigger: "carry",
      added: next?.classId && addedAmount > 0 ? { classId: next.classId, amount: addedAmount } : null,
    });
    // 옛 반에서 **빠진 몫** — 받을 반이 없던 옛 이월(실린 적이 없다)은 알릴 줄이 없다.
    const lostAmount = prev?.classId ? prev.amount - (next && next.classId === prev.classId ? next.amount : 0) : 0;
    const shorts = lostAmount > 0
      ? rows.flatMap<CarrySyncShort>((row) => {
          // 🔴 부족분이 빠진 이월보다 크면 이월 탓만이 아니다(원래 덜 받던 줄) — 이월이 빠져 생긴 부족만 알린다.
          const short = row.classId === prev!.classId ? carryShortfall(row) : 0;
          const shortBy = short > 0 && short <= lostAmount ? short : 0;
          return shortBy > 0
            ? [{ termId: row.id, period: input.period, studentName: row.studentName, className: row.className, sessions: row.confirmedSessions as number, amount: row.amount as number, shortBy }]
            : [];
        })
      : [];
    // 연쇄 이월: 덜 받게 된 줄이 다음 달로 넘긴 이월이 무효가 됐으면 알린다 — 그 다음 달 실납까지 바뀐다(적대 리뷰 2026-11-09).
    // 🔴 이번 저장 **전에도** 무효였던 이월(이미 '이월 재확인')은 이 저장 탓이 아니다 — 빠진 몫을 되돌린 줄로는 유효했던 것만 알린다.
    const broken = lostAmount > 0
      ? rows.flatMap<CarryChainBreak>((row) => {
          const out = row.carryOut;
          if (row.classId !== prev!.classId || !out || !(out.amount > 0) || carryOutValid(row, out.amount)) return [];
          const before = { ...row, carryIns: [...(row.carryIns ?? []), { amount: lostAmount, fromPeriod: "", fromClassName: null, note: null, valid: true }] };
          return carryOutValid(before, out.amount)
            ? [{ period: input.period, toPeriod: out.toPeriod, studentName: row.studentName, className: row.className, amount: out.amount }]
            : [];
        })
      : [];
    return { changes, shorts, ...(broken.length > 0 ? { broken } : {}) };
  } catch (error) {
    logDbError(error, "billing.session-terms.carrySync.afterCarry", { period: input.period });
    return { changes: [], shorts: [] };
  }
}

/**
 * 확정·배분 저장 직후 — 그 줄들의 청구서 학생 가운데 **받은 이월이 있는 학생만** 본다(없으면 조회 두 번으로 끝).
 * `ref` = 방금 확정한 회차 행들(`termIds`) 또는 방금 배분을 저장한 청구서(`invoiceId`).
 */
export async function syncCarrySessionsAfter(db: Db, ref: { termIds: readonly string[] } | { invoiceId: string }, userId: string, trigger: string): Promise<CarrySyncChange[]> {
  const changes: CarrySyncChange[] = [];
  try {
    type Inv = { id: string; period: string; student_id: string; status: string | null };
    let touched: Inv[];
    if ("invoiceId" in ref) {
      if (!UUID.test(ref.invoiceId)) return [];
      const { data, error } = await db.from("invoices").select("id, period, student_id, status").eq("id", ref.invoiceId).maybeSingle();
      if (error) throw error;
      touched = data ? [data as Inv] : [];
    } else {
      const ids = [...new Set(ref.termIds)].filter((id) => UUID.test(id));
      if (!ids.length) return [];
      const own = await fetchInChunks<{ invoice: Embed<Inv> }>(ids, (chunk) =>
        db.from("invoice_session_terms").select("invoice:invoice_id ( id, period, student_id, status )").in("id", chunk));
      touched = [...new Map(own.flatMap((r) => { const inv = one(r.invoice); return inv ? [[inv.id, inv] as const] : []; })).values()];
    }
    touched = touched.filter((i) => i.status !== "void");
    for (const period of new Set(touched.map((i) => i.period))) {
      const students = new Set(touched.filter((i) => i.period === period).map((i) => i.student_id));
      const ins = await loadMoneyCarryIns(db, period, students);
      if (ins.failed || ins.map.size === 0) continue;
      const withCarry = new Set([...ins.map.keys()].map((key) => key.slice(0, key.indexOf("|")))); // monthRosterKey = `학생|반`
      for (const studentId of withCarry) {
        if (!students.has(studentId)) continue;
        // 한 학생의 실패가 앞 학생의 고친 줄(이미 저장·기록됨)을 응답에서 지우지 않게 학생 단위로 가둔다.
        try {
          const invoiceIds = await liveInvoiceIds(db, period, studentId);
          if (invoiceIds.length === 0) continue;
          const rows = await studentRows(db, period, invoiceIds, studentId);
          if (rows) changes.push(...await raiseRows(db, rows, { period, userId, trigger }));
        } catch (error) {
          logDbError(error, "billing.session-terms.carrySync.after.student", { trigger, period });
        }
      }
    }
  } catch (error) {
    logDbError(error, "billing.session-terms.carrySync.after", { trigger });
  }
  return changes;
}
