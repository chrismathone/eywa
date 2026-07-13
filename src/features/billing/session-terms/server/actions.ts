"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { planTermsForMonth, monthRange, type PlanEnrollment } from "../plan";

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
      supabase.from("invoices").select("id, student_id").eq("period", period).range(from, to),
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
  const unitPrice = Math.round(unitPriceRaw);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };
  const override =
    sessionsOverride != null && Number.isFinite(sessionsOverride) ? Math.round(sessionsOverride) : null;
  if (override != null && (override < 0 || override > 99)) return { error: "회차는 0~99 사이여야 합니다" };

  const supabase = await createClient();
  // 이 반의 그 청구월 term만 — invoices inner join으로 period 필터(RLS가 테넌트 격리).
  const { data, error } = await supabase
    .from("invoice_session_terms")
    .select("id, planned_sessions, invoice:invoice_id!inner ( period )")
    .eq("class_id", classId)
    .eq("invoice.period", period);
  if (error) return { error: error.message };
  // 회차 지정 시엔 계획 없어도 적용, 미지정 시엔 계획값 필요.
  const targets = (data ?? []).filter((r) => override != null || r.planned_sessions !== null);
  if (targets.length === 0) return { error: "확정할 대상이 없습니다 — 계획 갱신을 먼저 눌러주세요" };

  const now = new Date().toISOString();
  // amount = 회차 × 단가라 회차값마다 다름 → 회차별로 묶어 batch update(반 학생은 소수라 청크 불필요).
  const byN = new Map<number, string[]>();
  for (const r of targets) {
    const n = override != null ? override : (r.planned_sessions as number);
    (byN.get(n) ?? byN.set(n, []).get(n)!).push(r.id as string);
  }
  let confirmed = 0;
  for (const [n, ids] of byN) {
    const { error: uerr } = await supabase
      .from("invoice_session_terms")
      .update({
        confirmed_sessions: n,
        unit_price: unitPrice,
        amount: n * unitPrice,
        confirmed_by: user.id,
        confirmed_at: now,
      })
      .in("id", ids);
    if (uerr) return { error: uerr.message };
    confirmed += ids.length;
  }
  revalidatePath("/billing");
  return { confirmed };
}

/** 회차 확정 — 확정 N × 회당 단가를 스냅샷. 확정값만 청구값(N1). */
export async function confirmSessionTerm(
  _prev: SessionTermActionState,
  formData: FormData,
): Promise<SessionTermActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const sessions = Number(String(formData.get("sessions") ?? "").trim());
  const unitPrice = Number(String(formData.get("unitPrice") ?? "").replace(/[,\s]/g, ""));
  if (!id) return { error: "대상이 없습니다" };
  if (!Number.isInteger(sessions) || sessions < 0 || sessions > 99)
    return { error: "확정 회차는 0~99 사이 정수여야 합니다" };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "회당 단가를 확인해 주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("invoice_session_terms")
    .update({
      confirmed_sessions: sessions,
      unit_price: unitPrice,
      amount: sessions * unitPrice,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

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
  const { error } = await supabase
    .from("invoice_session_terms")
    .update({ confirmed_sessions: null, unit_price: null, amount: null, confirmed_by: null, confirmed_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}
