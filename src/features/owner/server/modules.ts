import "server-only";
import { cache } from "react";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";
import { resolveSettings } from "../resolve";
import { loadTenantSettingsRaw, storedForResolve } from "./queries";

/**
 * 이 학원에 그 기능(모듈)이 켜져 있나 — 학원 id로 묻는 서버 판정(세션 없는 경로·담당 토글 우회용).
 * 로그인 경로에선 `getTenantSettings().modules.disabled`를 직접 봐도 된다(같은 캐시).
 *
 * 🔴 조회가 실패하면 **켜진 것으로** 본다(fail-open) — 권한 매트릭스와 같은 철학이고, 무엇보다 침산은 꺼진 모듈이
 *    없으니 실패해도 오늘과 같다. 닫는 쪽으로 틀리면 DB가 흔들린 순간 침산 셔틀 선생님이 화면을 잃는다.
 */
export const isModuleOnForTenant = cache(async (tenantId: string, id: ModuleId): Promise<boolean> => {
  try {
    const raw = await loadTenantSettingsRaw(tenantId);
    const settings = resolveSettings(storedForResolve(raw), { name: raw.name });
    return isModuleEnabled(settings.modules.disabled, id) && (id !== "makeups" || settings.makeups.mode !== "off");
  } catch (e) {
    console.error("[owner/modules] 모듈 판정 실패 — 켜진 것으로 본다", e);
    return id !== "makeups";
  }
});
