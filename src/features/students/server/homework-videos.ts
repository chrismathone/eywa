import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getStudentById } from "./queries";
import type { HomeworkVideo } from "../homework-videos";

export async function getStudentHomeworkVideos(studentId: string): Promise<{ ready: boolean; rows: HomeworkVideo[] }> {
  const user = await requireAccess("students");
  // service_role 조회 전 기존 학생 상세와 같은 지점·담당학생·입학정보 게이트를 통과한다.
  if (!await getStudentById(studentId)) throw new Error("학생 영상을 열람할 수 없습니다.");
  const db = createAdminClient();
  try {
    const rows = await fetchAllPaged<HomeworkVideo>(async (from, to) => {
      const result = await db.from("student_homework_videos")
        .select("id,subject,posted_at,created_at,comment_id,status,drive_file_id,bytes")
        .eq("tenant_id", user.tenantId).eq("student_id", studentId)
        .order("posted_at", { ascending: false, nullsFirst: false }).order("id").range(from, to);
      if (result.error) throw result.error;
      return result;
    });
    return { ready: true, rows };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return { ready: false, rows: [] };
    throw error;
  }
}
