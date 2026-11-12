import type { TenantSettings } from "@/features/owner/settings-types";
import { isModuleEnabled } from "@/lib/modules";

const APPROVAL_TYPES = ["approval_requested", "approval_decided", "approval_comment"] as const;
const CLASSNOTE_PARENT_TYPES = ["classnote_parent_post", "classnote_parent_comment"] as const;

/** 꺼진 기능에서 이미 쌓인 벨 알림도 기능의 흔적으로 남지 않게 한다. */
export function hiddenNotificationTypes(settings: TenantSettings): string[] {
  return [
    ...(!isModuleEnabled(settings.modules.disabled, "approvals") ? APPROVAL_TYPES : []),
    ...(!isModuleEnabled(settings.modules.disabled, "classnote") ? CLASSNOTE_PARENT_TYPES : []),
  ];
}
