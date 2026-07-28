import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFailureBody,
  notifyKey,
  parseNotifiedKey,
  selectMissing,
  type FailedReportRow,
} from "../failed-notify-sweep";

/** 최근 며칠의 실패만 본다 — 더 옛날 건은 지금 알려도 조치할 수 없다(too_old 7일 컷 밖). */
const WINDOW_DAYS = 14;
/** 중복 판정에 쓸 기존 알림 조회 범위 — 실패 창(14일)보다 넉넉히. */
const NOTIFICATION_LOOKBACK_DAYS = 45;

type StudentRef = { name: string | null; is_test: boolean | null };
type Row = {
  id: string;
  student_id: string | null;
  report_date: string;
  teacher_name: string | null;
  class_id: string | null;
  classnote_error: string | null;
  students: StudentRef | StudentRef[] | null;
};
const one = (v: Row["students"]): StudentRef | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 발송 실패(classnote_status='failed')인데 담당 강사 알림이 없는 건을 찾아 만든다 — 0143a 트리거 유실 보정.
 * 수신자 규칙은 트리거와 동일: 반 담당 강사 → 이름이 같은 재직 강사 → master 전원.
 * 테스트 학생(0153a `students.is_test`)·취소(revoked_at)는 제외. 실패해도 호출자(cron)를 막지 않는다.
 */
export async function sweepFailedReportNotifications(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ checked: number; created: number }> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const { data: failedRows, error } = await admin
    .from("lesson_reports")
    .select("id, student_id, report_date, teacher_name, class_id, classnote_error, students(name, is_test)")
    .eq("tenant_id", tenantId)
    .eq("classnote_status", "failed")
    .is("revoked_at", null)
    .gte("report_date", ymd(since));
  if (error) throw new Error(`실패 보고서 조회: ${error.message}`);

  const rows: FailedReportRow[] = (failedRows ?? [])
    .map((r) => {
      const stu = one((r as Row).students);
      return { row: r as Row, stu };
    })
    .filter(({ stu }) => !!stu?.name && stu.is_test !== true)
    .map(({ row, stu }) => ({
      id: row.id,
      studentName: (stu?.name ?? "").trim(),
      reportDate: row.report_date,
      teacherName: row.teacher_name,
      classId: row.class_id,
      error: row.classnote_error,
    }));
  if (!rows.length) return { checked: 0, created: 0 };

  const lookback = new Date(Date.now() - NOTIFICATION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: notified } = await admin
    .from("notifications")
    .select("body")
    .eq("tenant_id", tenantId)
    .eq("type", "report_send_failed")
    .gte("created_at", lookback);
  const keys = new Set(
    (notified ?? []).map((n) => parseNotifiedKey(n.body as string | null)).filter((k): k is string => !!k),
  );

  const missing = selectMissing(rows, keys);
  if (!missing.length) return { checked: rows.length, created: 0 };

  // 수신자 해석 — 트리거와 같은 순서. 조회는 벌크 3회(건별 왕복 금지).
  const classIds = [...new Set(missing.map((m) => m.classId).filter((v): v is string => !!v))];
  const teacherNames = [...new Set(missing.map((m) => m.teacherName).filter((v): v is string => !!v))];
  const [classesRes, usersRes, mastersRes] = await Promise.all([
    classIds.length
      ? admin.from("classes").select("id, teacher_id").eq("tenant_id", tenantId).in("id", classIds)
      : Promise.resolve({ data: [] as { id: string; teacher_id: string | null }[] }),
    teacherNames.length
      ? admin
          .from("users")
          .select("id, display_name")
          .eq("tenant_id", tenantId)
          .eq("status", "active")
          .in("display_name", teacherNames)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    admin
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("system_role", "master"),
  ]);
  const teacherByClass = new Map(
    ((classesRes.data ?? []) as { id: string; teacher_id: string | null }[])
      .filter((c) => c.teacher_id)
      .map((c) => [c.id, c.teacher_id as string]),
  );
  const userByName = new Map(
    ((usersRes.data ?? []) as { id: string; display_name: string | null }[])
      .filter((u) => u.display_name)
      .map((u) => [u.display_name as string, u.id]),
  );
  const masterIds = ((mastersRes.data ?? []) as { id: string }[]).map((m) => m.id);

  const inserts: Record<string, unknown>[] = [];
  for (const m of missing) {
    const body = buildFailureBody(m);
    const recipient =
      (m.classId ? teacherByClass.get(m.classId) : undefined) ??
      (m.teacherName ? userByName.get(m.teacherName) : undefined);
    const targets = recipient ? [recipient] : masterIds; // 담당을 못 찾으면 master 전원(트리거와 동일)
    for (const t of targets) {
      inserts.push({
        tenant_id: tenantId,
        recipient_id: t,
        type: "report_send_failed",
        title: "수업 보고서 발송 실패",
        body,
        link: "/lesson-reports",
        actor_id: null,
      });
    }
  }
  if (!inserts.length) return { checked: rows.length, created: 0 };

  const { error: insErr } = await admin.from("notifications").insert(inserts);
  if (insErr) throw new Error(`알림 생성: ${insErr.message}`);
  // 같은 (학생,날짜)에 여러 수신자가 있으면 inserts가 더 많다 — "메운 실패 건수"로 보고한다.
  return { checked: rows.length, created: missing.length };
}

export { notifyKey };
