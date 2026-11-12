"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { isShuttleAdmin } from "../../server/access";
import { PARENT_PORTAL_UNAVAILABLE_MESSAGE, parentPortalAvailable } from "../../parent/server/parent-availability";
import { loadParentRideLegsFor } from "../../parent/server/parent-ride-data";
import { getParentViewer } from "../../parent/server/parent-viewer";
import { computeRunRoadPath, type RunRoadPath } from "./route-path-core";

/** 직원 '실시간 위치'의 회차 도로 경로 — 원장·관리자·총괄 전용(`isShuttleAdmin`). 계산은 route-path-core.ts. */
export async function getRunRoadPath(runId: string): Promise<RunRoadPath> {
  const user = await getCurrentUser();
  if (!user || !(await isShuttleAdmin())) return { ok: false, error: "권한이 없습니다" };
  return computeRunRoadPath(user.tenantId, runId);
}

/**
 * 학부모 '실시간 차량'의 회차 도로 경로(사용자 2026-10-15 "오늘 타고 내리는 곳을 누르면 그 회차 정보를 맵에").
 * 🔒 **우리 아이가 오늘 타는 회차만** — 화면이 넘긴 회차 id를 믿지 않고, `getParentViewer`의 아이들 오늘 구간에 그 회차가
 *    있을 때만 계산한다(다른 학원·다른 회차를 열어 볼 수 없게). 오늘만 안 타는 구간은 제외.
 */
export async function getParentRunRoadPath(runId: string): Promise<RunRoadPath> {
  const viewer = await getParentViewer();
  if (!viewer || viewer.children.length === 0) return { ok: false, error: "권한이 없습니다" };
  if (!(await parentPortalAvailable(viewer))) return { ok: false, error: PARENT_PORTAL_UNAVAILABLE_MESSAGE };
  const { legs } = await loadParentRideLegsFor(viewer, viewer.children.map((c) => c.id), kstToday(), "term", true);
  const mine = [...legs.values()].some((list) => list.some((l) => l.runId === runId && !l.skipped));
  if (!mine) return { ok: false, error: "오늘 우리 아이가 타는 회차가 아닙니다" };
  return computeRunRoadPath(viewer.tenantId, runId);
}
