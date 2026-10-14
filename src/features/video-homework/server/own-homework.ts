import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
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
type ReportRow = { class_id: string | null; student_id: string; report_date: string; created_by: string | null; video_homework: boolean | null };
const keyOf = (classId: string, studentId: string, date: string) => `${classId}:${studentId}:${date}`;

/**
 * 영상 숙제를 **낸 사람** 한 벌 — 강사뷰(`getOwnVideoHomework`, 한 사람)와 관리자 화면의 강사 필터(전원 — 원장 2026-10-14
 * *"숙제 제출 현황에서 강사 필터링 가능하게 … 관리자뷰에서"*)가 같은 판정을 쓴다. 관리자 화면에서 강사를 고르면 그 강사의
 * 강사뷰와 같은 칸이 선다. 한 칸(반 × 학생 × 날짜)을 둘이 냈으면(보고서 작성자와 따로 낸 숙제의 선생님이 다름) 둘 다의 칸이다.
 *  ① '영상 과제 있음' 보고서 = 작성자 · ② 따로 낸 숙제 = 그 선생님 ·
 *  ③ 둘 다 없는 칸이 **검사 기록**이나 **옮겨 남긴 숙제**(kept)로 서 있으면 그날 보고서를 쓴 사람(원장 2026-10-14 *"필터하면 2회, 필터 안하면 3회"*
 *     — 이준형 10/1이 강사 필터에서만 빠졌다 → '강사 필터 + 강사뷰 둘 다'). kept에 적힌 선생님(`teacher_id`)은 기록용이다 — 그날 보고서가
 *     없으면 지금 담임·누른 사람이 적혀, 그 값을 쓰면 누르는 순간 칸 주인이 바뀐다(적대적 리뷰 2026-10-14).
 *  🔴 ②가 있는 칸에 ③을 걸지 말 것: 그날 보고서를 쓴 다른 선생님이 남이 낸 정식 숙제를 체크·반려할 수 있게 된다(적대적 리뷰 2026-10-14).
 * 🔑 판정(자동 판정 · 미제출 알림 · 운영실 집계)은 여기와 무관하다 — kept · 검사 기록 칸은 여전히 판정 밖이다(extra-issues.ts).
 */
