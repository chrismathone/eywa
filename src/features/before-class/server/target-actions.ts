"use server";

/**
 * 비포클래스체크리스트 — 이 기능을 쓰는 반(`before_class_targets`) 넣고 빼기(원장 2026-11-03).
 * 게이트 = `canManageBeforeClassTargets`(화면 버튼과 같은 함수, [[#77]]).
 * 빼도 그 반의 체크 기록(`before_class_checks`)은 지우지 않는다 — 다시 넣으면 그대로 돌아온다.
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { canManageBeforeClassTargets } from "./target-gate";

const idSchema = z.uuid();
type Result = { ok: true } | { ok: false; error: string };

async function gate(): Promise<{ tenantId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageBeforeClassTargets(user.systemRole))) return { error: "반을 넣고 뺄 권한이 없습니다" };
  return { tenantId: user.tenantId };
}

export async function addBeforeClassTarget(classId: string): Promise<Result> {
  if (!idSchema.safeParse(classId).success) return { ok: false, error: "입력값이 올바르지 않습니다" };
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { data: cls, error: cErr } = await admin.from("classes").select("class_name, is_active")
    .eq("tenant_id", g.tenantId).eq("id", classId).maybeSingle();
  if (cErr) return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!cls || !cls.is_active) return { ok: false, error: "넣을 수 없는 반입니다" };
  const { error } = await admin.from("before_class_targets")
    .upsert({ tenant_id: g.tenantId, class_id: classId }, { onConflict: "tenant_id,class_id", ignoreDuplicates: true });
  if (error) {
    console.error("[before-class] 반 추가 실패", error);
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  await logAction({ action: "before_class_target_add", targetType: "class", targetLabel: cls.class_name as string, metadata: { classId } });
  revalidatePath("/before-class");
  return { ok: true };
}

export async function removeBeforeClassTarget(classId: string): Promise<Result> {
  if (!idSchema.safeParse(classId).success) return { ok: false, error: "입력값이 올바르지 않습니다" };
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { data: cls } = await admin.from("classes").select("class_name").eq("tenant_id", g.tenantId).eq("id", classId).maybeSingle();
  const { error } = await admin.from("before_class_targets").delete().eq("tenant_id", g.tenantId).eq("class_id", classId);
  if (error) {
    console.error("[before-class] 반 빼기 실패", error);
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  await logAction({
    action: "before_class_target_remove", targetType: "class",
    targetLabel: (cls?.class_name as string | undefined) ?? classId, metadata: { classId },
  });
  revalidatePath("/before-class");
  return { ok: true };
}
