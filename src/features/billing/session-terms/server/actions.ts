"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { planTermsForMonth, monthRange, type PlanEnrollment } from "../plan";
import { classifyVerification } from "../verification";
import { maxCarryoverOut, maxCarryoverIn, validateCarryover } from "../carryover";
import { isEieMonthlyClass, sessionPricingAmount, type SessionPricingMode } from "@/features/billing/session-pricing";

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export type SessionTermActionState = { error?: string; ok?: boolean; refreshed?: number } | undefined;

/**
 * 계획 N 갱신 — 청구월의 모든 청구서에 대해 (청구서×반) 계획 회차를 재산출해 upsert.
 * ⚠️ N1: confirmed_* 필드는 절대 건드리지 않는다(계획만 갱신). 확정 안 된 stale 행만 삭제.
 * (B2 페이징 / B3 청크 / B4 병렬. 산출은 순수 planTermsForMonth — Vitest.)
 */
export async function refreshPlannedTerms(period: string): Promise<SessionTermActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };

  const supabase = await createClient();
  const [invoices, settings] = await Promise.all([
    fetchAllPaged<{ id: string; student_id: string }>((from, to) =>
      // void(makeedu 삭제분) 제외 — 무효 청구에 회차 계획을 만들지 않는다.
      supabase.from("invoices").select("id, student_id").eq("period", period).neq("status", "void").range(from, to),
    ),
    getTenantSettings(),
  ]);
  if (invoices.length === 0) return { ok: true, refreshed: 0 };

  const { start, end } = monthRange(period)!;
  const studentIds = [...new Set(invoices.map((i) => i.student_id))];

  // 그 달과 겹치는 수강 + 반(과목·활성) — 홀드 제외. 이어서 반들의 요일 스케줄.
  const enrollments = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    class: { subject?: string; is_active?: boolean } | { subject?: string }[] | null;
  }>(studentIds, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, class:class_id!inner ( subject, is_active )")
      .in("student_id", chunk)
      .eq("on_hold", false)
      .eq("class.is_active", true)
      .lte("start_date", end)
      .or(`end_date.is.null,end_date.gte.${start}`),
  );
  const classIds = [...new Set(enrollments.map((e) => e.class_id))];
  const schedules = await fetchInChunks<{ class_id: string; day_of_week: string }>(classIds, (chunk) =>
    supabase
      .from("class_schedules")
      .select("class_id, day_of_week")
      .in("class_id", chunk)
      .lte("valid_from", end)
      .or(`valid_to.is.null,valid_to.gte.${start}`),
  );
  const daysByClass = new Map<string, Set<number>>();
  for (const s of schedules) {
    const d = DOW[s.day_of_week];
    if (d === undefined) continue;
    (daysByClass.get(s.class_id) ?? daysByClass.set(s.class_id, new Set()).get(s.class_id)!).add(d);
  }

  const holidays = mergeHolidays(Number(period.slice(0, 4)), settings.operations.holidays.map((h) => h.date), true);
  const byStudent = new Map<string, PlanEnrollment[]>();
  for (const e of enrollments) {
    const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as { subject?: string } | undefined;
    if (!cls?.subject) continue;
    const list = byStudent.get(e.student_id) ?? byStudent.set(e.student_id, []).get(e.student_id)!;
    list.push({
      classId: e.class_id,
      subject: cls.subject,
      startDate: e.start_date,
      endDate: e.end_date,
      weekdays: [...(daysByClass.get(e.class_id) ?? [])],
    });
  }

  // 기존 term 로드(확정 보존·stale 판단)
  const invoiceIds = invoices.map((i) => i.id);
  const existing = await fetchInChunks<{ id: string; invoice_id: string; class_id: string | null; confirmed_sessions: number | null }>(
    invoiceIds,
    (chunk) =>
      supabase.from("invoice_session_terms").select("id, invoice_id, class_id, confirmed_sessions").in("invoice_id", chunk),
  );

  let refreshed = 0;
  const upserts: Record<string, unknown>[] = [];
  const staleUnconfirmed: string[] = [];
  const plannedKeys = new Set<string>();

  for (const inv of invoices) {
    const planned = planTermsForMonth(period, byStudent.get(inv.student_id) ?? [], holidays);
    for (const p of planned) {
      plannedKeys.add(`${inv.id}|${p.classId}`);
      upserts.push({
        tenant_id: user.tenantId,
        invoice_id: inv.id,
        subject: p.subject,
        class_id: p.classId,
        planned_sessions: p.plannedSessions,
      });
      refreshed++;
    }
  }
  for (const t of existing) {
    if (!plannedKeys.has(`${t.invoice_id}|${t.class_id}`) && t.confirmed_sessions === null) staleUnconfirmed.push(t.id);
  }

  // upsert는 계획 필드만 — onConflict 대상 컬럼 목록에 confirmed_*를 넣지 않아 기존 확정이 보존된다.
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await supabase
      .from("invoice_session_terms")
      .upsert(upserts.slice(i, i + 200), { onConflict: "tenant_id,invoice_id,class_id" });
    if (error) return { error: `계획 저장 실패: ${error.message}` };
  }
  for (let i = 0; i < staleUnconfirmed.length; i += 200) {
    const { error } = await supabase.from("invoice_session_terms").delete().in("id", staleUnconfirmed.slice(i, i + 200));
    if (error) return { error: `정리 실패: ${error.message}` };
  }

  // 한 달 전체를 다시 계산하고 **확정 안 된 stale 행을 지우는** 일이라 한 줄 남긴다(행마다가 아니라 실행 단위).
  // 확정값(confirmed_*)은 건드리지 않으므로 청구 금액은 안 변한다 — 그 사실이 로그에서도 읽히게 removed를 함께.
  await logAction({
    action: "session_terms_refresh",
    targetType: "invoice_session_term",
    targetLabel: `${period} 계획 갱신`,
    metadata: { period, refreshed, removed: staleUnconfirmed.length, invoices: invoices.length },
  });
  revalidatePath("/billing");
  return { ok: true, refreshed };
}

