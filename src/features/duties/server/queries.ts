import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DutyItemView, DutyKind, DutyPeriod, DutyStatus } from "../kinds";

/**
 * 의무 장부 조회 — 표는 서버 전용(s2_0041 정책 0개)이라 관리 키로 읽는다. 🔴 모든 조회에 지점(tenant_id) 조건 —
 * 사람 확인(내 것 / 현황 권한)은 부르는 쪽이 `getStaffTaskViewer`로 먼저 한다(할 일과 같은 문).
 */
export type DutyCount = { ownerId: string | null; kind: string; period: DutyPeriod; total: number; done: number; late: number };

/** 담당자(없으면 전원) × 종류 집계 — 회차 창(날짜 범위) 안. DB가 센다(B2). */
export async function countDuties(tenantId: string, ownerId: string | null, from: string, to: string): Promise<DutyCount[]> {
  const { data, error } = await createAdminClient().rpc("duty_counts", { p_tenant: tenantId, p_owner: ownerId, p_from: from, p_to: to });
  if (error) throw new Error(`의무 집계: ${error.message}`);
  return ((data ?? []) as { owner_id: string | null; kind: string; period: DutyPeriod; total: number; done: number; late: number }[])
    .map((r) => ({ ownerId: r.owner_id, kind: r.kind, period: r.period, total: Number(r.total), done: Number(r.done), late: Number(r.late) }));
}

/** 접은 숫자 — 강사 홈 한 줄("오늘 내 업무 14/22 · 기한 초과 2"). void는 total에 안 든다. */
export function foldCounts(rows: readonly DutyCount[]): { total: number; done: number; late: number } {
  return rows.reduce((acc, r) => ({ total: acc.total + r.total, done: acc.done + r.done, late: acc.late + r.late }), { total: 0, done: 0, late: 0 });
}

type ItemRow = {
  id: string; kind: string; period: DutyPeriod; cycle: string; status: DutyStatus; due_at: string; student_id: string | null; class_id: string | null; subject: string | null; escalation: number;
  student: { name: string | null } | { name: string | null }[] | null; class: { class_name: string | null } | { class_name: string | null }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** 한 사람의 그날(일간 회차) 의무 목록 — 학생 이름·반 이름을 붙여 내려준다(임베드는 FK 이름 명시 · #94). */
export async function listOwnerDuties(tenantId: string, ownerId: string, cycle: string): Promise<DutyItemView[]> {
  const { data, error } = await createAdminClient().from("duty_items")
    .select("id,kind,period,cycle,status,due_at,student_id,class_id,subject,escalation,student:students!duty_items_student_id_fkey(name),class:classes!duty_items_class_id_fkey(class_name)")
    .eq("tenant_id", tenantId).eq("owner_id", ownerId).eq("cycle", cycle).neq("status", "void")
    .order("kind").order("due_at").limit(1000);
  if (error) throw new Error(`의무 목록: ${error.message}`);
  return ((data ?? []) as unknown as ItemRow[]).map((r) => ({
    id: r.id, kind: r.kind as DutyKind, period: r.period, cycle: r.cycle, status: r.status, dueAt: r.due_at,
    studentId: r.student_id, studentName: one(r.student)?.name ?? null, classId: r.class_id, className: one(r.class)?.class_name ?? null,
    subject: r.subject, escalation: r.escalation,
  }));
}
