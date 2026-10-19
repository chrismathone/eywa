import { z } from "zod";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActionAs } from "@/features/audit/server/log";
import { uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, parseSyncBody, requireRequestBinding, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
const labels = z.array(z.string().min(1).max(60)).max(60);
const bodySchema = z.object({
  bindingId: uuidSchema,
  eventId: uuidSchema,
  kind: z.enum(["owner", "ceiling"]),
  actorName: z.string().min(1).max(50),
  turnedOn: labels,
  turnedOff: labels,
  menus: labels,
  menuRevision: z.number().int().positive(),
}).strict();

/**
 * 오늘 수학에서 지점 사용 메뉴가 바뀌었다는 알림 → 에이와 감사 기록(원장 2026-10-19 *"감사로그 서로 배선"*).
 * kind owner = 오늘 수학 지점관리에서 원장이 바꿈 · ceiling = 오늘 수학 최고관리자가 열어 둔 메뉴를 바꿈.
 * 에이와에서 바꾼 것은 오늘 수학이 되돌려 보내지 않는다(이미 여기 기록이 있다). 같은 요청은 nonce로, 같은 알림은 eventId로 한 번만 적는다.
 * 값 자체는 저장하지 않는다 — 에이와 화면은 열 때마다 오늘 수학에서 지금 값을 읽는다.
 */
export async function POST(request: Request) {
  try {
    const { config, body } = await authenticateSyncRequest(request, "control", true);
    const event = parseSyncBody(bodySchema, body);
    requireRequestBinding(event.bindingId, config);
    if (!(await isFeatureOptedIn(config.tenantId, "todays_math"))) return syncResponse({ accepted: false }, 202);
    const { data: seen } = await createAdminClient().from("audit_logs").select("id")
      .eq("tenant_id", config.tenantId).eq("action", "todays_math_menus_update").eq("metadata->>eventId", event.eventId).limit(1);
    if (!seen?.length)
      await logActionAs({ tenantId: config.tenantId, actorName: `오늘 수학 · ${event.actorName}` }, {
        action: "todays_math_menus_update",
        targetType: "todays_math",
        targetLabel: "오늘 수학 사용 메뉴",
        metadata: { source: event.kind === "ceiling" ? "todays_math_admin" : "todays_math", eventId: event.eventId,
          turnedOn: event.turnedOn, turnedOff: event.turnedOff, menus: event.menus, menuRevision: event.menuRevision },
      });
    return syncResponse({ accepted: true }, 202);
  } catch (error) { return syncErrorResponse(error); }
}
