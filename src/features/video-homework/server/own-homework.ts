import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";

type Db = ReturnType<typeof createAdminClient>;
export type OwnHomework = { classId: string; studentId: string; date: string };

/**
 * 이 계정이 **낸** 영상 숙제 — 보고서의 작성 계정(`created_by`, 0172a: 처음 저장한 계정 · 남이 고쳐도 그대로 남는다)이 이 사람이고
 * '영상 과제 있음'인 수업. 원장 2026-10-03 *"강사뷰에 새 매뉴 추가. 영상 제출 현황을 내가 출제한것만"* ·
 * *"관리자뷰에서는 모두가 보이지만, 각 강사뷰에서는 내가 출제한것만"*.
 * 🔑 반이 있는 보고서만(장부 회차 = 반 × 학생). admin 클라이언트는 RLS를 우회하므로 지점·작성자로 좁힌다.
 */
export async function getOwnVideoHomework(db: Db, tenantId: string, userId: string, fromDate: string, toDate: string): Promise<OwnHomework[]> {
  const rows = await fetchAllPaged<{ class_id: string | null; student_id: string; report_date: string }>((from, to) => db
    .from("lesson_reports").select("class_id,student_id,report_date")
    .eq("tenant_id", tenantId).eq("created_by", userId).eq("video_homework", true)
    .gte("report_date", fromDate).lte("report_date", toDate)
    .order("id", { ascending: true }).range(from, to));
  return rows.flatMap((row) => (row.class_id ? [{ classId: row.class_id, studentId: row.student_id, date: row.report_date }] : []));
}

/** 그 칸이 이 계정이 낸 숙제인가 — 장부 체크(강사)의 서버 판정. 조회 실패는 throw(찍지 않는다). */
export async function isOwnVideoHomework(db: Db, input: { tenantId: string; userId: string; classId: string; studentId: string; date: string }): Promise<boolean> {
  const { data, error } = await db.from("lesson_reports").select("id")
    .eq("tenant_id", input.tenantId).eq("created_by", input.userId).eq("class_id", input.classId)
    .eq("student_id", input.studentId).eq("report_date", input.date).eq("video_homework", true).limit(1);
  if (error) throw new Error("숙제를 낸 사람을 확인하지 못했습니다.");
  return (data ?? []).length > 0;
}
