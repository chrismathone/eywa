import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { homeworkVideoSource } from "@/features/video-homework/server/video-source";

/**
 * 끊긴 업로드가 **이미 올라간 영상**을 다시 올리던 것인가 — 그러면 선생님께 "업로드 확인 필요" 알림을 보내지 않는다(원장 2026-10-17).
 * 실측(10/16): 한 학생이 16:18에 제출을 마친 828MB 영상을 16:40에 다시 올리다 0.8초 만에 화면을 떠났고, 그 중단이 선생님 벨로 갔다.
 *
 * 같은 영상 = 같은 학생 · 같은 바이트 수 · 저장이 끝난 영상(Drive 파일 있음) · 반려되지 않음(`route.excluded`). 업로드 시작 때는
 * 내용 지문(md5)이 없어 바이트 수로 본다 — 수백 MB 영상에서 바이트까지 같은 다른 영상은 사실상 없다. 반려한 영상은 다시 올려야 하는
 * 영상이라 끊기면 알린다. 조회 실패는 `false`(알림을 보낸다 — 알릴 일을 놓치는 쪽이 더 나쁘다).
 */
export async function alreadyUploadedSameVideo(db: ReturnType<typeof createAdminClient>,
  input: { tenantId: string; studentId: string | null; bytes: number }): Promise<boolean> {
  if (!input.studentId || !Number.isSafeInteger(input.bytes) || input.bytes <= 0) return false;
  try {
    const source = await homeworkVideoSource(db);
    const { data, error } = await db.from(source).select("id,route")
      .eq("tenant_id", input.tenantId).eq("student_id", input.studentId).eq("bytes", input.bytes)
      .eq("status", "uploaded").not("drive_file_id", "is", null).limit(20);
    if (error) return false;
    return ((data ?? []) as Array<{ route: unknown }>).some((row) => {
      const route = row.route && typeof row.route === "object" ? (row.route as Record<string, unknown>) : {};
      return route.excluded !== true;
    });
  } catch {
    return false;
  }
}
