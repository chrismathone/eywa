import "server-only";

import { cache } from "react";
import { isModuleEnabled } from "@/lib/modules";
import { resolveSettings } from "@/features/owner/resolve";
import { loadTenantSettingsRaw } from "@/features/owner/server/queries";
import type { ParentViewer } from "./parent-viewer";

export const PARENT_PORTAL_UNAVAILABLE_MESSAGE = "지금은 이용할 수 있는 화면이 없습니다";
/** 설정을 확인하지 못한 일시 실패 — '기능 없음'으로 말하지 않는다(다음 요청에 다시 읽는다 · 실패는 캐시하지 않는다). */
export const PARENT_PORTAL_RETRY_MESSAGE = "지금 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요";

export type ParentPortalState = "on" | "off" | "unknown";

/**
 * 학부모 **신원**(`getParentViewer`)과 별개인 포털 이용 가능 판정 — 그 학부모 지점의 셔틀 모듈이 켜져 있을 때만 연다.
 *
 * 🔴 설정 조회 실패는 닫는다(fail-closed). 직원 내부 화면은 침산 운영을 멈추지 않도록 모듈 판정 실패를 열어 두지만,
 * 학부모 포털은 외부 표면이고 service_role 조회·쓰기를 포함한다. 판정을 확인하지 못한 요청까지 열면 꺼진 기능의
 * 이름과 데이터가 밖으로 새고 쓰기까지 가능해지므로, 이 표면만은 확인된 "켜짐"에서만 연다.
 * 행이 실제로 없는 것은 실패가 아니다 — 기존 프리셋 규칙대로 침산 기본값(모듈 전부 켬)으로 해석한다.
 */
const stateForTenant = cache(async (tenantId: string): Promise<ParentPortalState> => {
  try {
    const raw = await loadTenantSettingsRaw(tenantId);
    if (raw.failed) return "unknown";
    const settings = resolveSettings(raw.data, { name: raw.name });
    return isModuleEnabled(settings.modules.disabled, "shuttle") ? "on" : "off";
  } catch (error) {
    console.error("[shuttle/parent] 학부모 포털 이용 가능 상태를 확인하지 못해 닫습니다", error);
    return "unknown";
  }
});

/** 종착 화면 문구를 가르는 3상태(켜짐 · 꺼짐 · 확인 못 함). 여는 판정은 `parentPortalAvailable`(켜짐만). */
export function parentPortalState(viewer: Pick<ParentViewer, "tenantId">): Promise<ParentPortalState> {
  return stateForTenant(viewer.tenantId);
}

/** 같은 요청의 레이아웃·페이지·메타데이터·조회가 원시 설정 해석을 반복하지 않도록 지점 id로 요청 캐시한다. */
export async function parentPortalAvailable(viewer: Pick<ParentViewer, "tenantId">): Promise<boolean> {
  return (await stateForTenant(viewer.tenantId)) === "on";
}
