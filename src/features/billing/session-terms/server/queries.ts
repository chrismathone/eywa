import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { classInvoiceAmount, type LineItemLike } from "../class-amount";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isEieMonthlyClass, sessionPriceOptions, type SessionPrice, type SessionPricingMode } from "@/features/billing/session-pricing";
import { effectiveAllocations, receiptLines } from "../receipt-allocation";
import { loadLivePlans, type PlanHistory } from "./live-plans";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { receiptOriginalItems, receiptRefundState, type ReceiptRefundState } from "../receipt-refund";
import { receiptMatchesClass } from "../receipt-suggestion";
import { suggestFromLastMonth, type TermSuggestion } from "../last-month-suggestion";
import { loadLastMonthBasis, type LastMonthBasis } from "./last-month";

/** 회차 확정 면 한 행 — 청구서×반(반마다 단가가 달라 합산 금지). subject는 raw key(라벨은 소비처가 buildSubjectMaps로). */
export type SessionTermRow = {
  id: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  /** 학교 원문 — 화면은 `schoolGradeLabel(studentSchool, studentGrade)`로 "칠성초6"처럼 붙여 쓴다. */
  studentSchool?: string | null;
  /** 이 반의 그 달 배치 요일(0=일) — 반 이름 옆 표시. */
  classDays?: number[];
  /** 반 요일과 다른 이 학생의 개별 등원 요일 — 학생 이름 옆 표시(같으면 없음). */
  attendDays?: number[] | null;
  /** 미확정 행에 미리 채울 지난 달 확정 기준 단가·시수(`getSessionTermsView(…, { lastMonth: true })`일 때만). */
  lastMonth?: TermSuggestion | null;
  subject: string;
  classId: string | null;
  className: string | null;
  /**
   * 그 반의 **현재 담임** 이름(`classes.teacher_id`) — 표시 전용. 시수 검증 면의 담당 강사·분배와 같은 축이다.
   * ⚠️ 지난 달을 열어도 지금 담임이 나온다(담임엔 시간 축이 없다 — 되살리기는 teacher-as-of, 여기선 안 쓴다).
   */
  homeroomTeacherName?: string | null;
  monthlyPrice: number | null; // 현재 설정의 EiE 월 수강료. 기존 확정 스냅샷과 구분한다.
  pricingMode: SessionPricingMode; // 확정 시점 단위. 설정·반 구분을 바꿔도 과거 계산은 불변.
  plannedSessions: number | null;
  /** 예정이 휴원·반 비활성(시간 축 없음) 때문에 실제보다 작을 수 있다 — 화면의 '확정 ≠ 예정' 표시를 끈다(`loadLivePlans.uncertain`). */
  planUncertain?: boolean;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  confirmedAt: string | null;
  quantityBasis?: "days" | "attendance_units";
  allocatedAmount?: number | null;
  allocationStale?: boolean;
  allocationLineIndex?: number | null;
  invoiceHasAllocations?: boolean;
  refundState?: ReceiptRefundState;
  /** 회차 확정 표의 메모(특이사항) — 0102a부터 있던 칸. 쓰기는 `updateSessionTermNote` 한 곳. */
  note: string | null;
  // 참고 표시용 — 그 **반**의 청구액(line_items에서 반 매칭, 학생 전체 아님). 매칭 실패 시 null("—").
  // N2: 자동 일치화 금지 — 확정값(회차×단가)이 진실, 이 값은 makeedu 대조 힌트일 뿐.
  classAmount: number | null;
};

type TermClassEmbed = {
  class_name?: string;
  english_track?: string | null;
  teacher?: { display_name?: string | null } | { display_name?: string | null }[] | null;
};

export type SessionTermsView = {
  enrollmentHistory?: PlanHistory[];
  rows: SessionTermRow[];
  invoiceCount: number; // 그 달 청구서 수(계획 갱신 대상 규모)
  confirmedCount: number;
  catalog: SessionPrice[]; // 학원 설정의 공통 회당 단가. 월 금액은 섞지 않는다.
};

