"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { loadMonthRoster } from "./month-roster";
import { carrySurplus, receivedCarry, validateMoneyCarry, type MoneyCarryOut } from "../money-carryover";
import { isVirtualTermId } from "../month-roster";
import { getSessionTermsView } from "./queries";
import { loadMoneyCarryOuts } from "./money-carryover-queries";
import { carryChainBreakNotice, carryShortNotice, carrySyncNotice, loadStudentCarryRows, lowerConfirmedForCarry, syncCarrySessionsAfterCarry } from "./carry-session-sync";
import { carryUnreflectable, planCarryUnreflect } from "../carry-session-sync";
import type { SessionTermRow } from "./queries";

// 금액 이월 저장·취소(0278a) — 원장 2026-09-21 *"만원 남은걸 다음달로 금액 넘기는 기능 … '이월' 기능 추가"*.
// 🔴 게이트는 화면이 아니라 여기서 다시 본다(#77): 유효 배분 + 받은 이월(`loadStudentCarryRows` — 화면과 같은 줄·같은 붙이기)로
//    더 받은 몫을 다시 구하고,
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
  /** 이 줄 실납에 실린 **받은 이월**(지난 달에서) — 더 받은 몫에 든다(연쇄 이월, 원장 2026-11-09). 없으면 0. */
  carriedIn: number;
  /**
   * 더 받은 몫을 넘어 **확정 시수를 낮춰** 더 넘길 수 있는 금액(확정 시수에 반영된 받은 이월 · 0.5시수 단위) — `carryUnreflectable`.
   * 창은 넘길 금액이 더 받은 몫을 넘으면 "확정 시수 27 → 26"을 미리 보인다(그 계산 재료가 `confirmedSessions`·`unitPrice`).
   */
  unreflectable: number;
  confirmedSessions: number | null;
  unitPrice: number | null;
  /**
   * 그 줄의 **출석부 실제 시수**('청구 시수 대조'와 같은 DB 함수 `session_term_attendance`) — 시수를 낮춰 넘길 몫이 있을 때만 읽는다.
   * 낮춘 시수가 이보다 작으면 이미 한 수업의 수업료가 다음 달로 넘어간다(그 달 강사 실급여 상한이 준다) — 창이 확인을 받는다. 못 읽으면 null.
   */
  actualSessions: number | null;
  /** 앞 달 이월 정보를 못 읽어 그 줄만 본 창 — 더 받은 몫을 모르니 새 이월은 막고 넘겨 둔 이월 취소만 받는다. */
  degraded?: boolean;
  current: MoneyCarryOut | null;
  classes: { classId: string; className: string }[];
};

/** 서버 안에서만 쓰는 맥락 — `row`(그 줄 전체)는 창으로 보내지 않는다. */
type Context = MoneyCarryOptions & { invoiceId: string; studentId: string; classId: string | null; row: SessionTermRow };

const UNAVAILABLE = "금액 이월 기능이 아직 켜지지 않았습니다. 관리자에게 알려 주세요(SQL 적용 필요)";

