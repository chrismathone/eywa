"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { tenantViewWriteError } from "@/lib/auth/tenant-view";
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
  // 🔴 아래 교체는 DB에 **직접** 접속해 쓴다(drizzle) — Supabase 요청을 보는 쓰기 차단(tenant-view-guard.ts)을 지나지 않는다.
  //    운영 콘솔의 '지점 보기'(읽기 전용)는 원장 자리로 보이므로 위 역할 검사도 통과한다 → 여기서 따로 거절한다.
  const viewError = await tenantViewWriteError();
  if (viewError) return { error: viewError };

  const result = await replaceDemoRoster(user.tenantId, scenarioId);
  if ("error" in result) return result;

  await logAction({
    action: "demo_roster_apply",
    targetType: "demo_roster",
    targetLabel: result.label,
    metadata: {
      label: result.label,
      students: result.students,
      modulesBefore: result.modules.before,
      modulesAfter: result.modules.after,
    },
  });
  updateTag(tenantSettingsTag(user.tenantId));
  updateTag(`dashboard-invoice-trend:${user.tenantId}`);
  revalidatePath("/", "layout");
  return { ok: true, label: result.label };
}
