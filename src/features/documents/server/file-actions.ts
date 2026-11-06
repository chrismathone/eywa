"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { renamedFileName } from "../file-name";
import { logDbError } from "@/lib/supabase/db-error";
import { hideRestrictedDocuments } from "./restricted";

/** 저장 객체는 그대로 두고 폴더 연결만 변경한다. 다른 화면의 이동·수정을 덮어쓰지 않는다. */
export async function moveDocumentFile(id: string, targetCategory: string, expectedCategory: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "documents"))) return { error: "파일을 이동할 권한이 없습니다" };
  if (typeof id !== "string" || !id || typeof targetCategory !== "string" || !targetCategory.trim() ||
      typeof expectedCategory !== "string" || !expectedCategory)
    return { error: "이동할 파일과 폴더를 선택해 주세요." };

  const [db, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  // 제한 문서는 행위자(강사뷰면 대상 X) 역할로 — 목록에서 못 보는 행을 id로 옮기지 못하게(restricted.ts).
  let rowQuery = db.from("academy_documents")
    .select("title, category, updated_at").eq("id", id).eq("tenant_id", user.tenantId)
    .eq("kind", "file").is("staff_user_id", null);
  if (hideRestricted) rowQuery = rowQuery.eq("restricted", false);
  const { data: row, error } = await rowQuery.maybeSingle();
  if (error || !row) {
    logDbError(error, "documents.moveDocumentFile");
    return { error: "파일을 찾을 수 없거나 이동할 수 없습니다." };
  }
  if (row.category !== expectedCategory) return { error: "파일 위치가 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  if (row.category === targetCategory) return { error: "이미 이 폴더에 있는 파일입니다." };

  // 캐시 대신 현재 학원의 실제 폴더를 확인한다. 이후 삭제와 경합하면 DB의 복합 외래 키가 막는다.
  const { data: folder, error: folderError } = await db.from("document_categories")
    .select("key").eq("tenant_id", user.tenantId).eq("key", targetCategory).maybeSingle();
  if (folderError || !folder) {
    logDbError(folderError, "documents.moveDocumentFile");
    return { error: "이동할 폴더를 찾을 수 없습니다. 새로고침 후 다시 선택해 주세요." };
  }

  const { data: changed, error: writeError } = await db.from("academy_documents")
    .update({ category: targetCategory, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", user.tenantId).eq("kind", "file").is("staff_user_id", null)
    .eq("category", expectedCategory).eq("updated_at", row.updated_at).select("id");
  if (writeError) {
    logDbError(writeError, "documents.moveDocumentFile");
    return { error: "파일을 이동하지 못했습니다. 폴더가 변경되었는지 확인한 뒤 다시 시도해 주세요." };
  }
  if (!changed?.length) return { error: "다른 화면에서 파일이 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  await logAction({ action: "document_update", targetType: "document", targetLabel: row.title,
    metadata: { documentId: id, fromCategory: row.category, toCategory: targetCategory, moved: true } });
  revalidatePath("/documents", "layout");
  return { ok: true };
}

export async function renameDocumentFile(id: string, baseName: string, expected: { title: string; fileName: string }) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "documents"))) return { error: "파일 이름을 변경할 권한이 없습니다" };
  const [db, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let rowQuery = db.from("academy_documents")
    .select("title, file_name, file_path, updated_at").eq("id", id).eq("tenant_id", user.tenantId).eq("kind", "file").is("staff_user_id", null);
  if (hideRestricted) rowQuery = rowQuery.eq("restricted", false);
  const { data: row, error } = await rowQuery.maybeSingle();
  if (error || !row) {
    logDbError(error, "documents.renameDocumentFile");
    return { error: "파일을 찾을 수 없거나 변경할 수 없습니다." };
  }
  const original = row.file_name ?? row.file_path?.split("/").pop();
  if (!original || row.title !== expected.title || original !== expected.fileName)
    return { error: "파일 이름이 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  const result = renamedFileName(baseName, original);
  if ("error" in result) return result;
  const { data: changed, error: writeError } = await db.from("academy_documents")
    .update({ title: result.fileName, file_name: result.fileName, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", user.tenantId).eq("kind", "file").is("staff_user_id", null)
    .eq("updated_at", row.updated_at).select("id");
  if (writeError) {
    logDbError(writeError, "documents.renameDocumentFile");
    return { error: "파일 이름을 저장하지 못했습니다." };
  }
  if (!changed?.length) return { error: "다른 화면에서 파일이 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  await logAction({ action: "document_update", targetType: "document", targetLabel: result.fileName,
    metadata: { documentId: id, from: original, to: result.fileName, renamed: true } });
  revalidatePath("/documents", "layout");
  return { ok: true };
}
