"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { tenantSettingsTag } from "@/features/owner/server/queries";
import { replaceDemoRoster } from "../apply";

/** 데모 지점 원장이 고른 가상 재원 구성으로 갈아끼운다. 다른 지점은 거절한다. */
export async function switchDemoRoster(
  scenarioId: string,
): Promise<{ ok: true; label: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") return { error: "원장만 데모 데이터를 바꿀 수 있습니다" };

  const result = await replaceDemoRoster(user.tenantId, scenarioId);
  if ("error" in result) return result;

  await logAction({
    action: "demo_roster_apply",
    targetType: "demo_roster",
    targetLabel: result.label,
    metadata: { label: result.label, students: result.students },
  });
  updateTag(tenantSettingsTag(user.tenantId));
  updateTag(`dashboard-invoice-trend:${user.tenantId}`);
  revalidatePath("/", "layout");
  return { ok: true, label: result.label };
}