/**
 * 반 일괄 확정 — 한 반의 그 청구월 학생 전원을 **회차 × 같은 회당 단가**로 한 번에 확정.
 * 400+행을 하나씩 확정하는 대신 반 단위로 배정하고, 개인별로 다른 건 confirmSessionTerm으로 보정(2026-07-13 원장).
 * `sessionsOverride`가 있으면 그 회차를 전원에 적용(반 디폴트 회차), 없으면 **각자 계획 N**(월중 등록/퇴원으로
 * 반 안에서도 다를 수 있음 — 그 차이를 존중). 개인은 이후 행별로 회차·단가 모두 바꿀 수 있다.
 */
export async function confirmClassTerms(
  period: string,
  classId: string,
  unitPriceRaw: number,
  sessionsOverride?: number | null,
): Promise<{ error?: string; confirmed?: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };
  if (!classId) return { error: "반이 지정되지 않았습니다" };
  let unitPrice = Math.round(unitPriceRaw);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };
  const override =
    sessionsOverride != null && Number.isFinite(sessionsOverride) ? Math.round(sessionsOverride) : null;
  if (override != null && (override < 0 || override > 99)) return { error: "회차는 0~99 사이여야 합니다" };

  const supabase = await createClient();
  // 이 반의 그 청구월 term만 — invoices inner join으로 period 필터(RLS가 테넌트 격리).
  const { data: cls, error: classError } = await supabase.from("classes")
    .select("subject, english_track").eq("id", classId).maybeSingle();
  if (classError) return { error: classError.message };
  if (!cls) return { error: "반을 찾을 수 없습니다" };
  const pricingMode: SessionPricingMode = isEieMonthlyClass(cls.subject, cls.english_track) ? "monthly" : "per_session";
  if (pricingMode === "monthly") unitPrice = (await getTenantSettings()).billing.eieMonthlyPrice;
  const { data, error } = await supabase
    .from("invoice_session_terms")
    .select("id, planned_sessions, invoice:invoice_id!inner ( period )")
    .eq("class_id", classId)
    .eq("invoice.period", period);
  if (error) return { error: error.message };
  // 회차 지정 시엔 계획 없어도 적용, 미지정 시엔 계획값 필요.
  const targets = (data ?? []).filter((r) => pricingMode === "monthly" || override != null || r.planned_sessions !== null);
  if (targets.length === 0) return { error: "확정할 대상이 없습니다 — 계획 갱신을 먼저 눌러주세요" };

  const now = new Date().toISOString();
  // amount = 회차 × 단가라 회차값마다 다름 → 회차별로 묶어 batch update(반 학생은 소수라 청크 불필요).
  const byN = new Map<number, string[]>();
  for (const r of targets) {
    const n = override != null ? override : (r.planned_sessions as number | null) ?? 0;
    (byN.get(n) ?? byN.set(n, []).get(n)!).push(r.id as string);
  }
  let confirmed = 0;
  for (const [n, ids] of byN) {
    const { error: uerr } = await supabase
      .from("invoice_session_terms")
      .update({
        confirmed_sessions: n,
        unit_price: unitPrice,
        pricing_mode: pricingMode,
        amount: sessionPricingAmount(pricingMode, n, unitPrice),
        confirmed_by: user.id,
        confirmed_at: now,
      })
      .in("id", ids);
    if (uerr) return { error: uerr.message };
    confirmed += ids.length;
  }

  // 🔴 한 번에 반 전체 청구 회차·단가를 못박는 자리 = 돈이 실제로 결정되는 지점. 단가·회차를 남긴다
  //    (`invoice_create`가 amountTotal을 남기는 것과 같은 결 — 금액 없이 "누가 눌렀다"만 남기면
  //     "왜 이 학생 청구가 다른가"에 답할 수 없다). classId는 뷰어가 반 이름으로 풀어 준다.
  await logAction({
    action: "session_term_confirm_class",
    targetType: "invoice_session_term",
    targetLabel: `${period} 반 일괄 확정`,
    metadata: {
      period,
      classId,
      unitPrice,
      pricingMode,
      // 회차를 지정하면 전원 같은 값, 아니면 각자 계획 N(월중 등록·퇴원으로 반 안에서도 다르다).
      sessions: override,
      confirmedCount: confirmed,
    },
  });
  revalidatePath("/billing");
  return { confirmed };
}

