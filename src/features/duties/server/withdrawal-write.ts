import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import type { DutyAdminScope, WithdrawalRow } from "../view-admin";
import type { WithdrawalItem } from "../withdrawal-write";

/** 함수가 아직 없다(SQL 적용 전 — #95). 이때는 열을 세우지 않는다. */
const missing = (e: unknown) => /PGRST202|42883|duty_withdrawal_write/.test(e instanceof Error ? e.message : String(e)) && /function|schema cache|does not exist/i.test(e instanceof Error ? e.message : String(e));

/**
 * 퇴원보고서 작성 차례(s2_0093) — 업무 완성도 선생님 표의 참고 열. 등급 · 전체 · 등수에는 들지 않는다.
 * 기한이 고른 기간에 든 차례(KST)만 · 취소는 빠진다 · 합계는 DB에서(B2). 과목 범위 = 보고서 과목과 겹치면.
 * ⚠️ 참고 값이라 화면을 막지 않는다 — 함수가 없거나 읽지 못하면 로그만 남기고 열이 안 선다(평점 열과 같은 규칙).
 */
export async function loadWithdrawalWriteRows(tenantId: string, from: string, to: string, scope: DutyAdminScope): Promise<WithdrawalRow[] | undefined> {
  try {
    const rows = await fetchAllPaged<{ owner_id: string | null; subject: string | null; total: number; done: number; due: number; ontime: number; late_done: number; open_late: number }>((a, b) =>
      createAdminClient().rpc("duty_withdrawal_write_rollup", { p_tenant: tenantId, p_from: from, p_to: to, p_subjects: scope.subjects, p_owner: scope.ownerId })
        .order("owner_id").order("subject", { nullsFirst: true }).range(a, b));
    return rows.filter((r): r is typeof r & { owner_id: string } => !!r.owner_id).map((r) => ({
      ownerId: r.owner_id, subject: r.subject, total: Number(r.total), done: Number(r.done), due: Number(r.due), ontime: Number(r.ontime),
      lateDone: Number(r.late_done), late: Number(r.open_late), expired: 0, over7: 0,
    }));
  } catch (e) {
    if (!missing(e)) logDbError(e, "duties.withdrawal-write", { from, to });
    return undefined;
  }
}

/** 칸을 눌렀을 때의 근거 목록 — 그 선생님(· 그 과목)의 차례들. 학생 이름은 퇴원보고서를 볼 수 있는 사람에게만(라우트가 거른다). */
export async function loadWithdrawalWriteItems(tenantId: string, from: string, to: string, scope: DutyAdminScope, owner: string, subject: string | null): Promise<WithdrawalItem[]> {
  // 과목 범위 안에서만 좁힌다(범위 밖 과목을 주소로 달라고 해도 넓히지 않는다).
  const subjects = subject ? (scope.subjects && !scope.subjects.includes(subject) ? [] : [subject]) : scope.subjects;
  if (subjects && !subjects.length) return [];
  const rows = await fetchAllPaged<{ turn_id: number; report_id: string; turn_no: number; subjects: string[] | null; student_name: string | null; school: string | null; grade: string | null; opened_at: string; due_at: string; status: "open" | "done"; closed_at: string | null }>((a, b) =>
    createAdminClient().rpc("duty_withdrawal_write_items", { p_tenant: tenantId, p_from: from, p_to: to, p_subjects: subjects, p_owner: scope.ownerId ?? owner })
      .order("due_at").order("turn_id").range(a, b));
  return rows.map((r) => ({ id: String(r.turn_id), reportId: r.report_id, turnNo: r.turn_no, subjects: r.subjects ?? [], studentName: r.student_name, school: r.school, grade: r.grade, openedAt: r.opened_at, dueAt: r.due_at, status: r.status, closedAt: r.closed_at }));
}
