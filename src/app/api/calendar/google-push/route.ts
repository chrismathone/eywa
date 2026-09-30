import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { isChangeNotification, verifyPushHeaders } from "@/features/calendar/google-push";
import { findByChannel } from "@/features/calendar/server/sync-state";
import { runGoogleCalendarIncremental } from "@/features/calendar/server/google-incremental";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/**
 * **구글 캘린더 푸시 알림 수신**(웹훅) — 원장 2026-09-30 *"이벤트 발생할 때마다 동기화, 주기보다 웹훅같은걸로"*.
 *
 * 구글은 본문 없이 헤더로만 "이 채널의 캘린더가 바뀌었다"를 알린다. 우리는 채널을 확인하고 **바로 200**을 돌려준 뒤
 * (`after`) 그 캘린더의 바뀐 일정만 반영한다(google-incremental.ts).
 *
 * 🔴 공개 주소다 — 채널 id로 저장된 줄을 찾고, 그 줄의 무작위 토큰과 **상수시간 비교** + 리소스 id까지 맞아야 움직인다.
 *    테넌트는 **저장된 줄에서** 얻는다(요청 값을 믿지 않는다). 모르는 채널·틀린 토큰은 아무 일도 없이 200.
 *    (4xx/5xx를 돌려주면 구글이 되풀이해 두드린다 — 거절은 조용히.)
 * 🔴 로그에 헤더 값·일정 내용을 남기지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const h = {
    channelId: req.headers.get("x-goog-channel-id"),
    channelToken: req.headers.get("x-goog-channel-token"),
    resourceId: req.headers.get("x-goog-resource-id"),
    resourceState: req.headers.get("x-goog-resource-state"),
  };
  // 헤더가 없으면 구글이 아니다 — DB를 건드리지 않고 끝낸다(두드리기만 하는 요청에 조회 비용을 쓰지 않는다).
  if (!h.channelId || !h.channelToken || h.channelId.length > 100) return new NextResponse(null, { status: 200 });

  try {
    const admin = createAdminClient();
    const state = await findByChannel(admin, h.channelId);
    if (!state || !state.channel_token) return new NextResponse(null, { status: 200 });
    const stored = { channelId: state.channel_id ?? "", channelToken: state.channel_token, resourceId: state.resource_id };
    if (!verifyPushHeaders(h, stored)) return new NextResponse(null, { status: 200 });
    if (!isChangeNotification(h.resourceState)) return new NextResponse(null, { status: 200 }); // 'sync' 인사

    after(async () => {
      try {
        const settings = await getTenantSettingsByTenantId(state.tenant_id);
        if (!isModuleEnabled(settings.modules.disabled, "calendar")) return; // 꺼진 학원은 가져오지 않는다
        const summary = await runGoogleCalendarIncremental(state.tenant_id, state);
        if (summary && summary.inserted + summary.updated + summary.deleted > 0) revalidatePath("/calendar");
      } catch (e) {
        reportError(e, { where: "google-calendar-push" });
      }
    });
  } catch (e) {
    reportError(e, { where: "google-calendar-push:lookup" });
  }
  return new NextResponse(null, { status: 200 });
}
