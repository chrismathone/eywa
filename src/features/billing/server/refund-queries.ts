import "server-only";
import { receiptHistoryLines } from "../invoice-line-items";
import { createClient } from "@/lib/supabase/server";
import { hideRestrictedDocuments } from "@/features/documents/server/restricted";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getStudentEnrollments } from "@/features/students/server/queries";
import { studentStatusLabel } from "@/features/students/status/status-labels";
import { normalizeRefund, REFUND_FORM_TYPE, type RefundRequestData } from "../refund-request";
import type { RefundPrefillInvoice, RefundPrefillSource } from "../refund-prefill";

// 환불 요청서 조회 — tenant 스코프는 RLS, restricted 행 열람은 RLS restrictive(0072a)가
// DB 레벨에서 사무실 역할(master/admin/manager/accountant)로 한정. 직원 이력서(resume-queries) 패턴.

export type RefundListRow = {
  id: string;
  name: string;
  className: string;
  requestDate: string; // 서식 '환불요청일자' 값 — 목록에선 '환불처리일자' 헤더로 표시(⚠️ 데이터 유지·헤더만 리네임 = 사용자 지시)
  completedDate: string; // 환불완료일자 (처리결과 신규 필드)
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null; // 작성자 — 목록에선 '담당자' 헤더로 표시(⚠️ 데이터 유지·헤더만 리네임)
};

type RefundRow = { id: string; form_data: unknown; created_at: string; updated_at: string; uploader: unknown };

// PostgREST to-one 임베딩을 supabase-js가 배열로 타이핑하는 경우 대비.
function authorNameOf(u: unknown): string | null {
  const o = Array.isArray(u) ? u[0] : u;
  return (o as { display_name?: string } | null | undefined)?.display_name ?? null;
}

/**
 * 환불 요청서 전건(최신순) — 화면 쪽 페이지네이션은 호출부 메모리 슬라이스(이력서 패턴).
 * 쌓이는 문서라 `fetchAllPaged`(1000행에서 조용히 잘리지 않게, B2) · 조회 실패는 던진다 — 빈 목록이면 "요청서 없음"으로 보인다(수정 계획 P1-M 3c).
 */
export async function getRefundRequests(): Promise<RefundListRow[]> {
  // 🔴 요청서는 restricted(계좌·환불금액) — DB는 로그인 계정 역할로만 거른다. '다른 강사 뷰'면 대상 X의 역할로 한 번 더(자료실과 같은 판정,
  //    documents/server/restricted.ts). 평소 사용자에게는 DB와 같은 결과다(같은 역할 목록).
  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  const data = await fetchAllPaged<RefundRow>((from, to) => {
    let qb = supabase
      .from("academy_documents")
      .select("id, form_data, created_at, updated_at, uploader:uploaded_by(display_name)")
      .eq("form_type", REFUND_FORM_TYPE);
    if (hideRestricted) qb = qb.eq("restricted", false);
    // 페이지 경계에서 겹치거나 빠지지 않게 같은 시각이면 id로 순서를 고정한다.
    return qb.order("created_at", { ascending: false }).order("id").range(from, to);
  });
  return data.map((r) => {
    const d = normalizeRefund(r.form_data);
    return {
      id: r.id,
      name: d.student.name || "(이름 미입력)",
      className: d.student.className,
      requestDate: d.student.requestDate,
      completedDate: d.result.completedDate,
      totalAmount: d.refund.totalAmount,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      authorName: authorNameOf(r.uploader),
    };
  });
}

// ───────── 자동입력(학생 선택 → 서식 칸 채우기) ─────────

export type RefundStudentOption = {
  id: string;
  name: string;
  schoolGrade: string;
  /** 한글 라벨(재원·휴원·퇴원…) — 목록 hint에 그대로 노출되므로 raw enum 금지. */
  statusLabel: string | null;
};

/**
 * 자동입력 picker의 학생 목록 — **퇴원생 포함**. 환불 대상은 대개 막 그만둔 학생이라
 * 재원만 담으면 정작 필요한 사람이 검색되지 않는다(교재신청 picker와 다른 이유로 다른 범위).
 * 전건이 필요한 목록이라 `fetchAllPaged` — bare select면 1000행에서 조용히 잘린다(B2).
 */
