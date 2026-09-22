"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { renamedFileName } from "../file-name";

export async function renameDocumentFile(id: string, baseName: string, expected: { title: string; fileName: string }) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "documents"))) return { error: "파일 이름을 변경할 권한이 없습니다" };
  const db = await createClient();
  const { data: row, error } = await db.from("academy_documents")
    .select("title, file_name, file_path, updated_at").eq("id", id).eq("tenant_id", user.tenantId).eq("kind", "file").is("staff_user_id", null).maybeSingle();
  if (error || !row) return { error: "파일을 찾을 수 없거나 변경할 수 없습니다." };
  const original = row.file_name ?? row.file_path?.split("/").pop();
  if (!original || row.title !== expected.title || original !== expected.fileName)
    return { error: "파일 이름이 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  const result = renamedFileName(baseName, original);
  if ("error" in result) return result;
  const { data: changed, error: writeError } = await db.from("academy_documents")
    .update({ title: result.fileName, file_name: result.fileName, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", user.tenantId).eq("kind", "file").is("staff_user_id", null)
    .eq("updated_at", row.updated_at).select("id");
  if (writeError) return { error: "파일 이름을 저장하지 못했습니다." };
  if (!changed?.length) return { error: "다른 화면에서 파일이 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  await logAction({ action: "document_update", targetType: "document", targetLabel: result.fileName,
    metadata: { documentId: id, from: original, to: result.fileName, renamed: true } });
  revalidatePath("/documents", "layout");
  return { ok: true };
}
