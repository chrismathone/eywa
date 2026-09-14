import "server-only";
/**
 * 미출결 → 출결 교차 알림. 쓰기 시점에만 발화(배치 불필요).
 *
 * · 데스크가 바꿨으면 → 그 반 담임(+부담임)
 * · 강사가 바꿨으면 → `users.desk_attendance_optin` 켠 계정
 *
 * 규약: dedup bucket = 상태 전이(`날짜|교시`), 신규분만 발송, admin 조회에 tenant 필터.
 * best-effort — 실패해도 출결 저장을 막지 않는다.
 * ⚠️ 인앱 벨만. 휴대폰 푸시 확대는 원장 결정 사항.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getTestStudentIds } from "@/features/students/server/test-students";
import { addDays, kstToday } from "@/lib/date-kst";
import { crossNotifyDirection } from "../mark-state";
import { collectStudentNames, formatAttendanceNotifyNames } from "../notify-names";
import type { RecordedVia } from "../recorded-via";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPE = "attendance_unmarked_to_present";

export async function notifyUnmarkedToPresent(input: {
  tenantId: string;
  actorId: string | null;
  date: string;
  via: RecordedVia;
  cells: { studentId: string; classId: string; slotStart?: string | null }[];
}): Promise<void> {
  const { tenantId, actorId, date, via, cells } = input;
  const direction = crossNotifyDirection(via);
  if (!direction || !YMD.test(date) || cells.length === 0) return;
  try {
    const today = kstToday();
    if (date > today || date < addDays(today, -1)) return;

    const admin = createAdminClient();
    // 🔴 테스트 학생(`students.is_test` — 발송 시험용 '학원이')은 알리지 않는다(원장 2026-09-13).
    //    **dedup 앞에서** 뺀다 — 뒤에서 빼면 그 칸의 dedup만 소모돼 나중에 진짜 알림이 막힌다.
    //    묶음 본문이라 그 학생만 빠지고 같은 저장의 실학생 알림은 그대로 나간다.
    const testStudentIds = await getTestStudentIds(admin, tenantId);
    const liveCells = cells.filter((c) => !testStudentIds.has(c.studentId));
    if (liveCells.length === 0) return;
    const classIds = [...new Set(liveCells.map((c) => c.classId))];

    const targets =
      direction === "to_teacher"
        ? await loadClassTeachers(admin, tenantId, classIds, actorId)
        : await loadDeskOptin(admin, tenantId, actorId);
    if (targets.length === 0) return;

    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        liveCells.map((c) => ({
          tenant_id: tenantId,
          event_type: EVENT_TYPE,
          subject_key: c.studentId,
          bucket: `${date}|${c.slotStart ?? ""}`,
          seeded: false,
        })),
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("subject_key, bucket");
    if (dedupError) throw dedupError;
    if (!fresh?.length) return;

    const freshKeys = new Set(fresh.map((f) => `${f.subject_key}|${f.bucket}`));
    const freshCells = liveCells.filter((c) => freshKeys.has(`${c.studentId}|${date}|${c.slotStart ?? ""}`));
    if (freshCells.length === 0) return;
    const freshIds = [...new Set(freshCells.map((c) => c.studentId))];
    // 100에서 자르면 뒤 이름이 벨에서 사라진다(B3). 청크로 전건.
    const students = await fetchInChunks<{ id: string; name: string }>(freshIds, (chunk) =>
      admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const nameById = new Map(students.map((s) => [s.id, s.name]));
    const { names, missing } = collectStudentNames(freshIds, nameById);
    if (missing > 0) {
      reportError(new Error(`cross-notify names incomplete: ${names.length}/${freshIds.length}`), {
        scope: "attendance.crossNotify.names",
        expected: freshIds.length,
        resolved: names.length,
        missing,
      });
    }
    const { who, listedLabel } = formatAttendanceNotifyNames(names, freshIds.length);
    const title =
      direction === "to_teacher" ? `데스크가 출석 처리 — ${who}` : `강사가 뒤늦게 출석 처리 — ${who}`;
    const body =
      direction === "to_teacher"
        ? `${date} 미출결이던 ${listedLabel} 학생을 데스크에서 출석으로 입력했습니다.`
        : `${date} 미출결이던 ${listedLabel} 학생을 강사가 출석으로 입력했습니다.`;

    await notifyUsers(
      targets.map((recipientId) => ({
        tenantId,
        recipientId,
        type: EVENT_TYPE,
        title,
        body,
        link:
          direction === "to_teacher"
            ? date === today
              ? "/attendance/live"
              : `/attendance/live?date=${date}`
            : date === today
              ? "/attendance/live?tab=seating"
              : `/attendance/live?tab=seating&date=${date}`,
        actorId,
      })),
    );
  } catch (e) {
    reportError(e, { scope: "attendance.crossNotify", tenantId, date, via });
  }
}

async function loadClassTeachers(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  classIds: string[],
  actorId: string | null,
): Promise<string[]> {
  const [{ data: klasses }, { data: slots }] = await Promise.all([
    admin.from("classes").select("id, teacher_id").eq("tenant_id", tenantId).in("id", classIds),
    admin
      .from("class_schedules")
      .select("teacher_id")
      .eq("tenant_id", tenantId)
      .in("class_id", classIds)
      .not("teacher_id", "is", null),
  ]);
  return [
    ...new Set(
      [
        ...(klasses ?? []).map((k) => k.teacher_id as string | null),
        ...(slots ?? []).map((s) => s.teacher_id as string),
      ].filter((id): id is string => !!id && id !== actorId),
    ),
  ];
}

/** '출결 데스크 알림' 켠 계정(0212a) — 교차 알림과 '데스크 확인 요청'이 같은 수신자 축을 쓴다. */
export async function loadDeskOptin(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  actorId: string | null,
): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("desk_attendance_optin", true);
  if (error) {
    // 0212a 미적용 — 받을 사람이 없는 것과 같다. 출결 저장은 살린다(#95).
    if (/desk_attendance_optin/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.id as string).filter((id) => id !== actorId);
}
