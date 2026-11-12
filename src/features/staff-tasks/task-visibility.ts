import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import type { TenantSettings } from "@/features/owner/settings-types";
import { isModuleEnabled } from "@/lib/modules";

/** 기능을 끈 뒤에도 DB 맞춤이 남겨 둔 할 일 가운데 앱에서 감출 종류. */
export function hiddenStaffTaskKinds(settings: TenantSettings): string[] {
  const hidden: string[] = [];
  if (!isModuleEnabled(settings.modules.disabled, "approvals")) hidden.push("approval_turn");
  if (!classnoteModuleOn(settings)) hidden.push("unsent_report", "report_send_failed");
  return hidden;
}
