import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";

/**
 * URL 직접 진입과 중첩 경로도 기능 설정을 따르게 하는 화면 경계. 꺼진 기능은 **없는 주소**(404) —
 * 기능 이름을 말하는 안내 화면을 두지 않는다(원장 2026-09-30 "꺼져 있으면 있었는지조차 모르게").
 */
export async function ModuleBoundary({ id, children }: { id: ModuleId; children: ReactNode }) {
  const settings = await getTenantSettings();
  if (!isModuleEnabled(settings.modules.disabled, id)) notFound();
  return children;
}
