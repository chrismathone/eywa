"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { reportViewer } from "./queries";
import { getArchive } from "./archives";
const mapping = z.object({ id: z.uuid(), studentId: z.uuid().nullable(), revision: z.number().int().positive() });
export async function mapArchive(input: unknown) {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "기존 기록을 연결할 권한이 없습니다." };
  const parsed = mapping.safeParse(input);
  if (!parsed.success) return { error: "연결할 학생을 확인해 주세요." };
  const archive = await getArchive(parsed.data.id);
  if (!archive) return { error: "기록에 접근할 수 없습니다." };
  const { error } = await createAdminClient().rpc("map_withdrawal_report_archive", { p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_archive: parsed.data.id, p_student: parsed.data.studentId, p_revision: parsed.data.revision });
  if (error) return { error: describeDbError(error, { fallback: "학생 연결을 저장하지 못했습니다." }).message };
  // 감사로그 — studentId null = 연결 해제. 이전 연결은 RPC의 revision 확인을 통과한 그 읽기 값이다.
  await logAction({ action: "withdrawal_report_archive_map", targetType: "withdrawal_report_archive", targetLabel: archive.student_name,
    metadata: { archiveId: archive.id, studentId: parsed.data.studentId, previousStudentId: archive.mapped_student_id, revision: parsed.data.revision } });
  revalidatePath("/withdrawal-reports", "layout");
  return { ok: true };
}
