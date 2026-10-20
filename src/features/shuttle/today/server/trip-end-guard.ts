import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { mergePlanAndLog, plannedRidesOn } from "../../roster";
import { endTripBlockedMessage, uncheckedRiderNames } from "../trip-state";
import { isSeason } from "../../types";
import { getBoardingsOn, getRideExceptionsOn, getShuttleBoard } from "../../server/queries";

/**
 * 회차 **종료 전 확인**(사용자 2026-10-07) — 그날 그 회차 명단에 상태가 안 정해진 아이가 있으면 안내 문구, 다 정해졌으면 null.
 *
 * 🔑 명단은 '오늘 등하원' 화면과 **같은 계산**이다(`plannedRidesOn` × `mergePlanAndLog`, day-board-client.tsx) —
 *    화면에서 본 줄과 서버가 막는 줄이 달라지면 "다 찍었는데 안 끝난다"가 된다. 판정은 `uncheckedRiderNames`.
 * ⚠️ 조회가 실패하거나(표 없음·회차 못 찾음) 확인할 수 없으면 **막지 않는다** — 확인 불능으로 종료를 영영 못 누르면
 *    더 나쁘다(trip-open-guard와 같은 결). 계측은 남긴다.
 */
export async function endTripUncheckedMessage(tenantId: string, runId: string, ranOn: string): Promise<string | null> {
  try {
    const { data: runRow } = await createAdminClient()
      .from("shuttle_runs")
      .select("season")
      .eq("tenant_id", tenantId)
      .eq("id", runId)
      .maybeSingle();
    if (!runRow || !isSeason(runRow.season)) return null;

    const [board, exceptions, boardings] = await Promise.all([
      getShuttleBoard(runRow.season),
      getRideExceptionsOn(ranOn),
      getBoardingsOn(ranOn),
    ]);
    const run = board.runs.find((r) => r.id === runId);
    if (!run || !boardings.ready) return null;

    const rows = mergePlanAndLog(
      plannedRidesOn(run, ranOn, exceptions.exceptions),
      boardings.logs.filter((l) => l.runId === runId),
    );
    return endTripBlockedMessage(uncheckedRiderNames(rows));
  } catch (e) {
    reportError(e, { scope: "shuttle.endTripGuard", ranOn });
    return null;
  }
}
