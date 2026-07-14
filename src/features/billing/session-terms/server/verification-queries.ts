import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getSessionTermsView } from "./queries";
import { classifyVerification, type VerificationStatus } from "../verification";
export type { VerificationStatus } from "../verification";

/** 시수 검증 한 행 — 회차 확정(청구값) × 실 소비 출석 대조(read-only). subject는 raw key(라벨은 소비처가 buildSubjectMaps로). */
export type VerificationRow = {
  id: string;
  invoiceId: string;
  studentName: string;
  studentGrade: string | null;
  subject: string;
  className: string | null;
  confirmedSessions: number | null;
  plannedSessions: number | null; // 미확정 행에 참고로 회색 표시
  actualConsumed: number; // 실 소비 출석(유효 present/late/early_leave/makeup)
  status: VerificationStatus;
  diff: number | null;
  note: string | null;
};

export type VerificationView = {
  rows: VerificationRow[];
  counts: Record<VerificationStatus, number> & { total: number };
};

/**
 * 청구월의 회차 확정 × 실 출석 대조. 확정값(청구값)만 검증 분자(N1), diff는 신호일 뿐 자동수정 없음(N2).
 * (B2: RPC 결과는 fetchAllPaged 페이징 / B4: 회차 확정 조회와 출석 RPC는 독립 → Promise.all)
 */
export async function getSessionVerificationView(period: string): Promise<VerificationView> {
  const supabase = await createClient();

  const [view, attendance] = await Promise.all([
    getSessionTermsView(period),
    fetchAllPaged<{ invoice_id: string; class_id: string; consumed: number }>((from, to) =>
      supabase.rpc("session_term_attendance", { p_period: period }).range(from, to),
    ),
  ]);

  // 회차 확정 행은 (invoice_id, class_id) 유니크 → 실출석도 같은 키로 조인.
  const consumedByKey = new Map(
    attendance.map((a) => [`${a.invoice_id}:${a.class_id}`, Number(a.consumed) || 0]),
  );

  const rows: VerificationRow[] = view.rows.map((r) => {
    const actual = r.classId ? (consumedByKey.get(`${r.invoiceId}:${r.classId}`) ?? 0) : 0;
    const { status, diff } = classifyVerification(r.confirmedSessions, actual);
    return {
      id: r.id,
      invoiceId: r.invoiceId,
      studentName: r.studentName,
      studentGrade: r.studentGrade,
      subject: r.subject,
      className: r.className,
      confirmedSessions: r.confirmedSessions,
      plannedSessions: r.plannedSessions,
      actualConsumed: actual,
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
    total: rows.length,
  };

  return { rows, counts };
}
