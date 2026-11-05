"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { getSessionTermsView } from "./queries";
import { loadMonthRoster } from "./month-roster";
import { loadMoneyCarryOuts } from "./money-carryover-queries";
import { carrySurplus, validateMoneyCarry, type MoneyCarryOut } from "../money-carryover";
import { isVirtualTermId } from "../month-roster";
import { carryShortNotice, carrySyncNotice, syncCarrySessionsAfterCarry } from "./carry-session-sync";

// 금액 이월 저장·취소(0278a) — 원장 2026-09-21 *"만원 남은걸 다음달로 금액 넘기는 기능 … '이월' 기능 추가"*.
// 🔴 게이트는 화면이 아니라 여기서 다시 본다(#77): 유효 배분(`getSessionTermsView` 한 벌)으로 더 받은 몫을 다시 구하고,
//    받을 반은 그 학생의 **다음 달 줄 집합**(`loadMonthRoster` — 출석부·회차 확정과 같은 규칙)에서만 받는다.

export type MoneyCarryOptions = {
  termId: string;
  studentName: string;
  className: string | null;
  period: string;
  nextPeriod: string;
  /** 유효 배분액(수납 배분 원본) · 확정액 · 더 받은 몫(이월 최대). */
  allocatedAmount: number | null;
  amount: number | null;
  surplus: number;
  current: MoneyCarryOut | null;
  classes: { classId: string; className: string }[];
};

type Context = MoneyCarryOptions & { invoiceId: string; studentId: string; classId: string | null };

const UNAVAILABLE = "금액 이월 기능이 아직 켜지지 않았습니다. 관리자에게 알려 주세요(SQL 적용 필요)";

async function loadContext(termId: string): Promise<{ data?: Context; error?: string }> {
  if (typeof termId !== "string" || !termId || isVirtualTermId(termId)) return { error: "회차 행이 있는 반만 이월할 수 있습니다" };
  const db = await createClient();
  const { data: term, error } = await db.from("invoice_session_terms")
    .select("id, invoice_id, class_id, invoice:invoice_id ( period, student_id, status )").eq("id", termId).maybeSingle();
  if (error) {
    console.error("[money-carryover] 회차 행 조회 실패", error.message);
    return { error: "회차 행을 불러오지 못했습니다. 다시 시도해 주세요" };
  }
  const inv = term ? (Array.isArray(term.invoice) ? term.invoice[0] : term.invoice) as { period: string; student_id: string; status: string | null } | null : null;
  if (!term || !inv || inv.status === "void") return { error: "회차 행을 찾을 수 없습니다" };
  const nextPeriod = shiftMonth(inv.period, 1);
  const [view, carryOuts, roster] = await Promise.all([
    getSessionTermsView(inv.period, term.invoice_id),
    loadMoneyCarryOuts(db, inv.period, [term.invoice_id]),
    loadMonthRoster(db, nextPeriod, { studentIds: [inv.student_id] }),
  ]);
  const row = view.rows.find((r) => r.id === termId);
  if (!row) return { error: "회차 행을 찾을 수 없습니다" };
  const classes = roster.pairs
    .filter((p) => p.studentId === inv.student_id)
    .map((p) => ({ classId: p.classId, className: roster.classes.get(p.classId)?.className ?? "—" }))
    .sort((a, b) => a.className.localeCompare(b.className, "ko"));
  return { data: {
    termId, invoiceId: term.invoice_id, studentId: inv.student_id, classId: term.class_id,
    studentName: row.studentName, className: row.className, period: inv.period, nextPeriod,
    allocatedAmount: row.allocatedAmount ?? null, amount: row.amount, surplus: carrySurplus(row),
    current: carryOuts.map.get(termId) ?? null, classes,
  } };
}

export async function getMoneyCarryoverOptions(termId: string): Promise<{ data?: MoneyCarryOptions; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const ctx = await loadContext(termId);
  if (!ctx.data) return { error: ctx.error };
  const c = ctx.data;
  return { data: {
    termId: c.termId, studentName: c.studentName, className: c.className, period: c.period, nextPeriod: c.nextPeriod,
    allocatedAmount: c.allocatedAmount, amount: c.amount, surplus: c.surplus, current: c.current, classes: c.classes,
  } };
}