/** 청구월의 회차 확정 목록 + 회당 단가 프리셋. (B2: 전건은 fetchAllPaged / B3: .in은 청크 / B4: 병렬) */
export async function getSessionTermsView(period: string, invoiceId?: string, options: { lastMonth?: boolean } = {}): Promise<SessionTermsView> {
  const supabase = await createClient();

  const [invoices, settings] = await Promise.all([
    // ⚠️ 페이징에는 안정 정렬 필수 — 무순서 offset 페이징은 1000행 초과 시 중복/누락 위험(적대 리뷰 픽스).
    fetchAllPaged<{ id: string; student_id: string; line_items: unknown; status: string }>((from, to) => {
      // void(makeedu 삭제분) 제외 — 회차 계획·검증의 대상 청구서는 수납 화면과 같은 집합이어야 한다.
      const query = supabase.from("invoices").select("id, student_id, line_items, status").eq("period", period).neq("status", "void").order("id").range(from, to);
      return invoiceId ? query.eq("id", invoiceId) : query;
    }),
    getTenantSettings(),
  ]);
  const catalog = sessionPriceOptions(settings.billing.sessionPrices);
  if (invoices.length === 0)
    return { rows: [], invoiceCount: 0, confirmedCount: 0, catalog };

  const invoiceIds = invoices.map((i) => i.id);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const studentIds = [...new Set(invoices.map((i) => i.student_id))];
  const holidaysOf = (year: number) => mergeHolidays(year, settings.operations.holidays.map((h) => h.date), true);

  // 회차 행·학생·예정·지난 달 기준은 서로 기다릴 이유가 없다(B4) — 청구서 목록만 있으면 넷 다 시작한다.
  // 지난 달 기준 미리 채우기는 회차 확정 면만 쓴다(검증·배분 창은 안 읽는다 — 왕복 절약).
  const [terms, students, live, lastMonthBasis] = await Promise.all([fetchInChunks<{
    id: string;
    invoice_id: string;
    subject: string;
    class_id: string | null;
    planned_sessions: number | null;
    confirmed_sessions: number | null;
    unit_price: number | null;
    pricing_mode: SessionPricingMode;
    amount: number | null;
    confirmed_at: string | null;
    quantity_basis: "days" | "attendance_units";
    allocation_line_index: number | null;
    allocation_amount: number | null;
    allocation_source: unknown;
    allocation_base_amount: number | null;
    note: string | null;
    class: TermClassEmbed | TermClassEmbed[] | null;
  }>(invoiceIds, (chunk) =>
    supabase
      .from("invoice_session_terms")
      .select(
        "id, invoice_id, subject, class_id, planned_sessions, confirmed_sessions, unit_price, pricing_mode, amount, confirmed_at, quantity_basis, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount, note, class:class_id ( class_name, english_track, teacher:teacher_id ( display_name ) )",
      )
      .in("invoice_id", chunk),
  ), fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade, school").in("id", chunk),
  ), loadLivePlans(supabase, period, studentIds, holidaysOf(Number(period.slice(0, 4)))),
  options.lastMonth && !invoiceId ? loadLastMonthBasis(supabase, period, studentIds, holidaysOf) : Promise.resolve<LastMonthBasis>(new Map())]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  // 같은 학생·반의 회차 행이 이 달에 둘 이상이면(청구서 중복 — 한쪽이 이미 확정이어도) 미리 채우지 않는다.
  // 채우면 반 전체 선택 한 번에 같은 반이 두 번 확정된다(리뷰 2026-09-17 — 종전엔 빈 단가가 막았다).
  const termsPerKey = new Map<string, number>();
  for (const t of terms) {
    const inv = invoiceById.get(t.invoice_id);
    if (inv && t.class_id) termsPerKey.set(`${inv.student_id}|${t.class_id}`, (termsPerKey.get(`${inv.student_id}|${t.class_id}`) ?? 0) + 1);
  }
  const allocated = new Map<string, number>();
  // 연결 없이 0원으로 저장한 반(0269a — 항목 null · 금액 0)도 배분을 저장한 청구서다.
  const invoicesWithAllocations = new Set(terms.filter((term) => term.allocation_line_index != null || term.allocation_amount != null).map((term) => term.invoice_id));
  for (const invoice of invoices) {
    const values = effectiveAllocations(receiptLines(invoice.line_items), terms.filter((term) => term.invoice_id === invoice.id).map((term) => ({
      id: term.id, amount: term.amount === null ? null : Number(term.amount), confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null, allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source, baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    for (const [id, amount] of values) allocated.set(id, amount);
  }

  const rows: SessionTermRow[] = terms
    .map<SessionTermRow | null>((t) => {
      const inv = invoiceById.get(t.invoice_id);
      if (!inv) return null;
      const stu = studentById.get(inv.student_id);
      const cls = Array.isArray(t.class) ? t.class[0] : t.class;
      const className = cls?.class_name ?? null;
      const teacher = Array.isArray(cls?.teacher) ? cls.teacher[0] : cls?.teacher;
      const lineItems = (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];
      const matching = lineItems.flatMap(receiptOriginalItems).filter((line) => receiptMatchesClass(line, { classId: t.class_id, className }));
      const states = matching.map(receiptRefundState);
      const fullyRefunded = inv.status === "refunded" || (states.length > 0 && states.every((s) => s === "full"));
      const refundReview = lineItems.some((line) => receiptRefundState(line) === "partial" || (receiptRefundState(line) === "mixed" && "receiptGroupId" in line));
      const refundState: ReceiptRefundState = fullyRefunded ? "full" : refundReview ? "partial" : states.some((s) => s !== "none") ? "mixed" : "none";
      return {
        id: t.id,
        invoiceId: t.invoice_id,
        studentId: inv.student_id,
        studentName: stu?.name ?? "—",
        studentGrade: stu?.grade ?? null,
        studentSchool: stu?.school ?? null,
        subject: t.subject,
        classId: t.class_id,
        className,
        homeroomTeacherName: teacher?.display_name ?? null,
        monthlyPrice: isEieMonthlyClass(t.subject, cls?.english_track) ? settings.billing.eieMonthlyPrice : null,
        pricingMode: t.pricing_mode ?? "per_session",
        plannedSessions: t.class_id ? live.plans.get(inv.student_id)?.get(t.class_id) ?? 0 : t.planned_sessions === null ? null : Number(t.planned_sessions),
        planUncertain: t.class_id ? live.uncertain.has(`${inv.student_id}|${t.class_id}`) : false,
        classDays: t.class_id ? live.classDays.get(t.class_id) ?? [] : [],
        attendDays: t.class_id ? live.attendDays.get(`${inv.student_id}|${t.class_id}`) ?? null : null,
        lastMonth: (() => {
          if (!t.class_id || t.confirmed_sessions !== null) return null;
          const key = `${inv.student_id}|${t.class_id}`;
          const basis = lastMonthBasis.get(key);
          // 예정을 믿을 수 없는 행(휴원·비활성 반) · 이번 달 EiE 월 정액 행은 채우지 않는다 — 사람이 직접 적게 둔다(리뷰 2026-09-17).
          if (!basis || live.uncertain.has(key) || (termsPerKey.get(key) ?? 0) > 1 || isEieMonthlyClass(t.subject, cls?.english_track)) return null;
          return suggestFromLastMonth(live.plans.get(inv.student_id)?.get(t.class_id) ?? 0, basis.last, basis.lastPlan);
        })(),
        confirmedSessions: t.confirmed_sessions === null ? null : Number(t.confirmed_sessions),
        unitPrice: t.unit_price === null ? null : Number(t.unit_price),
        amount: t.amount === null ? null : Number(t.amount),
        confirmedAt: t.confirmed_at,
        quantityBasis: t.quantity_basis ?? "days",
        refundState,
        allocatedAmount: fullyRefunded ? 0 : allocated.get(t.id) ?? null,
        allocationStale: !fullyRefunded && (refundState === "partial" || ((t.allocation_line_index != null || t.allocation_amount != null || (invoicesWithAllocations.has(t.invoice_id) && t.confirmed_sessions !== null)) && !allocated.has(t.id))),
        allocationLineIndex: t.allocation_line_index ?? null,
        invoiceHasAllocations: invoicesWithAllocations.has(t.invoice_id),
        note: t.note,
        classAmount: fullyRefunded ? 0 : className ? classInvoiceAmount(className, lineItems) : null,
      } satisfies SessionTermRow;
    })
    .filter((r): r is SessionTermRow => r !== null)
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, "ko") ||
        a.subject.localeCompare(b.subject) ||
        (a.className ?? "").localeCompare(b.className ?? "", "ko"),
    );

  return {
    enrollmentHistory: live.history,
    rows,
    invoiceCount: invoices.length,
    confirmedCount: rows.filter((r) => r.confirmedSessions !== null).length,
    catalog,
  };
}
