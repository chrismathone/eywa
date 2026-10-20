import "server-only";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { listTasks } from "@/features/staff-tasks/server/queries";
import type { StaffTaskList } from "@/features/staff-tasks/kinds";
import { careAccess } from "./access";
import { mergeCareTasks, type CareTaskFilter, type CareTasks } from "../tasks";

/** Read only. Student scope AND staff-task scope both apply; no scan, creation or notification on viewing.
 * Resolve source ids with the session client before invoking the existing service-only task reader. */
export async function getCareTasks(studentId: string, filter: CareTaskFilter): Promise<CareTasks | null> {
  const [ctx, viewer] = await Promise.all([careAccess(studentId), getStaffTaskViewer()]);
  if (!ctx || !viewer || ctx.user.tenantId !== viewer.user.tenantId || ctx.user.id !== viewer.user.id) return null;
  const { db, user, counselorId } = ctx;
  const [consultations, progress] = await Promise.all([
    ctx.canReadConsultations ? fetchAllPaged<{ id: string }>((from, to) => {
      let q = db.from("student_consultations").select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId);
      if (counselorId) q = q.eq("counselor_id", counselorId);
      return q.order("id").range(from, to);
    }) : Promise.resolve([]),
    fetchAllPaged<{ id: string }>((from, to) => db.from("progress_events").select("id")
      .eq("tenant_id", user.tenantId).eq("student_id", studentId).in("event_type", ["jump_error", "overlap_error"])
      .order("id").range(from, to)),
  ]);
  const sources = [
    { kind: "attendance_absent_desk", ids: [studentId] },
    { kind: "followup_due", ids: [...new Set(consultations.map((r) => r.id))] },
    { kind: "progress_anomaly", ids: [...new Set(progress.map((r) => r.id))] },
  ];
  const groups = await Promise.all(sources.map(async ({ kind, ids }) => {
    const results: StaffTaskList[] = [];
    // Bounded requests and concurrency: three source kinds, at most 100 ids per request.
    for (let start = 0; start < ids.length; start += 100) {
      results.push(await listTasks({ tenantId: user.tenantId, assigneeId: viewer.canMonitor ? null : viewer.user.id,
        kind, subjectIds: ids.slice(start, start + 100), filter, page: 0 }));
    }
    return results;
  }));
  return { ...mergeCareTasks(groups.flat(), filter), canMonitor: viewer.canMonitor };
}
