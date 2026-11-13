"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { canWriteSupportRequest } from "../access";
import { isMissingSupportTables, SUPPORT_NOT_READY } from "../missing";
import { asSupportStatus, canAuthorEditRequest } from "../types";
import { logDbError } from "@/lib/supabase/db-error";
import { phoneLabel } from "@/lib/format/phone";

type Result = { ok: true; id: string } | { error: string };

export type SupportRequestForm = {
  title: string;
  body: string;
  contactPhone: string;
  contactEmail: string;
};

/** 폼 값 정리·검증 — 서버 액션 파일은 async만 export한다([[#119]]) 그래서 여기 안에 둔다. */
function cleanForm(form: SupportRequestForm): { ok: true; row: Record<string, string | null> } | { error: string } {
  const title = (form.title ?? "").trim().slice(0, 120);
  const body = (form.body ?? "").trim();
  if (body.length > 8000) return { error: "내용은 메뉴 참조를 포함해 8,000자까지 입력해 주세요" };
  const phone = (phoneLabel(form.contactPhone) ?? "").slice(0, 40);
  const email = (form.contactEmail ?? "").trim().slice(0, 200);
  if (!title || !body) return { error: "제목과 내용을 적어 주세요" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "이메일 형식을 확인해 주세요" };
  return { ok: true, row: { title, body, contact_phone: phone || null, contact_email: email || null } };
}

export async function createSupportRequest(form: SupportRequestForm): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteSupportRequest(user.systemRole))) return { error: "개선요청을 작성할 권한이 없습니다" };
  const cleaned = cleanForm(form);
  if ("error" in cleaned) return cleaned;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_requests")
    .insert({ ...cleaned.row, tenant_id: user.tenantId, author_id: user.id, status: "received" })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (isMissingSupportTables(error)) return { error: SUPPORT_NOT_READY };
    return { error: "개선요청을 저장하지 못했습니다" };
  }
  const id = data.id as string;
  await logAction({
    action: "support_request_create",
    targetType: "support_request",
    targetLabel: cleaned.row.title,
    metadata: { requestId: id, title: cleaned.row.title },
  });
  revalidatePath("/support");
  revalidatePath("/super-admin/support");
  return { ok: true, id };
}

/**
 * 자기 글 · 운영자가 한 번도 손대지 않았을 때만(`author_locked_at`, 0296a 트리거가 찍는다). 운영자가 읽기 시작하면 잠근다(답이 엇나가지 않게).
 * 작성자 삭제는 없다(원장 2026-09-28) — 지울 일은 운영팀에 새 글로.
 */
async function loadOwnEditable(requestId: string, verb: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" } as const;
  if (!(await canWriteSupportRequest(user.systemRole))) return { error: `개선요청을 ${verb} 권한이 없습니다` } as const;
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("support_requests")
    .select("id, author_id, title, status, author_locked_at")
    .eq("id", requestId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) {
    if (isMissingSupportTables(error)) return { error: SUPPORT_NOT_READY } as const;
    return { error: "글을 찾지 못했습니다" } as const;
  }
  if (!row) return { error: "글을 찾지 못했습니다" } as const;
  if (row.author_id !== user.id) return { error: `자기 글만 ${verb} 수 있습니다` } as const;
  if (!canAuthorEditRequest(asSupportStatus(row.status), row.author_locked_at != null)) {
    return { error: `처리가 시작된 요청은 ${verb} 수 없습니다 — 새 글로 이어서 적어 주세요` } as const;
  }
  return { user, admin, row } as const;
}

export async function updateSupportRequest(requestId: string, form: SupportRequestForm): Promise<Result> {
  const loaded = await loadOwnEditable(requestId, "고칠");
  if ("error" in loaded) return { error: loaded.error as string };
  const cleaned = cleanForm(form);
  if ("error" in cleaned) return cleaned;
  const { user, admin } = loaded;
  const { data, error } = await admin
    .from("support_requests")
    .update(cleaned.row)
    .eq("id", requestId)
    .eq("tenant_id", user.tenantId)
    .eq("status", "received")
    .is("answer", null)
    .is("author_locked_at", null)
    .select("id");
  if (error) {
    logDbError(error, "support.updateSupportRequest");
    return { error: "수정하지 못했습니다" };
  }
  // 읽는 사이 운영자가 처리를 시작했으면 0행 — 저장된 척하지 않는다.
  if (!data?.length) return { error: "처리가 시작된 요청은 고칠 수 없습니다 — 새로고침해 보세요" };
  await logAction({
    action: "support_request_update",
    targetType: "support_request",
    targetLabel: cleaned.row.title,
    metadata: { requestId, title: cleaned.row.title },
  });
  revalidatePath("/support");
  revalidatePath(`/support/requests/${requestId}`);
  revalidatePath("/super-admin/support");
  return { ok: true, id: requestId };
}
