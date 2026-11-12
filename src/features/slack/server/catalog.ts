import "server-only";
import { AUDIT_ACTIONS } from "@/features/audit/server/log";
import { availableActivityOptions, buildActivityOptions, type ActivityOption } from "../activity-catalog";
import { forwardEventOptionsFor, type ForwardEventOption } from "../events";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { isFeatureOptedIn } from "@/lib/license/server";
import { isCollectorDeployed } from "@/features/management/collector-switch";

/**
 * 활동(감사로그) 목록 — 라벨은 `AUDIT_ACTIONS`(server-only)에서. 화면엔 이 목록을 props로 내려준다.
 * ⚠️ log.ts → (poke) → dispatch → 여기 → log.ts 순환이 있어 **모듈 최상위에서 AUDIT_ACTIONS를 읽지 않는다**(함수 안에서만).
 */
const labels = () => AUDIT_ACTIONS as Readonly<Record<string, string>>;

export function activityOptions(): ActivityOption[] {
  return buildActivityOptions(labels());
}

export async function tenantSlackCatalog(tenantId: string): Promise<{ activityOptions: ActivityOption[]; forwardEventOptions: readonly ForwardEventOption[] }> {
  const [settings, todaysMath, videoReview] = await Promise.all([
    getTenantSettings(),
    isFeatureOptedIn(tenantId, "todays_math"),
    isFeatureOptedIn(tenantId, "video_review"),
  ]);
  const moduleOn = (id: Parameters<typeof isModuleEnabled>[1]) => isModuleEnabled(settings.modules.disabled, id);
  return {
    activityOptions: availableActivityOptions(labels(), { moduleOn, todaysMath, videoReview, collector: isCollectorDeployed() }),
    forwardEventOptions: forwardEventOptionsFor({ approvals: moduleOn("approvals"), classnote: moduleOn("classnote"), makeedu: moduleOn("makeedu"), todaysMath, videoReview }),
  };
}

export function activityKeySet(): Set<string> {
  return new Set(Object.keys(labels()));
}

export function activityLabel(key: string): string {
  return labels()[key] ?? "활동";
}
