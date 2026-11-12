import "server-only";

import { cache } from "react";
import { isModuleEnabled } from "@/lib/modules";
import { resolveSettings } from "@/features/owner/resolve";
import { loadTenantSettingsRaw } from "@/features/owner/server/queries";
import type { ParentViewer } from "./parent-viewer";

export const PARENT_PORTAL_UNAVAILABLE_MESSAGE = "지금은 이용할 수 있는 화면이 없습니다";

/**
 * 학부모 **신원**(`getParentViewer`)과 별개인 포털 이용 가능 판정 — 그 학부모 지점의 셔틀 모듈이 켜져 있을 때만 연다.
 *
 * 🔴 설정 조회 실패는 닫는다(fail-closed). 직원 내부 화면은 침산 운영을 멈추지 않도록 모듈 판정 실패를 열어 두지만,
 * 학부모 포털은 외부 표면이고 service_role 조회·쓰기를 포함한다. 판정을 확인하지 못한 요청까지 열면 꺼진 기능의
 * 이름과 데이터가 밖으로 새고 쓰기까지 가능해지므로, 이 표면만은 확인된 "켜짐"에서만 연다.
 * 행이 실제로 없는 것은 실패가 아니다 — 기존 프리셋 규칙대로 침산 기본값(모듈 전부 켬)으로 해석한다.
 */
const availableForTenant = cache(async (tenantId: string): Promise<boolean> => {
  try {
    const raw = await loadTenantSettingsRaw(tenantId);
    if (raw.failed) return false;
    const settings = resolveSettings(raw.data, { name: raw.name });
    return isModuleEnabled(settings.modules.disabled, "shuttle");
  } catch (error) {
    console.error("[shuttle/parent] 학부모 포털 이용 가능 상태를 확인하지 못해 닫습니다", error);
    return false;
  }
});

/** 같은 요청의 레이아웃·페이지·메타데이터·조회가 원시 설정 해석을 반복하지 않도록 지점 id로 요청 캐시한다. */
export function parentPortalAvailable(viewer: Pick<ParentViewer, "tenantId">): Promise<boolean> {
  return availableForTenant(viewer.tenantId);
}
