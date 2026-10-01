"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { explainDbError } from "@/lib/supabase/db-error";
import { FALLBACK_CATEGORY } from "../categories";
import { logAction } from "@/features/audit/server/log";
import { documentCategoriesTag } from "./category-queries";

export type CategoryActionState = { ok?: boolean; error?: string; nonce?: number; key?: string; moved?: number } | undefined;
type Operation = "create" | "rename" | "reparent" | "reorder" | "delete";

function folderError(error: { message: string; code?: string }): string {
  if (error.code === "23505") return "같은 상위 폴더에 같은 이름의 폴더가 있습니다.";
  if (error.message.includes("folder_cycle")) return "자기 자신이나 하위 폴더 안으로 이동할 수 없습니다.";
  if (error.message.includes("folder_has_children")) return "하위 폴더를 먼저 다른 곳으로 옮기거나 정리한 뒤 삭제해 주세요. 문서는 변경되지 않았습니다.";
  if (error.message.includes("folder_system")) return "기본 폴더는 삭제할 수 없습니다. 이름과 위치는 바꿀 수 있습니다.";
  if (error.message.includes("folder_parent_missing")) return "상위 폴더 또는 이동할 폴더를 찾을 수 없습니다. 목록을 새로고침해 주세요.";
  if (error.message.includes("folder_missing")) return "폴더를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.";
  if (error.message.includes("folder_label")) return "폴더 이름은 1~20자로 입력해 주세요.";
  if (error.code === "23503") return "연결된 문서나 하위 폴더가 있어 삭제하지 못했습니다. 이동 가능한 문서와 권한을 확인해 주세요.";
  return explainDbError(error, { scope: "documents.folder", fallback: "폴더 변경을 저장하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요." }).message;
}

async function mutate(operation: Operation, input: {
  key?: string; label?: string; parentKey?: string | null; direction?: "up" | "down"; absorbInto?: string;
}): Promise<NonNullable<CategoryActionState>> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "documents"))) return { error: "폴더를 관리할 권한이 없습니다" };
  const label = input.label?.trim().replace(/\s+/g, " ");
  if ((operation === "create" || operation === "rename") && (!label || label.length > 20))
    return { error: "폴더 이름은 1~20자로 입력해 주세요." };
  if (operation !== "create" && !input.key) return { error: "폴더를 선택해 주세요." };
  const db = await createClient();
  const { data, error } = await db.rpc("mutate_document_folder", {
    p_operation: operation, p_key: input.key ?? null, p_label: label ?? null,
    p_parent_key: input.parentKey || null, p_direction: input.direction ?? null,
    p_absorb_into: input.absorbInto || FALLBACK_CATEGORY,
  });
  if (error) return { error: folderError(error) };
  if (!data?.ok || !data.key) return { error: "변경 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요." };
  await logAction({
    action: operation === "create" ? "document_category_create" : operation === "delete" ? "document_category_delete"
      : operation === "rename" ? "document_category_rename" : "document_category_move",
    targetType: "document_category", targetLabel: data.label,
    metadata: {
      key: data.key, operation, from: data.fromLabel, to: label,
      fromParentKey: data.fromParentKey, toParentKey: input.parentKey ?? null,
      direction: input.direction, absorbedInto: input.absorbInto, movedDocuments: data.moved ?? 0,
    },
  });
  updateTag(documentCategoriesTag(user.tenantId));
  revalidatePath("/documents", "layout");
  return { ok: true, key: data.key, nonce: Date.now(), moved: data.moved ?? 0 };
}

export async function createDocumentCategory(_prev: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  return mutate("create", { label: String(formData.get("label") ?? ""), parentKey: String(formData.get("parentKey") ?? "") || null });
}

export async function renameDocumentCategory(_prev: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  return mutate("rename", { key: String(formData.get("key") ?? ""), label: String(formData.get("label") ?? "") });
}

export async function moveDocumentCategory(key: string, direction: "up" | "down") {
  return mutate("reorder", { key, direction });
}

export async function reparentDocumentCategory(key: string, parentKey: string | null) {
  return mutate("reparent", { key, parentKey });
}

export async function deleteDocumentCategory(key: string, absorbInto: string) {
  return mutate("delete", { key, absorbInto });
}
