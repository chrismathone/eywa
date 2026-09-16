import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getSessionTermsView } from "./queries";
import { classifyVerification, type VerificationStatus } from "../verification";
import type { SessionPricingMode } from "../../session-pricing";
export type { VerificationStatus } from "../verification";

/**
 * 회차 검증 한 행 — 회차 확정(청구값) × **실 소비 회차** 대조(read-only). subject는 raw key(라벨은 소비처가 buildSubjectMaps로).
 *
 * 0267a부터 새 확정은 출석부 시수 합. 기존 확정은 저장한 quantity_basis의 일수 기준을 유지한다.
 */
export type VerificationRow = {
  pricingMode: SessionPricingMode;
  id: string;
  invoiceId: string;
  studentName: string;
  studentGrade: string | null;
  subject: string;
  classId: string | null; // splits 저장 키(invoice×class) — 반 미상 행은 분배 스킵
  className: string | null;
  // 강사별 분배(참고) 집계용 — 반 담당 강사(표시 전용, 저장 없음). 그룹 키는 id(동명이인 병합 방지).
  teacherId: string | null;
  teacherName: string | null;
  confirmedSessions: number | null;
  plannedSessions: number | null; // 미확정 행에 참고로 회색 표시
  unitPrice: number | null;
  amount: number | null; // 확정 시점 저장 금액(회차×단가)
  actualConsumed: number; // 확정 시점 quantity_basis에 맞춘 출석 소비량
  quantityBasis?: "days" | "attendance_units";
  status: VerificationStatus;
  diff: number | null;
  note: string | null;
  allocatedAmount?: number | null;
  allocationStale?: boolean;
};

export type VerificationView = {
  rows: VerificationRow[];
  counts: Record<VerificationStatus, number> & { total: number };
};

/**
 * 청구월의 확정량 × 같은 단위의 실 출석 대조. diff는 신호일 뿐 자동수정 없음(N2).
 * (B2: RPC 결과는 fetchAllPaged 페이징 / B3: 반→강사 조회는 청크 / B4: 강사 조회는 view에만 의존하므로
 *  view 체인 안에서 이어 붙여 출석 RPC와 병렬로 겹친다 — 직렬 왕복 추가 없음.)
 */
export async function getSessionVerificationView(period: string): Promise<VerificationView> {
  const supabase = await createClient();

  type TeacherRef = { id: string; name: string | null };
  const [{ view, teacherByClassId }, attendance] = await Promise.all([
    getSessionTermsView(period).then(async (view) => {
      // 반 담당 강사(분배 참고 집계용) — 대상 반만 청크 조회(B3). id가 그룹 키(동명이인 병합 방지).
      const classIds = [...new Set(view.rows.map((r) => r.classId).filter((id): id is string => !!id))];
      const classTeachers = await fetchInChunks<{
        id: string;
        teacher: { id?: string; display_name?: string } | { id?: string; display_name?: string }[] | null;
      }>(classIds, (chunk) =>
        supabase.from("classes").select("id, teacher:teacher_id ( id, display_name )").in("id", chunk),
      );
      const teacherByClassId = new Map<string, TeacherRef | null>(
        classTeachers.map((c) => {
          const t = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
            | { id?: string; display_name?: string }
            | undefined;
          return [c.id, t?.id ? { id: t.id, name: t.display_name ?? null } : null];
        }),
      );
      return { view, teacherByClassId };
    }),
    fetchAllPaged<{ invoice_id: string; class_id: string; consumed: number | string }>((from, to) =>
      supabase.rpc("session_term_attendance", { p_period: period }).range(from, to),
    ),
  ]);

  // 회차 확정 행은 (invoice_id, class_id) 유니크 → 실출석도 같은 키로 조인.
  // consumed는 numeric — 문자열로 올 수 있어 Number 변환.
  const consumedByKey = new Map(
    attendance.map((a) => [`${a.invoice_id}:${a.class_id}`, Number(a.consumed) || 0]),
  );

  const rows: VerificationRow[] = view.rows.map((r) => {
    const actual = r.classId ? (consumedByKey.get(`${r.invoiceId}:${r.classId}`) ?? 0) : 0;
    const { status, diff } = classifyVerification(r.confirmedSessions, actual, r.pricingMode);
    const teacher = r.classId ? (teacherByClassId.get(r.classId) ?? null) : null;
    return {
      pricingMode: r.pricingMode,
      id: r.id,
      invoiceId: r.invoiceId,
      studentName: r.studentName,
      studentGrade: r.studentGrade,
      subject: r.subject,
      classId: r.classId,
      className: r.className,
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.name ?? null,
      confirmedSessions: r.confirmedSessions,
      plannedSessions: r.plannedSessions,
      unitPrice: r.unitPrice,
      amount: r.amount,
      allocatedAmount: r.allocatedAmount,
      allocationStale: r.allocationStale,
      actualConsumed: actual,
      quantityBasis: r.quantityBasis,
      status,
      diff,
      note: r.note,
    };
  });

  const counts = {
    matched: rows.filter((r) => r.status === "matched").length,
    short: rows.filter((r) => r.status === "short").length,
    over: rows.filter((r) => r.status === "over").length,
    unconfirmed: rows.filter((r) => r.status === "unconfirmed").length,
    monthly: rows.filter((r) => r.status === "monthly").length,
    total: rows.length,
  };

  return { rows, counts };
}
