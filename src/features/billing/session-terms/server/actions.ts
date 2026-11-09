"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { planTermsForMonth, monthRange, type PlanEnrollment } from "../plan";
import { classifyVerification } from "../verification";
import { maxCarryoverOut, maxCarryoverIn, validateCarryover } from "../carryover";
import { isEieMonthlyClass, sessionPricingAmount, validSessionQuantity, type SessionPricingMode, type SessionQuantityBasis } from "@/features/billing/session-pricing";
import { toAutoUnitsSchedule, type AutoUnitsSchedule } from "@/features/attendance/auto-units";
import { loadLivePlans } from "./live-plans";
import { isVirtualTermId, monthRosterKey, parseVirtualTermId, virtualTermId } from "../month-roster";
import { loadMonthRoster, type MonthRoster } from "./month-roster";
import { MATERIALIZE_ERROR, materializeVirtualTerms } from "./term-materialize";
import { autoReallocateAfterConfirm } from "./auto-reallocate";
import { applyCarrySync, carryBreaksAfter, loadCarryOutStates, syncCarrySessionsAfter } from "./carry-session-sync";

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export type SessionTermPatch = {
  id: string;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  pricingMode: SessionPricingMode;
  confirmedAt: string | null;
  quantityBasis?: SessionQuantityBasis;
  /** 받은 금액 이월 때문에 확정 시수를 자동으로 맞췄다(원장 2026-10-07) — 화면이 한 번 알린다(`SessionTermsState.apply`). */
  carryNotice?: string;
  /** 이 확정으로 이 줄이 다음 달로 보낸 이월이 무효가 됐다(2026-11-09) — 화면이 경고로 알린다(조용히 다음 달 실납에서 빠지지 않게). */
  carryWarning?: string;
};
/**
 * `created` = 이번 저장이 **회차 행을 새로 만든** 수(출석부 줄인데 행이 없던 학생 — `term-materialize.ts`). 0보다 크면 응답의 `terms`는
 * 실 uuid라 화면의 가상 행 패치(id 키)에 안 붙는다 → 화면은 `router.refresh()`로 가상 행을 실 행으로 갈아끼운다.
 */
export type SessionTermActionState = { error?: string; ok?: boolean; refreshed?: number; created?: number; terms?: SessionTermPatch[] } | undefined;

// 한 행 저장 때마다 월 전체 목록을 다시 그리지 않는다. 응답은 저장한 행만 보내고,
// 감사로그·다음 방문의 캐시 무효화는 응답 뒤 실행한다(Next after의 수명 보장).
function finishTermMutation(log: Parameters<typeof logAction>[0]) {
  after(async () => {
    revalidatePath("/billing");
    await logAction(log);
  });
}

/**
 * 계획 N 갱신 — 청구월의 모든 청구서에 대해 (청구서×반) 계획 회차를 재산출해 upsert.
 * ⚠️ N1: confirmed_* 필드는 절대 건드리지 않는다(계획만 갱신). 확정 안 된 stale 행만 삭제.
 * (B2 페이징 / B3 청크 / B4 병렬. 산출은 순수 planTermsForMonth — Vitest.)
 */