export async function getRefundStudentOptions(): Promise<RefundStudentOption[]> {
  const supabase = await createClient();
  type Raw = { id: string; name: string; school: string | null; grade: string | null; status: string | null };
  const rows = await fetchAllPaged<Raw>((from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, status")
      .order("name", { ascending: true })
      .range(from, to),
  );
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    schoolGrade: schoolGradeLabel(s.school, s.grade),
    statusLabel: studentStatusLabel(s.status),
  }));
}

// 결제내역은 **라인 단위 상세**(수납명·항목별 납부/미납/할인/수단/수납일)까지 필요하다 —
// getStudentInvoices는 라인에서 description/amount만 남기고 상세를 버리므로 여기서 따로 읽는다.
type RawInvoice = {
  period: string;
  status: string;
  amount_total: string | number;
  amount_paid: string | number;
  amount_discount: string | number;
  payment_method: string | null;
  paid_at: string | null;
  line_items: unknown;
};

/** 청구 line_items(jsonb) → 결제내역 줄 — 퇴원보고서 환불 승인(`withdrawal-reports/server/refund-actions.ts`)도 쓴다. */
export function toPrefillLines(raw: unknown): RefundPrefillInvoice["lineItems"] {
  if (!Array.isArray(raw)) return [];
  return receiptHistoryLines(raw).map((v) => {
    const li = (v ?? {}) as Record<string, unknown>;
    const num = (x: unknown) => (x === undefined || x === null ? undefined : Number(x));
    return {
      kind: String(li.kind ?? ""),
      description: String(li.description ?? li.name ?? ""),
      amount: Number(li.amount ?? 0),
      discount: num(li.discount),
      paid: num(li.paid),
      unpaid: num(li.unpaid),
      method: typeof li.method === "string" ? li.method : null,
      paidDate: typeof li.paidDate === "string" ? li.paidDate : null,
    };
  });
}

/** 자동입력 원본 — 학생 기본정보 + 수강 이력 + 청구/납부 이력(독립 조회라 Promise.all, B4). */
export async function getRefundPrefillSource(studentId: string): Promise<RefundPrefillSource | null> {
  const supabase = await createClient();
  const [{ data: student }, enrollments, { data: invoiceRows }] = await Promise.all([
    supabase.from("students").select("name, school, grade, address").eq("id", studentId).maybeSingle(),
    getStudentEnrollments(studentId),
    supabase
      .from("invoices")
      .select("period, status, amount_total, amount_paid, amount_discount, payment_method, paid_at, line_items")
      .eq("student_id", studentId)
      .order("period", { ascending: true }) // 결제내역은 오래된 달부터 — 시간순 원장으로 읽힌다
      .returns<RawInvoice[]>(),
  ]);
  if (!student) return null;
  return {
    name: student.name,
    school: student.school,
    grade: student.grade,
    address: student.address,
    // getStudentEnrollments는 start_date 내림차순 — buildRefundPrefill이 "가장 최근 1건" 폴백에 이 순서를 쓴다.
    enrollments: enrollments.map((e) => ({
      className: e.className,
      teacherName: e.teacherName,
      startDate: e.startDate,
      endDate: e.endDate,
    })),
    invoices: (invoiceRows ?? []).map((i) => ({
      period: i.period,
      status: i.status,
      amountTotal: Number(i.amount_total),
      amountPaid: Number(i.amount_paid),
      amountDiscount: Number(i.amount_discount),
      paymentMethod: i.payment_method,
      paidAt: i.paid_at,
      lineItems: toPrefillLines(i.line_items),
    })),
  };
}

export type RefundDetail = {
  id: string;
  data: RefundRequestData;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
};

export async function getRefundRequestById(id: string): Promise<RefundDetail | null> {
  // 목록과 같은 벽 — 대상 X가 못 보는 요청서는 id로 직접 열어도 없다(getRefundRequests 주석).
  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let qb = supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploader:uploaded_by(display_name)")
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE);
  if (hideRestricted) qb = qb.eq("restricted", false);
  const { data, error } = await qb.maybeSingle();
  // 조회 실패를 null로 돌리면 "없는 요청서"(404)로 보인다 — 없음과 실패를 가른다.
  if (error) {
    logDbError(error, "billing.refund.detail", { id });
    throw new Error("환불 요청서를 불러오지 못했습니다");
  }
  if (!data) return null;
  return {
    id: data.id,
    data: normalizeRefund(data.form_data),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    authorName: authorNameOf(data.uploader),
  };
}
