import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getSessionTermsView, type SessionTermRow } from "./queries";
import { classifyVerification, type VerificationStatus } from "../verification";
import type { SessionPricingMode } from "../../session-pricing";
import type { TermRowState } from "../month-roster";
import { carryBlocksSplits, netAllocatedAmount } from "../money-carryover";
import { freeSavedInvoiceIds } from "../free-allocation";
export type { VerificationStatus } from "../verification";

/**
 * 회차 검증 한 행 — 회차 확정(청구값) × **실 소비 회차** 대조(read-only). subject는 raw key(라벨은 소비처가 buildSubjectMaps로).
 *
 * 0267a부터 새 확정은 출석부 시수 합. 기존 확정은 저장한 quantity_basis의 일수 기준을 유지한다.
 * 회차 행이 없는 줄(`termState: "missing"`, 출석부엔 있는데 행이 없는 학생)도 미확정 행으로 선다 — 실 소비는 줄 집합이 센
 * 그 달 시수(`recordedUnits`)다(RPC 0267a는 회차 행 기준이라 그 줄이 없다).
 * ⚠️ 청구서가 없거나 취소된 줄은 여기 없다 — 확정·분배할 청구서가 없어 대조할 것이 없다(회차 확정 면에만 '청구서 없음'으로 선다).
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
  /** 이 청구서는 관리자가 자유 배분으로 저장했다(0279a) — 재확인이 떠도 **관리자만** 풀 수 있다(다른 사람의 항목별 저장은 잠겨 있다). */
  freeAllocationSaved?: boolean;
  /** 줄의 회차 상태 — `missing`이면 회차 행이 아직 없는 줄(확정하는 순간 만들어진다). */
  termState: TermRowState;
};

export type VerificationView = {
  rows: VerificationRow[];
  counts: Record<VerificationStatus, number> & { total: number };
  /**
   * 금액 이월 때문에 **분배를 저장하면 안 되는** 사정(0278a) — 조회 실패(`carryFailed`) · 받을 줄이 없는 이월이 있는 학생.
   * `saveTeacherSplits`가 이 값으로 거절한다(두 달 스냅샷에 같은 돈이 두 번/0번 들어가지 않게).
   */
  carryFailed?: boolean;
  carryBlockedStudents?: string[];
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

  // 청구서가 있는 줄만(회차 행 + `missing` 가상 행) — 분배 저장(`computeSplitRows`)이 invoice×class를 키로 쓴다.
  const withInvoice = view.rows.filter((r): r is SessionTermRow & { invoiceId: string } => r.invoiceId !== null);
  const freeInvoices = freeSavedInvoiceIds(view.rows);
  const rows: VerificationRow[] = withInvoice.map((r) => {
    // 가상 행은 RPC 결과에 없다(회차 행 기준) — 줄 집합이 센 그 달 시수가 실 소비.
    const actual = r.termState !== "term" ? (r.recordedUnits ?? 0) : r.classId ? (consumedByKey.get(`${r.invoiceId}:${r.classId}`) ?? 0) : 0;
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
      // 분배·검증의 실납 = 배분액 − 보낸 이월 + 받은 이월(0278a, 원장 2026-09-21 "수납액 분배에도 반영"). 배분 원본은 회차 확정 면이 들고 있다.
      allocatedAmount: netAllocatedAmount(r),
      allocationStale: r.allocationStale,
      freeAllocationSaved: freeInvoices.has(r.invoiceId),
      actualConsumed: actual,
      quantityBasis: r.quantityBasis,
      status,
      diff,
      note: r.note,
      termState: r.termState,
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

  const carryBlockedStudents = [...new Set(withInvoice.filter((r) => carryBlocksSplits(r)).map((r) => r.studentName))];
  return { rows, counts, carryFailed: view.carryFailed, carryBlockedStudents };
}
