import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { classInvoiceAmount, type LineItemLike } from "../class-amount";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isEieMonthlyClass, sessionPriceOptions, type SessionPrice, type SessionPricingMode } from "@/features/billing/session-pricing";

/** 회차 확정 면 한 행 — 청구서×반(반마다 단가가 달라 합산 금지). subject는 raw key(라벨은 소비처가 buildSubjectMaps로). */
export type SessionTermRow = {
  id: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  subject: string;
  classId: string | null;
  className: string | null;
  monthlyPrice: number | null; // 현재 설정의 EiE 월 수강료. 기존 확정 스냅샷과 구분한다.
  pricingMode: SessionPricingMode; // 확정 시점 단위. 설정·반 구분을 바꿔도 과거 계산은 불변.
  plannedSessions: number | null;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  confirmedAt: string | null;
  note: string | null;
  // 참고 표시용 — 그 **반**의 청구액(line_items에서 반 매칭, 학생 전체 아님). 매칭 실패 시 null("—").
  // N2: 자동 일치화 금지 — 확정값(회차×단가)이 진실, 이 값은 makeedu 대조 힌트일 뿐.
  classAmount: number | null;
};

export type SessionTermsView = {
  rows: SessionTermRow[];
  invoiceCount: number; // 그 달 청구서 수(계획 갱신 대상 규모)
  confirmedCount: number;
  catalog: SessionPrice[]; // 학원 설정의 공통 회당 단가. 월 금액은 섞지 않는다.
};

/** 청구월의 회차 확정 목록 + 회당 단가 프리셋. (B2: 전건은 fetchAllPaged / B3: .in은 청크 / B4: 병렬) */
export async function getSessionTermsView(period: string): Promise<SessionTermsView> {
  const supabase = await createClient();

  const [invoices, settings] = await Promise.all([
    // ⚠️ 페이징에는 안정 정렬 필수 — 무순서 offset 페이징은 1000행 초과 시 중복/누락 위험(적대 리뷰 픽스).
    fetchAllPaged<{ id: string; student_id: string; line_items: unknown }>((from, to) =>
      // void(makeedu 삭제분) 제외 — 회차 계획·검증의 대상 청구서는 수납 화면과 같은 집합이어야 한다.
      supabase.from("invoices").select("id, student_id, line_items").eq("period", period).neq("status", "void").order("id").range(from, to),
    ),
    getTenantSettings(),
  ]);
  const catalog = sessionPriceOptions(settings.billing.sessionPrices);
  if (invoices.length === 0)
    return { rows: [], invoiceCount: 0, confirmedCount: 0, catalog };

  const invoiceIds = invoices.map((i) => i.id);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const terms = await fetchInChunks<{
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
    note: string | null;
    class: { class_name?: string; english_track?: string | null } | { class_name?: string; english_track?: string | null }[] | null;
  }>(invoiceIds, (chunk) =>
    supabase
      .from("invoice_session_terms")
      .select(
        "id, invoice_id, subject, class_id, planned_sessions, confirmed_sessions, unit_price, pricing_mode, amount, confirmed_at, note, class:class_id ( class_name, english_track )",
      )
      .in("invoice_id", chunk),
  );

  const studentIds = [...new Set(invoices.map((i) => i.student_id))];
  const students = await fetchInChunks<{ id: string; name: string; grade: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade").in("id", chunk),
  );
  const studentById = new Map(students.map((s) => [s.id, s]));

  const rows: SessionTermRow[] = terms
    .map((t) => {
      const inv = invoiceById.get(t.invoice_id);
      if (!inv) return null;
      const stu = studentById.get(inv.student_id);
      const cls = Array.isArray(t.class) ? t.class[0] : t.class;
      const className = cls?.class_name ?? null;
      const lineItems = (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];
      return {
        id: t.id,
        invoiceId: t.invoice_id,
        studentId: inv.student_id,
        studentName: stu?.name ?? "—",
        studentGrade: stu?.grade ?? null,
        subject: t.subject,
        classId: t.class_id,
        className,
        monthlyPrice: isEieMonthlyClass(t.subject, cls?.english_track) ? settings.billing.eieMonthlyPrice : null,
        pricingMode: t.pricing_mode ?? "per_session",
        plannedSessions: t.planned_sessions,
        confirmedSessions: t.confirmed_sessions,
        unitPrice: t.unit_price === null ? null : Number(t.unit_price),
        amount: t.amount === null ? null : Number(t.amount),
        confirmedAt: t.confirmed_at,
        note: t.note,
        classAmount: className ? classInvoiceAmount(className, lineItems) : null,
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
    rows,
    invoiceCount: invoices.length,
    confirmedCount: rows.filter((r) => r.confirmedSessions !== null).length,
    catalog,
  };
}