// 🔑 이 폴더의 행위자 = `getCurrentUser({ teacherView: true })` — '다른 강사 뷰'면 대상 직원 X(원장 2026-11-05 강사뷰 전수).
//    확정·이월·분할 기록의 명의(confirmed_by·carryover_by·created_by)가 X다. 감사로그 행위자는 logAction이 실제 계정으로 남긴다.
export async function refreshPlannedTerms(period: string): Promise<SessionTermActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
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
  const enrollments = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    attendance_days: string[] | null;
    is_transferred: boolean;
    class: { subject?: string; is_active?: boolean; english_track?: string | null; class_name?: string } | { subject?: string; english_track?: string | null; class_name?: string }[] | null;
  }>(studentIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, attendance_days, is_transferred, class:class_id!inner ( subject, is_active, english_track, class_name )")
      .in("student_id", chunk)
      .eq("on_hold", false)
      .eq("class.is_active", true)
      .lte("start_date", end)
      .or(`end_date.is.null,end_date.gte.${start}`).order("id").range(from, to),
  );
  const classIds = [...new Set(enrollments.map((e) => e.class_id))];
  const schedules = await fetchAllPagedInChunks<{ class_id: string; day_of_week: string; start_time: string; end_time: string; valid_from: string; valid_to: string | null; slot_teacher_label: string | null; lab_separate?: boolean }>(classIds, (chunk, from, to) =>
    supabase
      .from("class_schedules")
      .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, lab_separate")
      .in("class_id", chunk)
      .lte("valid_from", end)
      .or(`valid_to.is.null,valid_to.gte.${start}`).order("id").range(from, to),
  );
  const daysByClass = new Map<string, Set<number>>();
  const schedulesByClass = new Map<string, AutoUnitsSchedule[]>();
  for (const s of schedules) {
    const d = DOW[s.day_of_week];
    if (d === undefined) continue;
    (daysByClass.get(s.class_id) ?? daysByClass.set(s.class_id, new Set()).get(s.class_id)!).add(d);
    (schedulesByClass.get(s.class_id) ?? schedulesByClass.set(s.class_id, []).get(s.class_id)!).push(toAutoUnitsSchedule(s));
  }

  const holidays = mergeHolidays(Number(period.slice(0, 4)), settings.operations.holidays.map((h) => h.date), true);
  const byStudent = new Map<string, PlanEnrollment[]>();
  for (const e of enrollments) {
    const cls = Array.isArray(e.class) ? e.class[0] : e.class;
    if (!cls?.subject) continue;
    const list = byStudent.get(e.student_id) ?? byStudent.set(e.student_id, []).get(e.student_id)!;
    list.push({
      classId: e.class_id,
      subject: cls.subject,
      englishTrack: cls.english_track,
      className: cls.class_name,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: e.is_transferred,
      weekdays: [...(daysByClass.get(e.class_id) ?? [])],
      attendanceDays: (e.attendance_days ?? []).map((day) => DOW[day]).filter((day) => day !== undefined),
      schedules: schedulesByClass.get(e.class_id) ?? [],
    });
  }

  // 기존 term 로드(확정 보존·stale 판단) + 그 달 줄 집합(출석부와 같은 규칙) — 줄 집합 안의 행은 계획에 없어도 지우지 않는다.
  const invoiceIds = invoices.map((i) => i.id);
  const [existing, roster] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; invoice_id: string; class_id: string | null; planned_sessions: number | null; confirmed_sessions: number | null; allocation_line_index: number | null; allocation_amount: number | string | null; note: string | null }>(
      invoiceIds,
      (chunk, from, to) =>
        supabase
          .from("invoice_session_terms")
          .select("id, invoice_id, class_id, planned_sessions, confirmed_sessions, allocation_line_index, allocation_amount, note")
          .in("invoice_id", chunk)
          .order("id")
          .range(from, to),
    ),
    loadMonthRoster(supabase, period),
  ]);
  const studentOfInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  /** 그 행의 (학생·반)이 이번 달 줄 집합에 있는가 — 있으면 보강 방문으로 만든 행이라 확정을 풀어도 지우지 않는다(원장 2026-09-18). */
  const rosterPairOf = (t: { invoice_id: string; class_id: string | null }) => {
    const student = studentOfInvoice.get(t.invoice_id);
    return student && t.class_id ? roster.byKey.get(monthRosterKey(student, t.class_id)) : undefined;
  };

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
    // 시수 미확정이어도 사용자가 저장한 수납 배분은 계획 갱신으로 지우지 않는다.
    // 🔴 메모는 삭제를 막지 않는다 — 메모 하나로 남긴 행은 계획 0·미확정으로 영영 남아 '확정 N/M'·미배분 수·시수 검증
    //    미확정 수를 부풀린다(적대적 리뷰 2026-09-17). 대신 지운 메모 원문을 아래 감사로그에 남긴다.
    // 🔴 줄 집합(출석부) 안의 행은 계획 키에 없어도 남긴다 — 그 달 기록이 있는 한 출석부엔 그 줄이 서 있다(두 화면의 줄 수가 같아야 한다).
    // 🔴 자유 배분(0279a)은 항목 칸이 비어 있어도 금액이 있다 — **양수 금액**까지 없어야 '배분 없음'이다(안 보면 관리자가 준 돈이 조용히 사라진다).
    //    0원 줄(항목별 '연결 안 함'을 확정 해제한 것)은 지운다 — 남기면 재확인이 떠 그 달 분배 저장을 막고, 지워도 묶음 합계는 그대로다.
    if (!plannedKeys.has(`${t.invoice_id}|${t.class_id}`) && !rosterPairOf(t) && t.confirmed_sessions === null && t.allocation_line_index == null && Number(t.allocation_amount ?? 0) === 0) staleUnconfirmed.push(t.id);
  }

  // upsert는 계획 필드만 — onConflict 대상 컬럼 목록에 confirmed_*를 넣지 않아 기존 확정이 보존된다.
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await supabase
      .from("invoice_session_terms")
      .upsert(upserts.slice(i, i + 200), { onConflict: "tenant_id,invoice_id,class_id" });
    if (error) return { error: `계획 저장 실패: ${error.message}` };
  }
  for (let i = 0; i < staleUnconfirmed.length; i += 200) {
    const { error } = await supabase.from("invoice_session_terms").delete().in("id", staleUnconfirmed.slice(i, i + 200)).is("confirmed_sessions", null).is("allocation_line_index", null).or("allocation_amount.is.null,allocation_amount.eq.0");
    if (error) return { error: `정리 실패: ${error.message}` };
  }

  const removedIds = new Set(staleUnconfirmed);
  const removedNotes = existing
    .filter((t) => removedIds.has(t.id) && t.note)
    .map((t) => ({ termId: t.id, invoiceId: t.invoice_id, classId: t.class_id, note: t.note }));

  // 확정·배분 때문에 남겨 둔 종료반도 계획은 0이다. 예전 계획값을 남기지 않는다.
  // 🔴 기록·예약만으로 서는 줄(수강행 없는 보강 방문)은 예정이 **없는** 줄이라 0이 아니라 **null**로 맞춘다 — 수강행을 지우거나 시작일을
  //    미뤄 방문 줄로 바뀐 행이 옛 예정(예: 8)을 들고 남지 않게(적대 리뷰 2026-09-18). 반 일괄 대상 판정은 저장값이 아니라 live plan이지만
  //    저장값이 거짓 예정을 들고 있으면 다음에 읽는 곳이 또 속는다. 이미 null이면 쓰지 않는다 · 확정값은 안 건드린다.
  const staleRetained: string[] = [];
  const visitorNull: string[] = [];
  for (const t of existing) {
    if (plannedKeys.has(`${t.invoice_id}|${t.class_id}`)) continue;
    const pair = rosterPairOf(t);
    if (!pair || pair.sources.includes("enrolled")) staleRetained.push(t.id);
    else if (t.planned_sessions !== null) visitorNull.push(t.id);
  }
  for (const [ids, value, label] of [[staleRetained, 0, "종료반"], [visitorNull, null, "보강 방문 줄"]] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("invoice_session_terms").update({ planned_sessions: value }).in("id", ids.slice(i, i + 200));
      if (error) return { error: `${label} 계획 저장 실패: ${error.message}` };
    }
  }

  // 한 달 전체를 다시 계산하고 **확정 안 된 stale 행을 지우는** 일이라 한 줄 남긴다(행마다가 아니라 실행 단위).
  // 확정값(confirmed_*)은 건드리지 않으므로 청구 금액은 안 변한다 — 그 사실이 로그에서도 읽히게 removed를 함께.
  await logAction({
    action: "session_terms_refresh",
    targetType: "invoice_session_term",
    targetLabel: `${period} 계획 갱신`,
    metadata: {
      period,
      refreshed,
      removed: staleUnconfirmed.length,
      invoices: invoices.length,
      // 지운 행에 적혀 있던 메모(특이사항) — 행과 함께 사라지므로 원문을 여기에만 남긴다.
      ...(removedNotes.length ? { removedNotes } : {}),
    },
  });
  revalidatePath("/billing");
  return { ok: true, refreshed };
}

