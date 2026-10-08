import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudentById } from "./queries";
import { readUploadDiagnostics } from "@/features/video-submit/upload-diagnostics";
import type { HomeworkUploadAttempt } from "../homework-upload-log";

const BASE = "id,created_at,completed_at,status,video_id,bytes,homework_video_links!inner(student_id,class_id,classes(class_name)),homework_date:route->>homeworkDate";
export async function getStudentUploadLog(studentId: string): Promise<{ ready: boolean; rows: HomeworkUploadAttempt[] }> {
  const user = await requireAccess("students");
  if (!await getStudentById(studentId)) throw new Error("학생 업로드 기록을 열람할 수 없습니다.");
  const db = createAdminClient();
  const read = (columns: string) => db.from("homework_video_link_uploads").select(columns)
    .eq("tenant_id", user.tenantId).eq("homework_video_links.student_id", studentId)
    .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order("created_at", { ascending: false }).limit(30);
  try {
    let result = await read(`${BASE},client_diagnostics`);
    if (result.error && ["42703", "PGRST204"].includes(result.error.code)) result = await read(BASE);
    if (result.error) return { ready: false, rows: [] };
    // Explicit projection: never return a submission token, Drive session URL or raw error text.
    const rows = (result.data ?? []) as unknown as Array<{ id: string; created_at: string; completed_at: string | null; status: string; video_id: string | null; bytes: number; homework_date: string | null; client_diagnostics?: unknown;
      homework_video_links: { classes: { class_name: string } | null } }>;
    return { ready: true, rows: rows.map(row => ({ id: row.id, createdAt: row.created_at, completedAt: row.completed_at,
      status: row.status, hasVideo: !!row.video_id, bytes: Number(row.bytes), className: row.homework_video_links.classes?.class_name ?? "반 정보 없음",
      homeworkDate: row.homework_date, diagnostics: readUploadDiagnostics(row.client_diagnostics) })) };
  } catch { return { ready: false, rows: [] }; }
}
