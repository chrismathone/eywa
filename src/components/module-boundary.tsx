import type { ReactNode } from "react";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";
import { UnavailableFeatureContent } from "@/components/unavailable-feature-content";

/** URL 직접 진입과 중첩 경로도 기능 설정을 따르게 하는 화면 경계. */
export async function ModuleBoundary({ id, children }: { id: ModuleId; children: ReactNode }) {
  const settings = await getTenantSettings();
  if (!isModuleEnabled(settings.modules.disabled, id)) return <UnavailableFeatureContent id={id} />;
  return children;
}