/** 회차/월 금액 확정 — 회당은 N×단가, EiE는 설정의 월 금액과 단위를 스냅샷. */
export async function confirmSessionTerm(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const sessions = Number(String(formData.get("sessions") ?? "").trim());
  let unitPrice = Number(String(formData.get("unitPrice") ?? "").replace(/[,\s]/g, ""));
  if (!id) return { error: "대상이 없습니다" };
  if (!Number.isInteger(sessions) || sessions < 0 || sessions > 99)
    return { error: "확정 회차는 0~99 사이 정수여야 합니다" };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };

  const supabase = await createClient();
  // 반·이전 확정값을 함께 읽는다 — classId는 뷰어가 반 이름으로 풀어 주고(감사로그 '대상'), 이전 확정값은
  // "얼마에서 얼마로 고쳤나"의 답이다(행에는 마지막 값만 남는다).
  const { data: before, error: readError } = await supabase
    .from("invoice_session_terms")
    .select("class_id, subject, confirmed_sessions, unit_price, pricing_mode, class:class_id ( english_track )")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!before) return { error: "대상을 찾을 수 없습니다" };
  const cls = Array.isArray(before.class) ? before.class[0] : before.class;
  const pricingMode: SessionPricingMode = isEieMonthlyClass(before.subject, cls?.english_track) ? "monthly" : "per_session";
  if (pricingMode === "monthly") unitPrice = (await getTenantSettings()).billing.eieMonthlyPrice;
  const amount = sessionPricingAmount(pricingMode, sessions, unitPrice);
  const { error } = await supabase
    .from("invoice_session_terms")
    .update({
      confirmed_sessions: sessions,
      unit_price: unitPrice,
      pricing_mode: pricingMode,
      amount,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  const hadPrev = before?.confirmed_sessions !== null && before?.confirmed_sessions !== undefined;
  await logAction({
    action: "session_term_confirm",
    targetType: "invoice_session_term",
    metadata: {
      termId: id,
      classId: before?.class_id ?? null,
      sessions,
      unitPrice,
      amount,
      pricingMode,
      // 재확정(이미 확정돼 있던 행을 고침)일 때만 이전값 — 최초 확정엔 실을 이전값이 없다.
      ...(hadPrev
        ? { sessionsBefore: before!.confirmed_sessions, unitPriceBefore: Number(before!.unit_price ?? 0), pricingModeBefore: before!.pricing_mode }
        : {}),
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

/** 확정 해제 — 계획 N은 유지. */
export async function unconfirmSessionTerm(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "대상이 없습니다" };

  const supabase = await createClient();
  // 🔴 확정 해제는 확정값을 **null로 지운다** — 지우기 전에 읽지 않으면 "얼마였는지"가 영영 사라진다.
  const { data: before } = await supabase
    .from("invoice_session_terms")
    .select("class_id, confirmed_sessions, unit_price, amount")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("invoice_session_terms")
    .update({ confirmed_sessions: null, unit_price: null, amount: null, confirmed_by: null, confirmed_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAction({
    action: "session_term_unconfirm",
    targetType: "invoice_session_term",
    metadata: {
      termId: id,
      classId: before?.class_id ?? null,
      sessionsBefore: before?.confirmed_sessions ?? null,
      unitPriceBefore: before?.unit_price === null || before?.unit_price === undefined ? null : Number(before.unit_price),
      amountBefore: before?.amount === null || before?.amount === undefined ? null : Number(before.amount),
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

/** "YYYY-MM" 한 달 전. */
function prevPeriodOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 회차 **이월** 기록 — 부족분을 다음 달로 넘기거나(out), 전 달 이월분을 받아 쓴다(in).
 *
 * ⚠️ 원장 제약(2026-07-22): **더한 수업은 절대 급여에 포함되지 않는다(학원 손해).**
 *   상한을 올리는 유일한 근거는 **기록된 이월**이라, 여기서 서버가 한도를 재검증한다(UI 신뢰 금지).
 *   · out ≤ 그 달 부족분(청구−실측)  · in ≤ min(그 달 초과분, 전 달 이월분)
 * ⚠️ 컷오버 예외: 전 달(26.06)은 eywa에 term 행이 **없어서** 크레딧을 조회할 수 없다.
 *   그때만 **사유(note) 필수**로 그 달 초과분까지 허용하고, 누가·언제·왜를 남긴다(0134a 감사 컬럼).
 * 1단계는 **기록만** — 급여 상한이 실제로 이월을 소비하는 것은 2단계(돈 산식 변경 → 골든마스터 게이트).
 */
export async function setSessionTermCarryover(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "대상이 없습니다" };
  // ⚠️ **부분 수정 보존**: 키가 아예 안 오면 기존 값을 유지한다. `?? "0"`으로 두면 out만 보낸 호출이
  //    이미 승인된 carryover_in을 0으로 덮어 **크레딧이 조용히 사라진다**(돈 필드, 적대 검증 확정).
  const rawOut = formData.get("carryoverOut");
  const rawIn = formData.get("carryoverIn");
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();

  // 대상 행 + 그 청구서(학생·청구월)
  const { data: term, error: termErr } = await supabase
    .from("invoice_session_terms")
    .select(
      "id, invoice_id, class_id, pricing_mode, confirmed_sessions, carryover_out, carryover_in, invoice:invoice_id ( student_id, period )",
    )
    .eq("id", id)
    .maybeSingle();
  if (termErr) return { error: termErr.message };
  if (!term) return { error: "대상을 찾을 수 없습니다" };
  if (term.pricing_mode === "monthly") return { error: "월 고정 수강료는 회차를 이월하지 않습니다" };
  const out = rawOut === null ? (Number(term.carryover_out) || 0) : Number(String(rawOut).trim());
  const inn = rawIn === null ? (Number(term.carryover_in) || 0) : Number(String(rawIn).trim());
  const inv = (Array.isArray(term.invoice) ? term.invoice[0] : term.invoice) as
    | { student_id?: string; period?: string }
    | undefined;
  const period = inv?.period;
  const studentId = inv?.student_id;
  if (!period || !studentId) return { error: "청구서 정보를 확인할 수 없습니다" };

  // 실측 회차(출석 일수, 0263a) — 검증 화면과 같은 RPC를 써서 판정이 갈리지 않게 한다.
  const { data: att, error: attErr } = await supabase.rpc("session_term_attendance", { p_period: period });
  if (attErr) return { error: attErr.message };
  const actual =
    (att as { invoice_id: string; class_id: string; consumed: number | string }[] | null)?.find(
      (a) => a.invoice_id === term.invoice_id && a.class_id === term.class_id,
    )?.consumed ?? 0;
  const verdict = classifyVerification(term.confirmed_sessions, Number(actual) || 0);

  // 전 달 이월분(같은 학생·같은 반). 컷오버(전 달 term 행 없음)면 크레딧 조회 불가.
  const prev = prevPeriodOf(period);
  const { data: prevInv } = await supabase
    .from("invoices")
    .select("id")
    .eq("student_id", studentId)
    .eq("period", prev)
    .neq("status", "void") // 무효 처리된 전 달 청구서에서 이월 크레딧을 끌어오지 않는다
    .maybeSingle();
  let priorCredit = 0;
  let cutover = true; // 전 달 근거 행이 있으면 false
  if (prevInv?.id && term.class_id) {
    const { data: prevTerm } = await supabase
      .from("invoice_session_terms")
      .select("carryover_out")
      .eq("invoice_id", prevInv.id)
      .eq("class_id", term.class_id)
      .maybeSingle();
    if (prevTerm) {
      cutover = false;
      priorCredit = Number(prevTerm.carryover_out) || 0;
    }
  }

  const limitOut = maxCarryoverOut(verdict);
  // 컷오버는 근거 행이 없으니 사유를 받아 그 달 초과분까지 허용(그 이상은 여전히 불가 — 안 가르친 몫은 못 받는다).
  const limitIn = cutover
    ? maxCarryoverIn(verdict, Number.MAX_SAFE_INTEGER)
    : maxCarryoverIn(verdict, priorCredit);
  if (cutover && inn > 0 && !note) return { error: "전 달 기록이 없어 사유를 입력해야 이월을 받을 수 있습니다" };

  const checked = validateCarryover({ out, in: inn }, { maxOut: limitOut, maxIn: limitIn });
  if (!checked.ok) return { error: checked.error };

  const { error } = await supabase
    .from("invoice_session_terms")
    .update({
      carryover_out: checked.out,
      carryover_in: checked.in,
      carryover_by: user.id,
      carryover_at: new Date().toISOString(),
      carryover_note: note || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // 이월은 **급여 상한을 올리는 유일한 근거**라 누가·언제·왜가 남아야 한다. 행에도 carryover_by/at/note가
  // 박히지만 그건 **마지막 한 번만** 남는다 — 값을 두 번 고치면 앞 기록이 덮이므로 이력은 여기에만 남는다.
  // ⚠️ 컷오버(전 달 근거 행 없음)로 사유를 받아 통과시킨 건은 특히 되짚을 일이 생긴다 → cutover를 함께.
  await logAction({
    action: "session_term_carryover",
    targetType: "invoice_session_term",
    targetLabel: `${period} 회차 이월`,
    metadata: {
      termId: id,
      period,
      studentId,
      classId: term.class_id ?? null,
      carryoverOut: checked.out,
      carryoverIn: checked.in,
      outBefore: Number(term.carryover_out) || 0,
      inBefore: Number(term.carryover_in) || 0,
      cutover,
      note: note || null,
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}
