import { after } from "next/server";
import { z } from "zod";
import { isFeatureOptedIn } from "@/lib/license/server";
import { uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, parseSyncBody, requireRequestBinding, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";
import { syncTenant } from "@/features/integrations/todays-math/results-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const bodySchema = z.object({ bindingId: uuidSchema }).strict();

/**
 * 오늘 수학이 채점을 저장한 뒤 보내는 신호(내용 없음 — "가져가라"만). 서명 · 고정 연결을 확인하고 바로 202로 답한 뒤
 * 그 지점의 결과만 끌어온다(결과 cron과 같은 `syncTenant`). 같은 신호를 다시 받아도 결과는 같다(지문이 같으면 아무것도 안 한다).
 */
export async function POST(request: Request) {
  try {
    const { config, body } = await authenticateSyncRequest(request, "control");
    requireRequestBinding(parseSyncBody(bodySchema, body).bindingId, config);
    if (!(await isFeatureOptedIn(config.tenantId, "todays_math"))) return syncResponse({ accepted: false }, 202);
    after(async () => {
      try { await syncTenant(config); }
      catch (e) { console.error("[todays-math-results] 신호 동기화 실패", config.tenantId, e instanceof Error ? e.message : "unknown"); }
    });
    return syncResponse({ accepted: true }, 202);
  } catch (error) { return syncErrorResponse(error); }
}