export async function listVideoHomeworkIssues(db: Db, tenantId: string, fromDate: string, toDate: string, userId?: string): Promise<IssuedHomework[]> {
  // 🔴 한 사람 조회에 빈 id가 오면 전원으로 넓어진다(강사뷰가 남의 숙제까지) — 종전처럼 실패시킨다. 전원은 인자를 빼서만.
  if (userId !== undefined && !userId) throw new Error("숙제를 낸 사람을 확인하지 못했습니다.");
  // 보고서 조회 한 벌 — '영상 과제 있음' 전부, 또는 학생 몇 명의 그 기간(③). 한 사람 조회면 작성자로 좁힌다.
  const reportsOf = (narrow: { students: string[]; first: string; last: string } | null) => (from: number, to: number) => {
    let query = db.from("lesson_reports").select("class_id,student_id,report_date,created_by,video_homework").eq("tenant_id", tenantId);
    query = narrow ? query.in("student_id", narrow.students).gte("report_date", narrow.first).lte("report_date", narrow.last)
      : query.eq("video_homework", true).gte("report_date", fromDate).lte("report_date", toDate);
    if (userId !== undefined) query = query.eq("created_by", userId);
    return query.order("id", { ascending: true }).range(from, to);
  };
  const [flagged, extra, marks] = await Promise.all([
    fetchAllPaged<ReportRow>(reportsOf(null)),
    // ②가 있는 칸은 ③에서 빼야 해서 선생님으로 좁히지 않는다(남이 낸 숙제도 알아야 한다).
    listExtraIssues(db, tenantId, { fromDate, toDate }),
    fetchAllPaged<{ class_id: string; student_id: string; homework_date: string }>((from, to) => db
      .from("video_homework_marks").select("class_id,student_id,homework_date")
      .eq("tenant_id", tenantId).gte("homework_date", fromDate).lte("homework_date", toDate)
      .order("id", { ascending: true }).range(from, to)),
  ]);
  const out = new Map<string, IssuedHomework>();
  const add = (classId: string, studentId: string, date: string, teacherId: string) => {
    const key = keyOf(classId, studentId, date);
    const hit = out.get(key) ?? { classId, studentId, date, teacherIds: [] };
    if (!hit.teacherIds.includes(teacherId)) hit.teacherIds.push(teacherId);
    out.set(key, hit);
  };
  // ① 작성 계정을 모르는 보고서(옛 행)는 누구의 숙제도 아니다 — 한 사람 조회(`created_by = 나`)가 그 행을 안 집는 것과 같게.
  for (const row of flagged) if (row.class_id && row.created_by) add(row.class_id, row.student_id, row.report_date, row.created_by);
  // ②
  const issued = new Set<string>();
  for (const issue of extra) if (!issue.kept) {
    issued.add(keyOf(issue.classId, issue.studentId, issue.date));
    if (issue.teacherId && (userId === undefined || issue.teacherId === userId)) add(issue.classId, issue.studentId, issue.date, issue.teacherId);
  }
  // ③ 그런 칸의 학생만 골라 그날 보고서를 읽는다 — 표시 없는 보고서 전부를 읽지 않는다(지점 1년치면 수십 번 왕복, 적대적 리뷰 2026-10-14).
  const standing = new Set<string>();
  for (const mark of marks) standing.add(keyOf(mark.class_id, mark.student_id, mark.homework_date));
  for (const issue of extra) if (issue.kept) standing.add(keyOf(issue.classId, issue.studentId, issue.date));
  for (const key of [...issued, ...out.keys()]) standing.delete(key);
  if (!standing.size) return [...out.values()];
  const students = [...new Set([...standing].map((key) => key.split(":")[1]))];
  const dates = [...standing].map((key) => key.split(":")[2]).sort();
  const reports = await fetchAllPagedInChunks<ReportRow>(students, (chunk, from, to) =>
    reportsOf({ students: chunk, first: dates[0], last: dates[dates.length - 1] })(from, to));
  for (const row of reports) if (row.class_id && row.created_by && row.video_homework !== true && standing.has(keyOf(row.class_id, row.student_id, row.report_date)))
    add(row.class_id, row.student_id, row.report_date, row.created_by);
  return [...out.values()];
}

/**
 * 그 칸이 이 계정이 낸 숙제인가 — 장부 체크(강사)의 서버 판정. 조회 실패는 throw(찍지 않는다).
 * `listVideoHomeworkIssues`와 같은 판정이다: ① 내가 쓴 보고서가 '영상 과제 있음' · ② 내가 선생님인 따로 낸 숙제 ·
 * ③ ②가 없는 칸이 검사 기록이나 옮겨 남긴 숙제로 서 있고 그날 보고서를 내가 썼다.
 */
export async function isOwnVideoHomework(db: Db, input: { tenantId: string; userId: string; classId: string; studentId: string; date: string }): Promise<boolean> {
  const [report, extra, mark] = await Promise.all([
    db.from("lesson_reports").select("video_homework")
      .eq("tenant_id", input.tenantId).eq("created_by", input.userId).eq("class_id", input.classId)
      .eq("student_id", input.studentId).eq("report_date", input.date).limit(5),
    findExtraIssue(db, input.tenantId, input),
    db.from("video_homework_marks").select("id")
      .eq("tenant_id", input.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId).eq("homework_date", input.date).limit(1),
  ]);
  if (report.error || mark.error) throw new Error("숙제를 낸 사람을 확인하지 못했습니다.");
  const mine = (report.data ?? []) as { video_homework: boolean | null }[];
  if (mine.some((row) => row.video_homework === true)) return true;
  if (extra && !extra.kept) return extra.teacherId === input.userId;
  return mine.length > 0 && ((mark.data ?? []).length > 0 || !!extra?.kept);
}
