import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { findExtraIssue, listExtraIssues } from "./extra-issues";

type Db = ReturnType<typeof createAdminClient>;
export type OwnHomework = { classId: string; studentId: string; date: string };

/**
 * 이 계정이 **낸** 영상 숙제 — 보고서의 작성 계정(`created_by`, 0172a: 처음 저장한 계정 · 남이 고쳐도 그대로 남는다)이 이 사람이고
 * '영상 과제 있음'인 수업. 원장 2026-10-03 *"강사뷰에 새 매뉴 추가. 영상 제출 현황을 내가 출제한것만"* ·
 * *"관리자뷰에서는 모두가 보이지만, 각 강사뷰에서는 내가 출제한것만"*.
 * 보고서 없이 **따로 낸 숙제**(`extra-issues.ts`)는 그 숙제의 선생님(`teacher_id`)이 이 사람인 것 — 같은 숙제 축이라 함께 센다.
 * 🔑 반이 있는 보고서만(장부 회차 = 반 × 학생). admin 클라이언트는 RLS를 우회하므로 지점·작성자로 좁힌다.
 */
export async function getOwnVideoHomework(db: Db, tenantId: string, userId: string, fromDate: string, toDate: string): Promise<OwnHomework[]> {
  return (await listVideoHomeworkIssues(db, tenantId, fromDate, toDate, userId)).map(({ classId, studentId, date }) => ({ classId, studentId, date }));
}

export type IssuedHomework = OwnHomework & { teacherIds: string[] };

/**
 * 영상 숙제를 **낸 사람** 한 벌 — 강사뷰(`getOwnVideoHomework`, 한 사람)와 관리자 화면의 강사 필터(전원 — 원장 2026-10-14
 * *"숙제 제출 현황에서 강사 필터링 가능하게 … 관리자뷰에서"*)가 같은 판정을 쓴다. 관리자 화면에서 강사를 고르면 그 강사의
 * 강사뷰와 같은 칸이 선다. 한 칸(반 × 학생 × 날짜)을 둘이 냈으면(보고서 작성자와 따로 낸 숙제의 선생님이 다름) 둘 다의 칸이다.
 */
export async function listVideoHomeworkIssues(db: Db, tenantId: string, fromDate: string, toDate: string, userId?: string): Promise<IssuedHomework[]> {
  // 🔴 한 사람 조회에 빈 id가 오면 전원으로 넓어진다(강사뷰가 남의 숙제까지) — 종전처럼 실패시킨다. 전원은 인자를 빼서만.
  if (userId !== undefined && !userId) throw new Error("숙제를 낸 사람을 확인하지 못했습니다.");
  const [rows, extra] = await Promise.all([
    fetchAllPaged<{ class_id: string | null; student_id: string; report_date: string; created_by: string | null }>((from, to) => {
      const query = db
        .from("lesson_reports").select("class_id,student_id,report_date,created_by")
        .eq("tenant_id", tenantId).eq("video_homework", true)
        .gte("report_date", fromDate).lte("report_date", toDate);
      if (userId !== undefined) query.eq("created_by", userId);
      return query.order("id", { ascending: true }).range(from, to);
    }),
    listExtraIssues(db, tenantId, { fromDate, toDate, teacherId: userId }),
  ]);
  const out = new Map<string, IssuedHomework>();
  const add = (classId: string, studentId: string, date: string, teacherId: string) => {
    const key = `${classId}:${studentId}:${date}`;
    const hit = out.get(key) ?? { classId, studentId, date, teacherIds: [] };
    if (!hit.teacherIds.includes(teacherId)) hit.teacherIds.push(teacherId);
    out.set(key, hit);
  };
  // 작성 계정을 모르는 보고서(옛 행)는 누구의 숙제도 아니다 — 한 사람 조회(`created_by = 나`)가 그 행을 안 집는 것과 같게.
  for (const row of rows) if (row.class_id && row.created_by) add(row.class_id, row.student_id, row.report_date, row.created_by);
  // 검사 기록 칸에서 옮겨 남긴 숙제(kept)는 그 강사가 낸 숙제가 아니다 — 강사뷰에 새 칸을 만들지 않는다(옮기기 전에도 안 보였다).
  for (const issue of extra) if (!issue.kept && issue.teacherId) add(issue.classId, issue.studentId, issue.date, issue.teacherId);
  return [...out.values()];
}

/** 그 칸이 이 계정이 낸 숙제인가 — 장부 체크(강사)의 서버 판정. 조회 실패는 throw(찍지 않는다). */
export async function isOwnVideoHomework(db: Db, input: { tenantId: string; userId: string; classId: string; studentId: string; date: string }): Promise<boolean> {
  const [report, extra] = await Promise.all([
    db.from("lesson_reports").select("id")
      .eq("tenant_id", input.tenantId).eq("created_by", input.userId).eq("class_id", input.classId)
      .eq("student_id", input.studentId).eq("report_date", input.date).eq("video_homework", true).limit(1),
    findExtraIssue(db, input.tenantId, input),
  ]);
  if (report.error) throw new Error("숙제를 낸 사람을 확인하지 못했습니다.");
  return (report.data ?? []).length > 0 || (!!extra && !extra.kept && extra.teacherId === input.userId);
}
