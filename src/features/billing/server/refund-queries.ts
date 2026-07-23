import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getStudentEnrollments, getStudentInvoices } from "@/features/students/server/queries";
import { studentStatusLabel } from "@/features/students/status-labels";
import { normalizeRefund, REFUND_FORM_TYPE, type RefundRequestData } from "../refund-request";
import type { RefundPrefillSource } from "../refund-prefill";

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

// PostgREST to-one 임베딩을 supabase-js가 배열로 타이핑하는 경우 대비.
function authorNameOf(u: unknown): string | null {
  const o = Array.isArray(u) ? u[0] : u;
  return (o as { display_name?: string } | null | undefined)?.display_name ?? null;
}

/** 환불 요청서 전건(최신순) — 건수가 작아 소량, 페이지네이션은 호출부 메모리 슬라이스(이력서 패턴). */
export async function getRefundRequests(): Promise<RefundListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploader:uploaded_by(display_name)")
    .eq("form_type", REFUND_FORM_TYPE)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
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

/** 자동입력 원본 — 학생 기본정보 + 수강 이력 + 납부 이력(독립 조회라 Promise.all, B4). */
export async function getRefundPrefillSource(studentId: string): Promise<RefundPrefillSource | null> {
  const supabase = await createClient();
  const [{ data: student }, enrollments, invoices] = await Promise.all([
    supabase.from("students").select("name, school, grade, address").eq("id", studentId).maybeSingle(),
    getStudentEnrollments(studentId),
    getStudentInvoices(studentId),
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
    // period 내림차순(getStudentInvoices) 유지 — 최근 납부부터 3건만 서식에 들어간다.
    payments: invoices.map((i) => ({ period: i.period, amountPaid: i.amountPaid })),
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploader:uploaded_by(display_name)")
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    data: normalizeRefund(data.form_data),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    authorName: authorNameOf(data.uploader),
  };
}
