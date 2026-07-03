import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeRefund, REFUND_FORM_TYPE, type RefundRequestData } from "../refund-request";

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
