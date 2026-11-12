import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import type { TeacherWork } from "@/features/dashboard/overview/teacher-work";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStaffTaskViewer } from "./gate";
import { countOpenTasks } from "./queries";
import { hiddenStaffTaskKinds } from "../task-visibility";

/**
 * 운영실 '강사별 업무 현황'에 열린 할 일을 싣는다 — 업무 처리 현황 권한이 있을 때만(아니면 그대로 · 줄이 서지 않는다).
 * 30초 갱신마다 도니 집계만(사람별 DB group-by + 전체 head count). 실패해도 카드는 그대로.
 */
export async function withStaffTasks(loading: Promise<TeacherWork>): Promise<TeacherWork> {
  // 카드 집계와 할 일 수는 서로 기다리지 않는다(B4).
  const [work, tasks] = await Promise.all([loading, taskCounts()]);
  return tasks ? { ...work, tasks } : work;
}

async function taskCounts(): Promise<TeacherWork["tasks"] | null> {
  try {
    const [viewer, settings] = await Promise.all([getStaffTaskViewer(), getTenantSettings()]);
    if (!viewer?.canMonitor) return null;
    const admin = createAdminClient();
    const tenantId = viewer.user.tenantId;
    const nowIso = new Date().toISOString();
    const hidden = hiddenStaffTaskKinds(settings);
    let openQuery = admin.from("staff_tasks").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open");
    let lateQuery = admin.from("staff_tasks").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open").lt("due_at", nowIso);
    if (hidden.length) {
      const value = `(${hidden.join(",")})`;
      openQuery = openQuery.not("kind", "in", value);
      lateQuery = lateQuery.not("kind", "in", value);
    }
    const [byUser, open, late] = await Promise.all([
      countOpenTasks(tenantId, undefined, hidden),
      openQuery,
      lateQuery,
    ]);
    if (open.error || late.error) throw new Error(`할 일 수: ${(open.error ?? late.error)!.message}`);
    return { byUser: Object.fromEntries(byUser), open: open.count ?? 0, late: late.count ?? 0 };
  } catch (error) {
    reportError(error, { scope: "dashboard.teacher-work.tasks" });
    return null;
  }
}
