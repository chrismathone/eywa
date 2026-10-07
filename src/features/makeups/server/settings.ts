import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/supabase/db-error";
import { tenantSettingsTag } from "@/features/owner/server/queries";
import { makeupSettingsSchema } from "../config";
import { parseCommandSuccess } from "../command-parse";

/** Called by saveOwnerSection; SQL atomically checks transition and merges the section. */
export async function configureMakeupSettings(input: unknown) {
  const actor = await getCurrentUser({ teacherView: true });
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "owner")) ||
      (actor.systemRole !== "master" && !(await isCurrentUserSuperAdmin()))) {
    return { error: "보강관리 운영 설정을 변경할 권한이 없습니다" };
  }
  const parsed = makeupSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "보강관리 설정을 확인해 주세요" };
  // Additional guidance remains unavailable until its attendance/billing policy is approved.
  if (parsed.data.allowAdditional) return { error: "추가 지도의 출결·수납 기준을 확정한 뒤 사용할 수 있습니다" };
  const db = await createClient();
  const { data, error } = await db.rpc("makeup_command", {
    p_command_id: crypto.randomUUID(), p_action: "configure", p_expected_revision: null,
    p_payload: { mode: parsed.data.mode, allow_additional: false, pilot_subjects: parsed.data.pilotSubjects },
  });
  if (error) {
    const info = describeDbError(error, { fallback: "보강관리 운영 설정을 저장하지 못했습니다" });
    return { error: info.kind === "schema" ? "보강관리 DB 설정을 적용한 뒤 다시 저장해 주세요" : info.message };
  }
  const result = parseCommandSuccess(data);
  if (!result.ok || data.action !== "configure") return { error: "설정 저장 결과를 확인하지 못했습니다. 새로고침 후 확인해 주세요." };
  updateTag(tenantSettingsTag(actor.tenantId));
  revalidatePath("/", "layout");
  revalidatePath("/owner");
  revalidatePath("/makeups");
  return { ok: true, nonce: Date.now() };
}
