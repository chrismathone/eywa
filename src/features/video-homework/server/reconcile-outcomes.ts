import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { classnoteSendWindowHint } from "@/features/onescreen/classnote-guard";
import { isVideoHomeworkEnabled } from "../policy";
import { videoHomeworkOutcomes } from "../auto-outcomes";
import { videoMatchRange, VIDEO_MATCH_WINDOW_DAYS } from "../rounds";
import type { VideoHomeworkStatus } from "../types";
import { getAssignedVideoHomework } from "./assignments";
import { loadClassVideos } from "./ledger-queries";

/** 업로드 직후 + 정기 재시도. 조회 실패를 '영상 없음'으로 처리하지 않는다. */
export async function reconcileVideoHomework(tenantId: string, options: { studentId?: string; notifyUnmatched?: boolean; scheduled?: boolean } = {}) {
  const observedAt = new Date().toISOString();
  const today = kstToday();
  const range = videoMatchRange(addDays(today, -30), today, today);
  const db = createAdminClient();
  const settings = await getTenantSettingsByTenantId(tenantId, { failOnReadError: true });
  // 정기 확인은 ClassNote 허용 시간에만. 링크 업로드 직후 호출은 시간 제한을 적용하지 않는다.
  if (!settings.report.videoHomeworkPolicy.enabled || (options.scheduled && classnoteSendWindowHint(
    settings.report.classnoteSendWindowStart, settings.report.classnoteSendWindowEnd)))
    return { checked: 0, updated: 0, notifications: 0 };
  const [assigned, students, classes, markRows] = await Promise.all([
    getAssignedVideoHomework(tenantId, range.from, today, { studentId: options.studentId }),
    fetchAllPaged<{ id: string; grade: string | null; is_test: boolean }>((from, to) => {
      const query = db.from("students").select("id,grade,is_test").eq("tenant_id", tenantId).order("id");
      if (options.studentId) query.eq("id", options.studentId);
      return query.range(from, to);
    }),
    fetchAllPaged<{ id: string; subject: string }>((from, to) => db.from("classes").select("id,subject").eq("tenant_id", tenantId).order("id").range(from, to)),
    // 검사 기록만 있는 숙제 칸 — 장부가 ②의 뒷순위로 영상을 붙이는 자리. 판정하지 않고, 그 칸이 받은 영상을 미배정 알림에서만 뺀다.
    fetchAllPaged<{ class_id: string; student_id: string; check_date: string; homework_date: string; status: string }>((from, to) => {
      const query = db.from("video_homework_marks").select("class_id,student_id,check_date,homework_date,status").eq("tenant_id", tenantId)
        .gte("homework_date", range.from).lt("homework_date", addDays(today, 1)).order("id");
      if (options.studentId) query.eq("student_id", options.studentId);
      return query.range(from, to);
    }),
  ]);
  if (assigned === null) throw new Error("영상 숙제 조회 실패");
  const byStudent = new Map(students.filter(student => !student.is_test).map(student => [student.id, student]));
  const byClass = new Map(classes.map(cls => [cls.id, cls]));
  const targets = assigned.filter(homework => {
    const student = byStudent.get(homework.studentId), cls = byClass.get(homework.classId);
    return student && cls && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy,
      { classId: cls.id, subjectKey: cls.subject, grade: student.grade });
  });
  // 숙제가 아직 없는 학생의 미배정 영상도 다음 날 알릴 수 있게 실제 업로드 학생을 포함한다.
  const videoStudents = options.notifyUnmatched ? [...byStudent.keys()] : [...new Set(targets.map(homework => homework.studentId))];
  const videos = await loadClassVideos(tenantId, videoStudents, range.from, addDays(range.to, VIDEO_MATCH_WINDOW_DAYS), true);
  if (videos === null) throw new Error("영상 조회 실패 — 상태 변경 중단");
  const marks = markRows.map((row) => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date, homeworkDate: row.homework_date,
    status: row.status as VideoHomeworkStatus }));
  const { outcomes, unmatched, fillable } = videoHomeworkOutcomes(targets, videos, today, range.from, marks, (classId) => byClass.get(classId)?.subject);
  let updated = 0, notifications = 0;
  for (let start = 0; start < outcomes.length; start += 100) {
    const { data, error } = await db.rpc("reconcile_video_homework_outcomes", {
      p_tenant: tenantId, p_outcomes: outcomes.slice(start, start + 100), p_observed_at: observedAt,
    });
    if (error) throw new Error(`영상 상태 갱신 실패: ${error.message}`);
    updated += Number(data?.updated ?? 0); notifications += Number(data?.notifications ?? 0);
  }
  // 미배정 할 일(0379a)은 미배정이 0건이어도 맞춘다 — 마지막 영상이 연결되면 그 할 일을 닫아야 한다.
  // 알림·할 일은 붙일 빈 숙제가 있는 영상만(`fillable` — 원장 2026-10-23). 빈 숙제가 없어진 영상(`moot`)의 열린 할 일은 '취소'로 닫는다.
  const moot = unmatched.filter(video => !fillable.includes(video)).map(video => video.id);
  const sync = (open: string[]) => syncUnassignedTasks(tenantId, videos.map(video => video.id), unmatched.map(video => video.id), open, moot);
  // 알림 건수(DB)가 닫힌 할 일의 영상을 빼고 세므로 먼저 닫는다 — 열기는 알림 뒤(새 할 일을 방금 만든 묶음 알림에 잇는다).
  if (options.notifyUnmatched) await sync([]);
  let pending: { id: string }[] = [];
  if (options.notifyUnmatched && fillable.length) {
    // 배정이 바뀌었는지는 RPC가 재확인한다. 수신자는 현재 담당 강사이며 지점 밖으로 보내지 않는다.
    const eligible = fillable.filter(video => {
      const student = byStudent.get(video.studentId);
      const candidates = video.classId ? [byClass.get(video.classId)].filter(Boolean) : classes;
      return student && candidates.some(cls => cls && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy,
        { classId: cls.id, subjectKey: cls.subject, grade: student.grade }));
    });
    pending = await fetchAllPagedInChunks<{ id: string }>(eligible.map(video => video.id), (chunk, from, to) =>
      db.from("homework_video_ledger_videos").select("id").eq("tenant_id", tenantId).in("id", chunk).eq("status", "uploaded").order("id").range(from, to));
    for (let start = 0; start < pending.length; start += 100) {
      const { data, error } = await db.rpc("notify_unassigned_homework_videos", {
        p_tenant: tenantId, p_videos: pending.slice(start, start + 100).map(video => video.id), p_observed_at: observedAt,
      });
      if (error) throw new Error(`미배정 영상 알림 실패: ${error.message}`);
      notifications += Number(data ?? 0);
    }
  }
  if (options.notifyUnmatched) await sync(pending.map(video => video.id));
  return { checked: outcomes.length, updated, notifications };
}

/**
 * 할 일 '미배정 영상'(0379a · 0447a) — 알림 대상(open)은 열고, 이번에 판정한 영상(checked) 중 미배정(unmatched)이 아니게 된 것은 닫고,
 * 미배정이지만 붙일 빈 숙제가 없는 영상(moot)은 '취소'로 닫는다. 판정은 위 `videoHomeworkOutcomes` 한 벌 — DB가 따로 판정하지 않는다.
 * 실패해도 영상 상태·알림은 이미 끝났다(할 일만 다음 판정에).
 */
async function syncUnassignedTasks(tenantId: string, checked: string[], unmatched: string[], open: string[], moot: string[]): Promise<void> {
  const { error } = await createAdminClient().rpc("staff_task_sync_unassigned_videos", {
    p_tenant: tenantId, p_checked: checked, p_unmatched: unmatched, p_open: open, p_moot: moot,
  });
  if (error) reportError(error, { scope: "video-homework.unassigned-tasks", tenantId });
}