/** `amount: 0` = 이월 취소. `expectedAllocation` = 창을 열 때 본 배분액(그 사이 배분이 바뀌면 거절). */
export async function saveMoneyCarryover(input: { termId: string; amount: number; classId: string | null; note: string | null; expectedAllocation: number | null }): Promise<{ ok?: true; error?: string; warning?: string; notice?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const ctx = await loadContext(input?.termId);
  if (!ctx.data) return { error: ctx.error };
  const c = ctx.data;
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  const amount = Number(input.amount);
  const checked = validateMoneyCarry({ amount, classId: input.classId ?? null, note }, { surplus: c.surplus, classIds: c.classes.map((x) => x.classId) });
  if (!checked.ok) return { error: checked.error };
  if (amount === 0 && !c.current) return { error: "취소할 이월이 없습니다" };
  if (amount > 0 && input.expectedAllocation !== c.allocatedAmount) return { error: "배분 금액이 바뀌었습니다. 창을 다시 열어 확인해 주세요" };
  const db = await createClient();
  const { error } = await db.rpc("save_session_term_money_carryover", {
    p_term_id: c.termId, p_amount: amount, p_class_id: amount > 0 ? input.classId : null, p_note: note, p_expected_allocation: c.allocatedAmount,
  });
  if (error) {
    // 함수가 없다(0278a 미적용 · 적용 직후 스키마 캐시 전) — 원인을 단정할 수 있는 코드만 안내로 바꾼다.
    if (error.code === "PGRST202" || error.code === "42883" || error.code === "42703") return { error: UNAVAILABLE };
    // RPC가 raise한 한글 문구(P0001)는 그대로, 그 밖(형식 오류·시간 초과 등)은 원문을 화면에 내지 않는다.
    if (error.code === "P0001" && /[가-힣]/.test(error.message)) return { error: error.message };
    console.error("[money-carryover] 이월 저장 실패", error.code, error.message);
    return { error: "이월을 저장하지 못했습니다. 다시 시도해 주세요" };
  }
  const toClass = c.classes.find((x) => x.classId === input.classId);
  await logAction({
    action: amount > 0 ? "session_term_money_carryover" : "session_term_money_carryover_cancel",
    targetType: "invoice_session_term",
    targetLabel: `${c.period} ${c.studentName} 금액 이월`,
    metadata: {
      termId: c.termId,
      invoiceId: c.invoiceId,
      studentId: c.studentId,
      studentName: c.studentName,
      period: c.period,
      toPeriod: c.nextPeriod,
      fromClassId: c.classId,
      fromClassName: c.className,
      amount,
      toClassId: amount > 0 ? input.classId : null,
      toClassName: amount > 0 ? toClass?.className ?? null : null,
      amountBefore: c.current?.amount ?? 0,
      toClassNameBefore: c.current?.toClassName ?? null,
      allocatedAmount: c.allocatedAmount,
      confirmedAmount: c.amount,
      note,
    },
  });
  // 받는 달 줄의 확정 시수를 이월만큼 **올린다**(원장 2026-10-07) — 사람이 '해제 → 시수 고침 → 다시 확정'하던 일. 못 올리면(배분 전·잔돈·
  // 여럿이 나누는 항목) 그대로 둔다. 이월을 취소·줄여 덜 받게 된 줄은 자동으로 내리지 않고 알리기만 한다(`shortNotice`).
  const synced = await syncCarrySessionsAfterCarry(db, {
    period: c.nextPeriod, studentId: c.studentId,
    previous: c.current ? { classId: c.current.toClassId, amount: c.current.amount } : null,
    next: amount > 0 ? { classId: input.classId, amount } : null,
  }, user.id);
  const notice = carrySyncNotice(synced.changes);
  const shortNotice = carryShortNotice(synced.shorts);
  revalidatePath("/billing");
  // 두 달 중 이미 **분배를 저장한** 달이 있으면 그 저장본이 낡았다 — 다시 저장하라고 알린다(적대 리뷰 2026-09-21).
  // 달마다 따로 센다(한 번에 limit로 읽으면 한 달 행만으로 채워져 다른 달이 빠진다). 조회가 실패하면 모른다고 알린다.
  const counts = await Promise.all([c.period, c.nextPeriod].map(async (p) => {
    const { count, error: countError } = await db.from("invoice_teacher_splits").select("*", { count: "exact", head: true }).eq("period", p);
    return { p, has: countError ? null : (count ?? 0) > 0 };
  }));
  // 이월이 빠져 덜 받게 된 줄 안내를 분배 경고 앞에 붙인다(둘 다 사람이 손봐야 하는 일이라 한 창으로).
  const withShort = (text: string | undefined) => [shortNotice, text].filter(Boolean).join("\n\n") || undefined;
  if (counts.some((x) => x.has === null)) return { ok: true, ...(notice ? { notice } : {}), warning: withShort("강사 분배 저장본을 확인하지 못했습니다 — 두 달 분배를 저장해 두었다면 회차 확정의 ‘청구 시수 대조’에서 다시 저장해 주세요.") };
  const stale = counts.filter((x) => x.has).map((x) => x.p);
  const warning = withShort(stale.length
    ? `${stale.map((p) => `${Number(p.slice(5, 7))}월`).join("·")} 강사 분배를 이미 저장해 두었습니다 — 회차 확정의 ‘청구 시수 대조’에서 분배를 다시 저장해 주세요.`
    : undefined);
  return { ok: true, ...(notice ? { notice } : {}), ...(warning ? { warning } : {}) };
}
