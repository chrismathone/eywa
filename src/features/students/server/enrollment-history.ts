import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { canViewStudentDetail } from "./read-scope";
import type { EnrollmentActivity, EnrollmentAudit } from "../enrollment-history";
import type { TimelineEnrollment } from "../enrollment/enrollment-timeline";

const ACTIVITY_FIELDS = "id, row_id, op, target_label, actor_name, changed, created_at";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type EnrollmentHistorySeed = { tenantId: string; snapshots: EnrollmentActivity[]; audit: EnrollmentAudit[] };

/**
 * 1차 — 학생 id만으로 읽는 것(수강 생성·삭제 스냅샷 · 작업 감사로그). 수강 행을 기다리지 않으므로
 * 타임라인의 다른 조회와 나란히 돌린다(B4). 읽을 수 없으면 null.
 *
 * 현재 세션의 RLS로 읽는다 — 변경 로그를 열람할 수 없는 계정에는 0행이 돌아와 수강 행에서 파생한 이력만 보인다.
 */
export async function loadEnrollmentHistorySeed(studentId: string): Promise<EnrollmentHistorySeed | null> {
  if (!UUID.test(studentId)) return null;
  const user = await getCurrentUser();
  if (!user || !(await canViewStudentDetail(studentId))) return null;
  const supabase = await createClient();
  // 생성·삭제 스냅샷으로 삭제된 수강 ID도 찾는다. 현재 수강 ID만 보면 그 수강의 변경 이력을 잃는다.
  const [snapshots, audit] = await Promise.all([
    fetchAllPaged<EnrollmentActivity>((from, to) => supabase.from("activity_log").select(ACTIVITY_FIELDS)
      .eq("tenant_id", user.tenantId).eq("table_name", "enrollments").in("op", ["INSERT", "DELETE"])
      .eq("changed->>student_id", studentId).order("created_at").order("id").range(from, to)),
    fetchAllPaged<EnrollmentAudit>((from, to) => supabase.from("audit_logs").select("id, action, actor_name, metadata, created_at")
      .eq("tenant_id", user.tenantId).in("action", ["enrollment_days_update", "enrollment_delete"])
      .or(`metadata->>studentId.eq.${studentId},metadata->studentIds.cs.["${studentId}"]`)
      .order("created_at").order("id").range(from, to)),
  ]);
  return { tenantId: user.tenantId, snapshots, audit };
}

/** 2차 — 수강 id·반 id가 있어야 읽는 것(수강별 변경 로그 · 반의 지금 요일 · 삭제된 수강의 반 이름). */
export async function getStudentEnrollmentHistory(seed: EnrollmentHistorySeed | null, enrollments: readonly TimelineEnrollment[]) {
  if (!seed) return { activity: [], audit: [], currentClassDays: new Map<string, string[]>(), classNames: new Map<string, string>() };
  const { tenantId, snapshots, audit } = seed;
  const supabase = await createClient();
  const ids = [...new Set([...enrollments.map((e) => e.id), ...snapshots.map((r) => r.row_id)])];
  const snapshotClassIds = snapshots.flatMap((row) => {
    const snapshot = row.changed as { class_id?: unknown } | null;
    return typeof snapshot?.class_id === "string" ? [snapshot.class_id] : [];
  });
  const classIds = [...new Set([...enrollments.map((e) => e.classId), ...snapshotClassIds])];
  // 수강 행이 남아 있는 반은 이름을 이미 안다. 삭제된 수강만 남은 반은 로그의 대상 이름이 비어 있을 수 있어 따로 읽는다.
  const namedClassIds = new Set(enrollments.map((e) => e.classId));
  const orphanClassIds = [...new Set(snapshotClassIds)].filter((id) => !namedClassIds.has(id));
  const today = kstToday();
  const [updates, schedules, classes] = await Promise.all([
    fetchAllPagedInChunks<EnrollmentActivity>(ids, (chunk, from, to) => supabase.from("activity_log").select(ACTIVITY_FIELDS)
      .eq("tenant_id", tenantId).eq("table_name", "enrollments").eq("op", "UPDATE")
      .in("row_id", chunk).order("created_at").order("id").range(from, to)),
    fetchAllPagedInChunks<{ class_id: string; day_of_week: string }>(classIds,
      (chunk, from, to) => supabase.from("class_schedules").select("class_id, day_of_week")
        .eq("tenant_id", tenantId).in("class_id", chunk).lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`).order("id").range(from, to)),
    fetchInChunks<{ id: string; class_name: string | null }>(orphanClassIds,
      (chunk) => supabase.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", chunk)),
  ]);
  const currentClassDays = new Map<string, string[]>();
  for (const row of schedules) {
    const list = currentClassDays.get(row.class_id) ?? [];
    if (!list.includes(row.day_of_week)) list.push(row.day_of_week);
    currentClassDays.set(row.class_id, list);
  }
  const classNames = new Map<string, string>();
  for (const row of classes) if (row.class_name) classNames.set(row.id, row.class_name);
  return { activity: [...snapshots, ...updates], audit, currentClassDays, classNames };
}
