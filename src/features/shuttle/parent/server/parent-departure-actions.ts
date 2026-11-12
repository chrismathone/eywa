"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { loadParentNotices } from "./parent-departure";
import { PARENT_PORTAL_UNAVAILABLE_MESSAGE, parentPortalAvailable } from "./parent-availability";
import { getParentViewer } from "./parent-viewer";

type AckState = { ok: true } | { error: string };

/**
 * 학부모가 **셔틀 알림**(차량 출발 · 등원 탑승)의 [확인]을 누른다(0368a·0368b) — 오늘 그 알림을 이 학부모 화면에서 내린다.
 *
 * 🔴 지금 이 학부모에게 **실제로 떠 있는 알림**만 받는다 — admin은 RLS 우회라 아무 회차·학생 키나
 *    받아 적으면 안 된다([[#77]]·[[#104]]). 판정은 화면과 같은 `loadParentNotices`다.
 * 🔑 다시 눌러도 같다(멱등 — 먼저 확인한 시각이 남는다).
 */
export async function ackParentNotice(runId: string, noticeKey: string): Promise<AckState> {
  const viewer = await getParentViewer();
  if (!viewer) return { error: "로그인이 필요합니다" };
  if (!(await parentPortalAvailable(viewer))) return { error: PARENT_PORTAL_UNAVAILABLE_MESSAGE };
  if (!runId || !noticeKey) return { error: "알림을 찾지 못했습니다" };

  const notices = await loadParentNotices(viewer);
  if (!notices.some((n) => n.runId === runId && n.noticeKey === noticeKey)) {
    revalidatePath("/parent", "layout");
    return { ok: true };
  }

  const { error } = await createAdminClient().from("parent_departure_acks").upsert(
    {
      tenant_id: viewer.tenantId,
      parent_account_id: viewer.parentAccountId,
      ran_on: kstToday(),
      run_id: runId,
      notice_key: noticeKey,
    },
    { onConflict: "tenant_id,parent_account_id,ran_on,run_id,notice_key", ignoreDuplicates: true },
  );
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /parent_departure_acks|notice_key/.test(error.message ?? "");
    return { error: missing ? "알림 확인 기능이 아직 켜지지 않았습니다(DB 적용 필요)" : "확인을 저장하지 못했습니다" };
  }

  revalidatePath("/parent", "layout");
  return { ok: true };
}
