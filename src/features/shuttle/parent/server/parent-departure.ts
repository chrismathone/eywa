import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { noticeAckId, parentNotices, type ParentNotice } from "../departure-notices";
import { loadParentRideLegsFor } from "./parent-ride-data";
import { parentPortalAvailable } from "./parent-availability";
import type { ParentViewer } from "./parent-viewer";

/**
 * 학부모 화면 위쪽 **셔틀 알림**(차량 출발 · 등원 탑승, 0368a·0368b) 재료 — 오늘 우리 아이 구간 + 이 학부모가 확인한 알림.
 *
 * 🔑 판정은 `parentNotices`(순수 함수) 한 곳이다. 여기는 읽기만.
 * 🔴 아이 목록은 `getParentViewer()`가 준 것만 — 주소·폼으로 받은 학생 id를 믿지 않는다([[#77]]).
 * ⚠️ 표가 없으면(0368a 미적용) 확인 표식을 빈 것으로 본다 — 알림은 뜨고 [확인]만 안내 문구로 실패한다([[#95]]).
 * 실패하면 빈 목록 — 알림 때문에 학부모 화면을 죽이지 않는다.
 */
export async function loadParentNotices(viewer: ParentViewer): Promise<ParentNotice[]> {
  if (viewer.children.length === 0 || !(await parentPortalAvailable(viewer))) return [];
  const today = kstToday();
  try {
    const admin = createAdminClient();
    const [{ legs }, acks] = await Promise.all([
      loadParentRideLegsFor(viewer, viewer.children.map((c) => c.id), today, "term", true),
      admin
        .from("parent_departure_acks")
        .select("run_id, notice_key")
        .eq("tenant_id", viewer.tenantId)
        .eq("parent_account_id", viewer.parentAccountId)
        .eq("ran_on", today)
        .limit(200),
    ]);
    const acked = new Set((acks.data ?? []).map((a) => noticeAckId(String(a.run_id), String(a.notice_key ?? "depart"))));
    return parentNotices(viewer.children, legs, acked);
  } catch (e) {
    reportError(e, { scope: "shuttle.parentNotices" });
    return [];
  }
}