/**
 * 반 일괄 확정 — 한 반의 그 청구월 학생 전원을 **회차 × 같은 회당 단가**로 한 번에 확정.
 * 400+행을 하나씩 확정하는 대신 반 단위로 배정하고, 개인별로 다른 건 confirmSessionTerm으로 보정(2026-07-13 원장).
 * 일반 수업은 회차를 명시해야 확정한다. 단가만 일괄 입력하는 동작은 클라이언트 초안이다.
 */
export async function confirmClassTerms(
  period: string,
  classId: string,
  unitPriceRaw: number,
  sessionsOverride?: number | null,
  visibleTermIds?: string[],
): Promise<{
  error?: string;
  confirmed?: number;
  /** 이번 저장이 새로 만든 회차 행 수(감사로그 수). */
  created?: number;
  /** 가상 줄이 실제 행으로 바뀐 수(다른 창이 먼저 만든 행 포함) — 0보다 크면 화면이 새로 읽어 가상 줄을 갈아끼운다. */
  materialized?: number;
  /** 이번 달 예정이 없어 반 일괄에서 빠진 학생 수(보강 방문·월초 종료 등) — 개별·선택 확정으로 한다. */
  skippedUnplanned?: number;
  terms?: SessionTermPatch[];
}> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };
  if (!classId) return { error: "반이 지정되지 않았습니다" };
  if (visibleTermIds !== undefined && (!Array.isArray(visibleTermIds) || visibleTermIds.length === 0 || visibleTermIds.length > 1000 || visibleTermIds.some((id) => typeof id !== "string" || !id))) return { error: "확정할 학생을 확인해 주세요" };
  let unitPrice = Math.round(unitPriceRaw);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };
  const override = sessionsOverride ?? null;
  if (override != null && !validSessionQuantity(override)) return { error: "시수는 0~99 사이, 소수 한 자리까지 입력하세요" };

  const supabase = await createClient();
  // 이 반의 그 청구월 term만 — invoices inner join으로 period 필터(RLS가 테넌트 격리).
  const { data: cls, error: classError } = await supabase.from("classes")
    .select("subject, english_track").eq("id", classId).maybeSingle();
  if (classError) return { error: classError.message };
  if (!cls) return { error: "반을 찾을 수 없습니다" };
  const pricingMode: SessionPricingMode = isEieMonthlyClass(cls.subject, cls.english_track) ? "monthly" : "per_session";
  if (pricingMode === "per_session" && override === null) return { error: "일괄 확정할 회차를 입력해 주세요. 단가만 입력하면 미확정 상태로 유지됩니다" };
  if (pricingMode === "monthly") unitPrice = (await getTenantSettings()).billing.eieMonthlyPrice;

  // 이 반·이 달의 회차 행 — 대상 선정과 "이미 행이 있는 학생" 판정에 함께 쓴다.
  type ClassTermRow = {
    id: string;
    confirmed_sessions: number | null;
    invoice: { period: string; student_id: string; status: string } | { period: string; student_id: string; status: string }[] | null;
  };
  // 🔴 취소(void) 청구서의 행은 대상이 아니다 — 화면·행 생성·계획 갱신·정산 전부 살아 있는 청구서만 본다(재리뷰 2026-09-18: void 행이
  //    '이미 행 있음'으로 재발행 청구서의 가상 줄 생성을 막고, 화면에 없는 void 행을 확정했다).
  const readTerms = () =>
    supabase
      .from("invoice_session_terms")
      .select("id, confirmed_sessions, invoice:invoice_id!inner ( period, student_id, status )")
      .eq("class_id", classId)
      .eq("invoice.period", period)
      .neq("invoice.status", "void");
  const studentOfRow = (r: ClassTermRow) => (Array.isArray(r.invoice) ? r.invoice[0] : r.invoice)?.student_id;
  // 회차 행과 그 반 줄 집합은 서로를 기다릴 이유가 없다(B4) — 필터 보기(가상 id를 화면이 보낸다)면 줄 집합은 행 생성이 학생만큼 읽는다.
  const [first, classRoster] = await Promise.all([
    readTerms(),
    visibleTermIds === undefined ? loadMonthRoster(supabase, period, { classIds: [classId] }) : Promise.resolve(undefined),
  ]);
  if (first.error) return { error: first.error.message };
  let data = (first.data ?? []) as ClassTermRow[];

  // 🔴 이 반의 출석부 줄인데 회차 행이 없는 학생을 **먼저** 만든다 — 그래야 아래 대상 선정이 출석부와 같은 줄을 본다
  //    (원장 2026-09-18 "출석부 행 개수 = 회차 확정 행 개수"). 청구서가 없거나 취소된 줄은 만들 수 없어 빠진다(화면도 잠겨 있다).
  // 🔴 반 일괄은 **이번 달 예정이 있는 줄만** 만들고 확정한다(`plannedOnly` · 아래 live plan > 0) — 수강행 없는 보강 방문 줄과
  //    예정 0인 수강 줄(월초 당일 종료·반이동 전출)에 반 전체 숫자를 넣으면 틀린 시수가 확정되고 EiE면 월 정액이 붙는다(적대 리뷰 2026-09-18).
  //    그 줄은 실제 시수를 보고 개별·선택 확정으로 한다 — 빠진 인원은 응답 `skippedUnplanned`로 화면이 알린다.
  // ⚡ 줄 집합은 **이 반만** 읽는다(쌍은 반마다 독립) · 이미 회차 행이 있는 학생은 만들 것이 없어 보내지 않는다.
  let created = 0;
  let materialized = 0;
  /** 반 일괄에서 빠진 예정 없는 학생(가상 줄 · 이미 행이 있는 줄 둘 다) — 같은 학생을 두 번 세지 않게 학생 id로 모은다. */
  const unplannedStudents = new Set<string>();
  let lockedOnly = false;
  let visible = visibleTermIds;
  {
    const hasRow = new Set(data.map(studentOfRow).filter((id): id is string => !!id));
    const roster: MonthRoster | undefined = classRoster;
    const ids = roster
      ? roster.pairs.filter((p) => p.classId === classId && !hasRow.has(p.studentId)).map((p) => virtualTermId(p.studentId, p.classId))
      : (visibleTermIds ?? []).filter(isVirtualTermId);
    if (ids.length > 0) {
      const made = await materializeVirtualTerms(supabase, { tenantId: user.tenantId, period, reason: "confirm_class", classId, roster, plannedOnly: true }, ids);
      if (made.error) return { error: made.error };
      created = made.created;
      materialized = made.ids.size;
      for (const [id, reason] of made.failed) {
        const pair = reason === MATERIALIZE_ERROR.unplanned ? parseVirtualTermId(id) : null;
        if (pair) unplannedStudents.add(pair.studentId);
      }
      lockedOnly = made.failed.size > 0 && [...made.failed.values()].every((r) => r === MATERIALIZE_ERROR.noInvoice || r === MATERIALIZE_ERROR.voidInvoice);
      if (visible) visible = visible.map((id) => made.ids.get(id) ?? id);
      if (made.ids.size > 0) {
        const again = await readTerms();
        if (again.error) return { error: again.error.message };
        data = (again.data ?? []) as ClassTermRow[];
      }
    }
  }

  // 🔑 대상 = **이번 달 예정(live plan)이 있는 행만** — 화면(`batchEligible`)과 **같은 축**이다. 저장된 `planned_sessions`는 '계획 갱신'을
  //    누른 순간의 값이라(수동 버튼) 그 뒤 휴원·반이동·종료일 소급을 모른다 — 그 값으로 고르면 화면은 '예정 없음'인 떠난 학생을 다시
  //    확정한다(EiE면 월 정액, 재리뷰 2026-09-18). 수강행 없는 보강 방문 줄은 live plan이 없어(0) 자연히 빠진다.
  const inView = data.filter((r) => visible === undefined || visible.includes(r.id));
  const settingsForPlan = await getTenantSettings();
  const livePlans = await loadLivePlans(
    supabase,
    period,
    [...new Set(inView.map(studentOfRow).filter((id): id is string => !!id))],
    mergeHolidays(Number(period.slice(0, 4)), settingsForPlan.operations.holidays.map((h) => h.date), true),
  );
  const planOf = (r: ClassTermRow) => livePlans.plans.get(studentOfRow(r) ?? "")?.get(classId) ?? 0;
  const targets = inView.filter((r) => planOf(r) > 0);
  // 빠진 인원은 **아직 확정 안 된 줄**만 센다 — 이미 확정된 줄에 "개별로 확정하세요"라고 하면 거짓 안내다.
  for (const r of inView) {
    const student = studentOfRow(r);
    if (planOf(r) <= 0 && r.confirmed_sessions === null && student) unplannedStudents.add(student);
  }
  const skippedUnplanned = unplannedStudents.size;
  const extra = { ...(created ? { created } : {}), ...(materialized ? { materialized } : {}), ...(skippedUnplanned ? { skippedUnplanned } : {}) };
  if (targets.length === 0) {
    const reason = skippedUnplanned > 0
      ? MATERIALIZE_ERROR.unplanned
      : lockedOnly
        ? "이 반에서 확정할 수 있는 줄이 없습니다 — 청구서가 없거나 취소된 학생뿐입니다"
        : "확정할 대상이 없습니다 — 계획 갱신을 먼저 눌러주세요";
    return { error: reason, ...extra };
  }

  const now = new Date().toISOString();
  // 보낸 이월이 있는 줄의 저장 전 상태 — 이번 확정이 그 이월을 무효로 만들면 알린다(대부분 조회 한 번으로 끝).
  const carryBefore = await loadCarryOutStates(supabase, targets.map((r) => r.id));
  const studentOf = (r: typeof targets[number]) => (Array.isArray(r.invoice) ? r.invoice[0] : r.invoice)?.student_id;
  // 월 정액·회차 미입력이면 각자 live plan — 위에서 읽은 것을 그대로 쓴다(같은 학생 집합).
  const liveMonthlyPlans: Awaited<ReturnType<typeof loadLivePlans>> | null = pricingMode === "monthly" && override === null ? livePlans : null;
  // amount = 회차 × 단가라 회차값마다 다름 → 회차별로 묶어 batch update(반 학생은 소수라 청크 불필요).
  const byN = new Map<number, string[]>();
  for (const r of targets) {
    const n = override != null ? override : liveMonthlyPlans ? liveMonthlyPlans.plans.get(studentOf(r) ?? "")?.get(classId) ?? 0 : planOf(r);
    (byN.get(n) ?? byN.set(n, []).get(n)!).push(r.id as string);
  }
  let confirmed = 0;
  const terms: SessionTermPatch[] = [];
  for (const [n, ids] of byN) {
    const { data: saved, error: uerr } = await supabase
      .from("invoice_session_terms")
      .update({
        confirmed_sessions: n,
        unit_price: unitPrice,
        pricing_mode: pricingMode,
        quantity_basis: "attendance_units",
        amount: sessionPricingAmount(pricingMode, n, unitPrice),
        confirmed_by: user.id,
        confirmed_at: now,
      })
      .in("id", ids)
      .select("id");
    if (uerr) return { error: uerr.message };
    for (const row of saved ?? []) terms.push({ id: row.id, confirmedSessions: n, unitPrice, pricingMode, amount: sessionPricingAmount(pricingMode, n, unitPrice), confirmedAt: now, quantityBasis: "attendance_units" });
    confirmed += saved?.length ?? 0;
  }
  if (confirmed === 0) return { error: "확정할 대상을 찾을 수 없습니다", ...extra };
  // 배분을 저장해 둔 청구서는 사람이 다시 저장할 일만 대신한다(원장 2026-10-06) — 응답 전에 끝내야 화면이 다시 읽을 때 정상이다.
  await autoReallocateAfterConfirm(supabase, terms.map((t) => t.id), "confirm_class");
  // 받은 금액 이월이 실린 줄은 확정 시수를 그만큼 맞춘다(원장 2026-10-07) — 응답의 행 값도 고친 값으로.
  const syncedRaw = applyCarrySync(terms, await syncCarrySessionsAfter(supabase, { termIds: terms.map((t) => t.id) }, user.id, "confirm_class"));
  const carryWarnings = await carryBreaksAfter(supabase, carryBefore);
  const synced = syncedRaw.map((t) => (carryWarnings.has(t.id) ? { ...t, carryWarning: carryWarnings.get(t.id) } : t));

  // 🔴 한 번에 반 전체 청구 회차·단가를 못박는 자리 = 돈이 실제로 결정되는 지점. 단가·회차를 남긴다
  //    (`invoice_create`가 amountTotal을 남기는 것과 같은 결 — 금액 없이 "누가 눌렀다"만 남기면
  //     "왜 이 학생 청구가 다른가"에 답할 수 없다). classId는 뷰어가 반 이름으로 풀어 준다.
  finishTermMutation({
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
      ...(created ? { createdRows: created } : {}),
      ...(skippedUnplanned ? { skippedUnplanned } : {}),
    },
  });
  return { confirmed, terms: synced, ...extra };
}

