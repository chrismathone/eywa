import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import { exitCountDate, paidSubjectMonths, paidTuitionMonths, subjectExitCountDate, type PaidTuitionRow } from "../exit-month";

/**
 * 학생들의 수업료 청구(낸 것만) — 지점마다 · 청크 × 페이징(B2·B3) · 실패하면 던진다(대체값으로 다른 달에 세지 않는다).
 * 🔴 청구는 admin으로 읽는다 — 청구 표는 수납 권한이 있어야 보여서(0158a) 사용자 클라이언트로 읽으면 사람마다 퇴원월이 갈린다.
 *    RLS 우회라 `tenant_id`로 좁힌다([[#104]]) — 지점은 학생 행(사용자가 볼 수 있는 행)에서 가져온다.
 */
async function loadPaidTuition(
  students: readonly { id: string; tenantId: string; date: string }[],
): Promise<Map<string, PaidTuitionRow[]>> {
  const byStudent = new Map<string, PaidTuitionRow[]>();
  if (!students.length) return byStudent;
  const db = createAdminClient();
  const byTenant = new Map<string, Map<string, string>>();
  for (const s of students) {
    const ids = byTenant.get(s.tenantId) ?? byTenant.set(s.tenantId, new Map()).get(s.tenantId)!;
    if (!ids.has(s.id) || s.date > ids.get(s.id)!) ids.set(s.id, s.date);
  }
  await Promise.all(
    [...byTenant].map(async ([tenantId, ids]) => {
      const lastMonth = [...ids.values()].reduce((m, d) => (d.slice(0, 7) > m ? d.slice(0, 7) : m), "");
      const rows = await fetchAllPagedInChunks<PaidTuitionRow>([...ids.keys()], (chunk, from, to) =>
        db
          .from("invoices")
          .select("student_id,period,status,category,amount_paid,line_items")
          .eq("tenant_id", tenantId)
          .eq("category", "tuition")
          .not("status", "in", "(void,refunded)")
          .gt("amount_paid", 0)
          .lte("period", lastMonth)
          .in("student_id", chunk)
          .order("id")
          .range(from, to),
      );
      for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r]);
    }),
  );
  return byStudent;
}

/**
 * 퇴원생마다 **기간 판정 날짜**(`exitCountDate` — 수강료를 낸 마지막 달 기준, 원장 2026-10-29). 운영실·퇴원관리·원생 통계·퇴원 시트가 이 한 함수를 쓴다.
 */
export async function loadExitCountDates(
  students: readonly { id: string; tenantId: string; withdrawnAt: string | null }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dated = students.filter((s): s is typeof s & { withdrawnAt: string } => !!s.withdrawnAt);
  const paid = await loadPaidTuition(dated.map((s) => ({ id: s.id, tenantId: s.tenantId, date: s.withdrawnAt })));
  for (const s of dated) out.set(s.id, exitCountDate(s.withdrawnAt, paidTuitionMonths(paid.get(s.id) ?? [])));
  return out;
}

/**
 * 과목 수강종료마다 기간 판정 날짜(`subjectExitCountDate` — 그 과목 수업료를 낸 마지막 달, 원장 2026-10-29) — 열쇠 `학생id|과목키`.
 * 운영실 '퇴원&수업종료'·퇴원관리·퇴원 시트(수학 수강종료)가 쓴다. 청구를 읽는 법은 퇴원과 같다.
 */
export async function loadSubjectExitCountDates(
  ends: readonly { studentId: string; tenantId: string; subject: string; endedAt: string | null; since?: string | null }[],
  subjects: readonly ProgramSubject[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dated = ends.filter((e): e is typeof e & { endedAt: string } => !!e.endedAt);
  const paid = await loadPaidTuition(dated.map((e) => ({ id: e.studentId, tenantId: e.tenantId, date: e.endedAt })));
  const bySubject = new Map<string, Map<string, string[]>>();
  for (const e of dated) {
    const months = bySubject.get(e.studentId) ?? bySubject.set(e.studentId, paidSubjectMonths(paid.get(e.studentId) ?? [], subjects)).get(e.studentId)!;
    out.set(`${e.studentId}|${e.subject}`, subjectExitCountDate(e.endedAt.slice(0, 10), e.subject, months, subjects, e.since));
  }
  return out;
}
