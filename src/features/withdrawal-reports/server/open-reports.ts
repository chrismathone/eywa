import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { CourseSnapshot, StudentOption } from "../model";

/** 학생마다 진행 중인 퇴원보고서가 맡은 과목 — `all` = 학생 전체를 맡았다(퇴원 묶음 · 옛 단건 보고서). */
export type OpenReportScope = { subjects: Set<string>; all: boolean };

/**
 * 진행 중인 퇴원보고서(완료·취소 전)를 학생별로 — 요청 창이 **같은 과목**의 반만 빼고 보여 주게(s2_0014 — 원장 2026-11-02
 * *"과목 다르면 안 막히게"*). 막는 규칙의 원본은 DB 요청·바로 처리 함수다(같은 과목 · 진행 중인 퇴원 묶음 · 옛 단건 보고서).
 */
export async function loadOpenReportScopes(tenantId: string): Promise<Map<string, OpenReportScope>> {
  const db = createAdminClient();
  const [groups, singles] = await Promise.all([
    fetchAllPaged<{ id: string; student_id: string; subjects: string[] | null; exit_kind: string }>((from, to) =>
      db.from("withdrawal_report_groups").select("id,student_id,subjects,exit_kind").eq("tenant_id", tenantId)
        .not("status", "in", "(completed,canceled)").order("id").range(from, to)),
    fetchAllPaged<{ id: string; student_id: string }>((from, to) =>
      db.from("withdrawal_reports").select("id,student_id").eq("tenant_id", tenantId).is("group_id", null)
        .not("status", "in", "(completed,canceled)").order("id").range(from, to)),
  ]);
  const map = new Map<string, OpenReportScope>();
  const at = (id: string) => map.get(id) ?? map.set(id, { subjects: new Set(), all: false }).get(id)!;
  for (const g of groups) {
    const scope = at(g.student_id);
    if (g.exit_kind === "withdrawal") scope.all = true;
    for (const s of g.subjects ?? []) scope.subjects.add(s);
  }
  for (const r of singles) at(r.student_id).all = true;
  return map;
}

/**
 * 요청 창의 학생 한 명 — 진행 중인 과목의 반은 `busyCourses`로 옮긴다. 고를 반이 남지 않으면(또는 학생 전체가 진행 중이면) null.
 * 다니는 반이 원래 없는 학생(바로 처리 퇴원)은 진행 중인 보고서가 없을 때만 남긴다(DB도 같은 규칙).
 */
export function withOpenReports(student: StudentOption, scope: OpenReportScope | undefined): StudentOption | null {
  if (!scope) return student;
  if (scope.all) return null;
  const busyCourses: CourseSnapshot[] = student.courses.filter(c => scope.subjects.has(c.subject));
  const courses = student.courses.filter(c => !scope.subjects.has(c.subject));
  if (courses.length === 0) return null;
  return busyCourses.length ? { ...student, courses, busyCourses } : student;
}