/** 회차/월 금액 확정 — 회당은 N×단가, EiE는 설정의 월 금액과 단위를 스냅샷. */
export async function confirmSessionTerm(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };

  let id = String(formData.get("id") ?? "").trim();
  const sessionsRaw = String(formData.get("sessions") ?? "").trim();
  const sessions = sessionsRaw === "" ? NaN : Number(sessionsRaw);
  const priceRaw = String(formData.get("unitPrice") ?? "").replace(/[,\s]/g, "");
  let unitPrice = priceRaw === "" ? NaN : Number(priceRaw);
  if (!id) return { error: "대상이 없습니다" };
  if (!validSessionQuantity(sessions)) return { error: "확정 시수는 0~99 사이, 소수 한 자리까지 입력하세요" };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };
  unitPrice = Math.round(unitPrice);

  const supabase = await createClient();
  // 출석부 줄인데 회차 행이 없던 학생(가상 id) — 서버가 그 달 줄 집합·청구서로 다시 판정하고(#77) 행을 만든 뒤 실 id로 확정한다.
  // 화면은 `created`를 보고 새로고침해 가상 행을 실 행으로 갈아끼운다.
  let created = 0;
  if (isVirtualTermId(id)) {
    const period = String(formData.get("period") ?? "").trim();
    if (!monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" };
    const made = await materializeVirtualTerms(supabase, { tenantId: user.tenantId, period, reason: "confirm" }, [id]);
    const real = made.ids.get(id);
    if (!real) return { error: made.error ?? made.failed.get(id) ?? "회차 행을 만들지 못했습니다. 다시 시도해 주세요" };
    created = made.created;
    id = real;
  }
  // 반·이전 확정값을 함께 읽는다 — classId는 뷰어가 반 이름으로 풀어 주고(감사로그 '대상'), 이전 확정값은
  // "얼마에서 얼마로 고쳤나"의 답이다(행에는 마지막 값만 남는다).
  // 보낸 이월이 있으면 저장 전 상태를 함께 적어 둔다 — 이번 확정이 그 이월을 무효로 만들면 알린다(앞 읽기와 나란히 — B4).
  const [{ data: before, error: readError }, carryBefore] = await Promise.all([
    supabase
      .from("invoice_session_terms")
      .select("class_id, subject, confirmed_sessions, unit_price, pricing_mode, class:class_id ( english_track )")
      .eq("id", id)
      .maybeSingle(),
    loadCarryOutStates(supabase, [id]),
  ]);
  if (readError) return { error: readError.message };
  if (!before) return { error: "대상을 찾을 수 없습니다" };
  const cls = Array.isArray(before.class) ? before.class[0] : before.class;
  const pricingMode: SessionPricingMode = isEieMonthlyClass(before.subject, cls?.english_track) ? "monthly" : "per_session";
  if (pricingMode === "monthly") unitPrice = (await getTenantSettings()).billing.eieMonthlyPrice;
  const amount = sessionPricingAmount(pricingMode, sessions, unitPrice);
  const confirmedAt = new Date().toISOString();
  const { data: saved, error } = await supabase
    .from("invoice_session_terms")
    .update({
      confirmed_sessions: sessions,
      unit_price: unitPrice,
      pricing_mode: pricingMode,
      quantity_basis: "attendance_units",
      amount,
      confirmed_by: user.id,
      confirmed_at: confirmedAt,
    })
    .eq("id", id).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!saved) return { error: "확정할 대상을 찾을 수 없습니다" };
  await autoReallocateAfterConfirm(supabase, [id], "confirm");
  // 받은 금액 이월이 실린 줄은 확정 시수를 그만큼 맞춘다(원장 2026-10-07) — 사람이 '해제 → 시수 올림 → 다시 확정'하던 일.
  const syncedRaw = applyCarrySync(
    [{ id, confirmedSessions: sessions, unitPrice, pricingMode, amount, confirmedAt, quantityBasis: "attendance_units" as const }],
    await syncCarrySessionsAfter(supabase, { termIds: [id] }, user.id, "confirm"),
  );
  const carryWarnings = await carryBreaksAfter(supabase, carryBefore);
  const synced = syncedRaw.map((t) => (carryWarnings.has(t.id) ? { ...t, carryWarning: carryWarnings.get(t.id) } : t));

  const hadPrev = before?.confirmed_sessions !== null && before?.confirmed_sessions !== undefined;
  finishTermMutation({
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
  return { ok: true, ...(created ? { created } : {}), terms: synced };
}

/** 확정 해제 — 계획 N은 유지. */
export async function unconfirmSessionTerm(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "대상이 없습니다" };
  // 가상 id(회차 행이 없는 줄)엔 해제할 확정이 없다 — uuid 열에 그대로 보내면 DB 오류 원문이 화면에 샌다.
  if (isVirtualTermId(id)) return { error: "아직 회차 행이 없는 줄입니다 — 해제할 확정이 없습니다" };

  const supabase = await createClient();
  // 🔴 확정 해제는 확정값을 **null로 지운다** — 지우기 전에 읽지 않으면 "얼마였는지"가 영영 사라진다.
  const { data: before, error: readError } = await supabase
    .from("invoice_session_terms")
    .select("class_id, confirmed_sessions, unit_price, amount, pricing_mode")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!before) return { error: "대상을 찾을 수 없습니다" };
  const { data: saved, error } = await supabase
    .from("invoice_session_terms")
    .update({ confirmed_sessions: null, unit_price: null, amount: null, confirmed_by: null, confirmed_at: null })
    .eq("id", id).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!saved) return { error: "해제할 대상을 찾을 수 없습니다" };

  finishTermMutation({
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
  return { ok: true, terms: [{ id, confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null, pricingMode: before.pricing_mode ?? "per_session" }] };
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
 * ⚠️ 컷오버 예외: 전 달(26.06)은 aywa에 term 행이 **없어서** 크레딧을 조회할 수 없다.
 *   그때만 **사유(note) 필수**로 그 달 초과분까지 허용하고, 누가·언제·왜를 남긴다(0134a 감사 컬럼).
 * 1단계는 **기록만** — 급여 상한이 실제로 이월을 소비하는 것은 2단계(돈 산식 변경 → 골든마스터 게이트).
 */
export async function setSessionTermCarryover(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "대상이 없습니다" };
  if (isVirtualTermId(id)) return { error: "아직 회차 행이 없는 줄입니다 — 먼저 시수를 확정해 주세요" };
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
      "id, invoice_id, class_id, pricing_mode, quantity_basis, confirmed_sessions, carryover_out, carryover_in, invoice:invoice_id ( student_id, period )",
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
  const verdict = classifyVerification(term.confirmed_sessions == null ? null : Number(term.confirmed_sessions), Number(actual) || 0);

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
      .select("carryover_out, quantity_basis")
      .eq("invoice_id", prevInv.id)
      .eq("class_id", term.class_id)
      .maybeSingle();
    if (prevTerm) {
      cutover = false;
      priorCredit = Number(prevTerm.carryover_out) || 0;
      if (inn > 0 && priorCredit > 0 && prevTerm.quantity_basis !== term.quantity_basis) return { error: "전 달과 시수 기준이 다릅니다. 이전 확정값을 시수 기준으로 확인해 주세요" };
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
