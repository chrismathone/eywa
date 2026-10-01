import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getStudentById } from "./queries";
import { dedupeHomeworkVideos, type HomeworkVideo } from "../homework-videos";

// md5는 같은 영상 두 줄을 접는 데만 쓴다(dedupeHomeworkVideos가 화면으로 내보내기 전에 뺀다). 0315a부터 있는 칸.
const COLUMNS = "id,subject,posted_at,created_at,comment_id,status,drive_file_id,bytes,md5";

export async function getStudentHomeworkVideos(studentId: string): Promise<{ ready: boolean; rows: HomeworkVideo[] }> {
  const user = await requireAccess("students");
  // service_role 조회 전 기존 학생 상세와 같은 지점·담당학생·입학정보 게이트를 통과한다.
  if (!await getStudentById(studentId)) throw new Error("학생 영상을 열람할 수 없습니다.");
  const db = createAdminClient();
  const read = async (columns: string) => dedupeHomeworkVideos(await fetchAllPaged<HomeworkVideo & { md5?: string | null }>(async (from, to) => {
    const { data, error } = await db.from("student_homework_videos")
      .select(columns)
      .eq("tenant_id", user.tenantId).eq("student_id", studentId)
      .order("posted_at", { ascending: false, nullsFirst: false }).order("id").range(from, to);
    if (error) throw error;
    return { data: data as unknown as (HomeworkVideo & { md5?: string | null })[] | null, error: null };
  }));
  try {
    try {
      return { ready: true, rows: await read(`${COLUMNS},source`) };
    } catch (error) {
      // 0324a(출처 칸) 전 DB — 옛 칸만 읽는다(#95). 출처가 비면 화면은 ClassNote 글·댓글로 표시한다.
      if ((error as { code?: string }).code !== "42703") throw error;
      return { ready: true, rows: await read(COLUMNS) };
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return { ready: false, rows: [] };
    throw error;
  }
}