/** 그 줄의 출석부 실제 시수 — '청구 시수 대조'와 같은 DB 함수를 그 줄로 걸러 읽는다. 실패하면 null(창이 '확인하지 못함'으로 확인을 받는다). */
async function attendedUnits(db: Awaited<ReturnType<typeof createClient>>, period: string, invoiceId: string, classId: string | null): Promise<number | null> {
  if (!classId) return null;
  try {
    const { data, error } = await db.rpc("session_term_attendance", { p_period: period }).eq("invoice_id", invoiceId).eq("class_id", classId);
    if (error) {
      console.error("[money-carryover] 출석부 시수 조회 실패", error.code, error.message);
      return null;
    }
    const rows = (data ?? []) as { consumed: number | string | null }[];
    return rows.reduce((sum, r) => sum + (Number(r.consumed) || 0), 0);
  } catch (e) {
    console.error("[money-carryover] 출석부 시수 조회 실패", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * `allowDegraded` = 창 열기·이월 취소(0원) — 더 받은 몫이 필요 없는 일이라, 이월 조회가 실패해도 그 줄의 보낸 이월만 확인하고 진행한다
 * (`degraded` — 더 받은 몫 0 · 새 이월은 저장에서 다시 막힌다).
 */
async function loadContext(termId: string, allowDegraded = false): Promise<{ data?: Context; error?: string }> {
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
  // 그 학생의 이 달 줄 전부 + 보낸·받은 이월 — 회차 확정 화면과 **같은 붙이기**(`attachMoneyCarry`)라 더 받은 몫이 화면과 같다.
  // 🔴 배분 창 모드(`getSessionTermsView(period, invoiceId)`)만 읽으면 받은 이월이 안 붙어 연쇄 이월의 더 받은 몫이 0원으로 거절된다.
  let rows: Awaited<ReturnType<typeof loadStudentCarryRows>>;
  let roster: Awaited<ReturnType<typeof loadMonthRoster>>;
  try {
    [rows, roster] = await Promise.all([
      loadStudentCarryRows(db, inv.period, inv.student_id),
      loadMonthRoster(db, nextPeriod, { studentIds: [inv.student_id] }),
    ]);
  } catch (e) {
    console.error("[money-carryover] 이월 정보 조회 실패", e instanceof Error ? e.message : String(e));
    return { error: "이월 정보를 불러오지 못했습니다. 다시 시도해 주세요" };
  }
  const degraded = !rows && allowDegraded;
  if (degraded) {
    // 취소는 '재확인·받을 반 없음' 이월을 푸는 길이다 — 앞 달 이월 조회 실패 같은 무관한 실패에 막히지 않게 그 줄만 본다(적대 리뷰 2026-11-09).
    try {
      const [view, outs] = await Promise.all([getSessionTermsView(inv.period, term.invoice_id), loadMoneyCarryOuts(db, inv.period, [term.invoice_id])]);
      const own = view.rows.find((r) => r.id === termId);
      if (own && !outs.failed) rows = [{ ...own, carryOut: outs.map.get(termId) ?? null }];
    } catch (e) {
      console.error("[money-carryover] 취소용 회차 행 조회 실패", e instanceof Error ? e.message : String(e));
    }
  }
  if (!rows) return { error: "이월 정보를 불러오지 못했습니다. 다시 시도해 주세요" };
  const row = rows.find((r) => r.id === termId);
  if (!row) return { error: "회차 행을 찾을 수 없습니다" };
  const classes = roster.pairs
    .filter((p) => p.studentId === inv.student_id)
    .map((p) => ({ classId: p.classId, className: roster.classes.get(p.classId)?.className ?? "—" }))
    .sort((a, b) => a.className.localeCompare(b.className, "ko"));
  const unreflectable = degraded ? 0 : carryUnreflectable(row);
  // 시수를 낮춰 넘길 몫이 있을 때만 출석부 실제 시수를 읽는다(그 밖의 창은 왕복 그대로).
  const actualSessions = unreflectable > 0 ? await attendedUnits(db, inv.period, term.invoice_id, term.class_id) : null;
  return { data: {
    termId, invoiceId: term.invoice_id, studentId: inv.student_id, classId: term.class_id,
    studentName: row.studentName, className: row.className, period: inv.period, nextPeriod,
    allocatedAmount: row.allocatedAmount ?? null, amount: row.amount,
    surplus: degraded ? 0 : carrySurplus(row), carriedIn: degraded ? 0 : receivedCarry(row), ...(degraded ? { degraded: true } : {}),
    unreflectable, confirmedSessions: row.confirmedSessions, unitPrice: row.unitPrice, actualSessions,
    current: row.carryOut ?? null, classes, row,
  } };
}

export async function getMoneyCarryoverOptions(termId: string): Promise<{ data?: MoneyCarryOptions; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const ctx = await loadContext(termId, true);
  if (!ctx.data) return { error: ctx.error };
  const c = ctx.data;
  return { data: {
    termId: c.termId, studentName: c.studentName, className: c.className, period: c.period, nextPeriod: c.nextPeriod,
    allocatedAmount: c.allocatedAmount, amount: c.amount, surplus: c.surplus, carriedIn: c.carriedIn, ...(c.degraded ? { degraded: true } : {}),
    unreflectable: c.unreflectable, confirmedSessions: c.confirmedSessions, unitPrice: c.unitPrice, actualSessions: c.actualSessions,
    current: c.current, classes: c.classes,
  } };
}

/**
 * `amount: 0` = 이월 취소. `expectedAllocation` = 창을 열 때 본 배분액(그 사이 배분이 바뀌면 거절).
 * `expectedSessions` = 넘길 금액이 더 받은 몫을 넘어 창이 미리 보인 **낮춘 확정 시수**(시수를 낮출 때 필수 · 다르면 거절).
 * `confirmBelowActual` = 낮춘 시수가 출석부 실제 시수보다 작거나 실제 시수를 모를 때 사람이 확인했다는 표시(없으면 거절).
 */
export async function saveMoneyCarryover(input: { termId: string; amount: number; classId: string | null; note: string | null; expectedAllocation: number | null; expectedSessions?: number; confirmBelowActual?: boolean }): Promise<{ ok?: true; error?: string; warning?: string; notice?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const ctx = await loadContext(input?.termId, Number(input?.amount) === 0);
  if (!ctx.data) return { error: ctx.error };
  const c = ctx.data;
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  const amount = Number(input.amount);
  // 상한 = 더 받은 몫 + 확정 시수를 낮춰 넘길 수 있는 몫(받은 이월 다시 넘기기 — 근본 해결 2026-11-09). 넘는 몫은 아래에서 시수를 낮춘다.
  const checked = validateMoneyCarry({ amount, classId: input.classId ?? null, note }, { surplus: c.surplus + c.unreflectable, classIds: c.classes.map((x) => x.classId) });
  if (!checked.ok) return { error: checked.error };
  if (amount === 0 && !c.current) return { error: "취소할 이월이 없습니다" };
  if (amount > 0 && input.expectedAllocation !== c.allocatedAmount) return { error: "배분 금액이 바뀌었습니다. 창을 다시 열어 확인해 주세요" };
  const unreflect = amount > 0 ? planCarryUnreflect(c.row, amount) : { kind: "none" as const };
  if (unreflect.kind === "invalid") return { error: unreflect.error };
  // 창이 미리 보인 낮춘 시수와 지금 계산이 같아야 한다(없거나 다르면 거절 — 그 사이 확정이 바뀌었거나 창이 보여 주지 않은 낮춤).
  if (unreflect.kind === "lower" && input.expectedSessions !== unreflect.sessions) {
    return { error: "확정 시수가 바뀌었습니다. 창을 다시 열어 확인해 주세요" };
  }
  // 출석부 실제 시수보다 낮추면 이미 한 수업의 수업료가 다음 달로 간다 — 사람이 확인한 경우만(모르면 확인을 받는다).
  if (unreflect.kind === "lower" && (c.actualSessions == null || unreflect.sessions < c.actualSessions) && input.confirmBelowActual !== true) {
    return { error: c.actualSessions == null
      ? "출석부 시수를 확인하지 못했습니다 — 창을 다시 열어 확인란에 표시한 뒤 저장해 주세요"
      : `낮춘 확정 시수(${unreflect.sessions})가 출석부 시수(${c.actualSessions})보다 작습니다 — 창을 다시 열어 출석부 시수를 확인하고 확인란에 표시한 뒤 저장해 주세요` };
  }
  const db = await createClient();
  // 받은 이월을 다시 넘기는 몫이 있으면 확정 시수를 먼저 낮춘다(DB 함수 상한이 낮춘 확정액으로 본다) — 이월 저장이 실패하면 되돌린다.
  const lowered = unreflect.kind === "lower" ? await lowerConfirmedForCarry(db, c.row, unreflect, user.id) : null;
  if (lowered && !lowered.ok) {
    // 낮춘 뒤 배분을 못 맞추고 되돌리지도 못했으면(낮춘 시수로 남음) 감사로그에 남긴다 — 숨기지 않는다.
    if (lowered.stuck && unreflect.kind === "lower") await logUnreflect(c, unreflect, amount, { stuck: true, stage: "allocate", revert: "stuck" });
    return { error: lowered.error };
  }
  const { error } = await db.rpc("save_session_term_money_carryover", {
    p_term_id: c.termId, p_amount: amount, p_class_id: amount > 0 ? input.classId : null, p_note: note, p_expected_allocation: c.allocatedAmount,
  });
  // 이월 저장이 실패하면 낮춘 시수를 되돌린다 — 되돌리지 못했으면 숨기지 않는다(안내 + 감사로그 · 사람이 회차 확정에서 고친다).
  const back = error && lowered?.ok ? await lowered.revert() : null;
  if (back === "stuck" || back === "reverted_needs_allocation") {
    console.error("[money-carryover] 이월 저장 실패 뒤 되돌리기 미완", back, error?.code, error?.message);
    if (unreflect.kind === "lower") await logUnreflect(c, unreflect, amount, { stuck: true, stage: "carry", revert: back });
    return { error: back === "stuck"
      ? `이월을 저장하지 못했고 확정 시수가 ${unreflect.kind === "lower" ? unreflect.sessions : "낮춘 값"}(으)로 남았습니다 — 회차 확정에서 확정 시수를 확인하고 배분을 다시 저장해 주세요`
      : `이월을 저장하지 못해 확정 시수는 ${c.confirmedSessions}(으)로 되돌렸지만 수납 배분을 다시 맞추지 못했습니다 — 회차 확정에서 배분을 다시 저장해 주세요` };
  }
  if (error) {
    // 함수가 없다(0278a 미적용 · 적용 직후 스키마 캐시 전) — 원인을 단정할 수 있는 코드만 안내로 바꾼다.
    if (error.code === "PGRST202" || error.code === "42883" || error.code === "42703") return { error: UNAVAILABLE };
    // RPC가 raise한 한글 문구(P0001)는 그대로, 그 밖(형식 오류·시간 초과 등)은 원문을 화면에 내지 않는다.
    if (error.code === "P0001" && /[가-힣]/.test(error.message)) return { error: error.message };
    console.error("[money-carryover] 이월 저장 실패", error.code, error.message);
    return { error: "이월을 저장하지 못했습니다. 다시 시도해 주세요" };
  }
  const toClass = c.classes.find((x) => x.classId === input.classId);
  // 확정 시수를 낮춘 일은 따로 남긴다(확정 변경 이력으로 찾을 수 있게) — 이월 기록에도 근거로 싣는다.
  if (unreflect.kind === "lower") await logUnreflect(c, unreflect, amount, {});
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
      // 상한의 근거 — 받은 이월도 더 받은 몫에 든다(연쇄 이월, 2026-11-09). "왜 배분보다 많이 넘겼나"를 되짚는 재료.
      carriedIn: c.carriedIn,
      surplus: c.surplus,
      // 받은 이월을 다시 넘기며 낮춘 확정 시수(있을 때만) — 사람이 이월 창에서 한 일이다(자동 맞춤 아님).
      ...(unreflect.kind === "lower" ? { sessionsLowered: { from: c.confirmedSessions, to: unreflect.sessions, amountFrom: c.amount, amountTo: unreflect.amount, byAmount: unreflect.byAmount } } : {}),
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
  // 이 달 줄의 확정 시수를 낮췄으면 그것부터 알린다(받는 달 자동 맞춤 안내와 한 줄로).
  const loweredNotice = unreflect.kind === "lower"
    ? `${Number(c.period.slice(5, 7))}월 ${c.studentName}${c.className ? ` ${c.className}` : ""}: 확정 시수 ${c.confirmedSessions} → ${unreflect.sessions}(${Number(c.nextPeriod.slice(5, 7))}월로 ${amount.toLocaleString("ko-KR")}원 넘김 · 그중 시수에 반영됐던 받은 이월 ${unreflect.byAmount.toLocaleString("ko-KR")}원)`
    : undefined;
  const notice = [loweredNotice, carrySyncNotice(synced.changes)].filter(Boolean).join(" · ") || undefined;
  const shortNotice = carryShortNotice(synced.shorts);
  // 연쇄 이월이 끊긴 줄 — 다음 달이 그다음 달로 넘긴 이월이 무효가 되어 그 달 실납도 바뀌었다(적대 리뷰 2026-11-09).
  const broken = synced.broken ?? [];
  const breakNotice = carryChainBreakNotice(broken);
  revalidatePath("/billing");
  // 바뀐 달(이 달 · 다음 달 · 끊긴 이월이 가던 달) 중 이미 **분배를 저장한** 달이 있으면 그 저장본이 낡았다 — 다시 저장하라고 알린다(적대 리뷰 2026-09-21).
  // 달마다 따로 센다(한 번에 limit로 읽으면 한 달 행만으로 채워져 다른 달이 빠진다). 조회가 실패하면 모른다고 알린다.
  const counts = await Promise.all([...new Set([c.period, c.nextPeriod, ...broken.map((b) => b.toPeriod)])].map(async (p) => {
    const { count, error: countError } = await db.from("invoice_teacher_splits").select("*", { count: "exact", head: true }).eq("period", p);
    return { p, has: countError ? null : (count ?? 0) > 0 };
  }));
  // 이월이 빠져 덜 받게 된 줄 안내를 분배 경고 앞에 붙인다(둘 다 사람이 손봐야 하는 일이라 한 창으로).
  const withShort = (text: string | undefined) => [shortNotice, breakNotice, text].filter(Boolean).join("\n\n") || undefined;
  if (counts.some((x) => x.has === null)) return { ok: true, ...(notice ? { notice } : {}), warning: withShort("강사 분배 저장본을 확인하지 못했습니다 — 바뀐 달의 분배를 저장해 두었다면 회차 확정의 ‘청구 시수 대조’에서 다시 저장해 주세요.") };
  const stale = counts.filter((x) => x.has).map((x) => x.p);
  const warning = withShort(stale.length
    ? `${stale.map((p) => `${Number(p.slice(5, 7))}월`).join("·")} 강사 분배를 이미 저장해 두었습니다 — 회차 확정의 ‘청구 시수 대조’에서 분배를 다시 저장해 주세요.`
    : undefined);
  return { ok: true, ...(notice ? { notice } : {}), ...(warning ? { warning } : {}) };
}

/** 확정 시수 낮춤 감사로그(`session_term_carry_unreflect`) — 몇 시수에서 몇 시수로 · 얼마를 어디로 · 출석부 시수. 되돌리지 못했으면 `stuck`. */
async function logUnreflect(
  c: Context,
  plan: { sessions: number; amount: number; byAmount: number },
  carryAmount: number,
  extra: { stuck?: true; stage?: "allocate" | "carry"; revert?: string },
): Promise<void> {
  await logAction({
    action: "session_term_carry_unreflect",
    targetType: "invoice_session_term",
    targetLabel: `${c.period} ${c.studentName} 확정 시수 낮춤`,
    metadata: {
      termId: c.termId, invoiceId: c.invoiceId, studentId: c.studentId, studentName: c.studentName, classId: c.classId, period: c.period,
      sessionsBefore: c.confirmedSessions, sessions: plan.sessions, amountBefore: c.amount, amount: plan.amount, unitPrice: c.unitPrice,
      byAmount: plan.byAmount, carryAmount, toPeriod: c.nextPeriod, actualSessions: c.actualSessions, ...extra,
    },
  });
}
