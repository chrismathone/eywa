"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeDbError } from "@/lib/supabase/db-error";
import { reportViewer } from "./queries";
import { getArchive } from "./archives";
const mapping = z.object({ id: z.uuid(), studentId: z.uuid().nullable(), revision: z.number().int().positive() });
export async function mapArchive(input: unknown) {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "기존 기록을 연결할 권한이 없습니다." };
  const parsed = mapping.safeParse(input);
  if (!parsed.success) return { error: "연결할 학생을 확인해 주세요." };
  if (!(await getArchive(parsed.data.id))) return { error: "기록에 접근할 수 없습니다." };
  const { error } = await createAdminClient().rpc("map_withdrawal_report_archive", { p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_archive: parsed.data.id, p_student: parsed.data.studentId, p_revision: parsed.data.revision });
  if (error) return { error: describeDbError(error, { fallback: "학생 연결을 저장하지 못했습니다." }).message };
  revalidatePath("/withdrawal-reports", "layout");
  return { ok: true };
}
