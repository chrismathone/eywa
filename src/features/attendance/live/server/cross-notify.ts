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
import { reportError } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { addDays, kstToday } from "@/lib/date-kst";
import { crossNotifyDirection } from "../mark-state";
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
    const classIds = [...new Set(cells.map((c) => c.classId))];

    const targets =
      direction === "to_teacher"
        ? await loadClassTeachers(admin, tenantId, classIds, actorId)
        : await loadDeskOptin(admin, tenantId, actorId);
    if (targets.length === 0) return;

    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        cells.map((c) => ({
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
    const freshCells = cells.filter((c) => freshKeys.has(`${c.studentId}|${date}|${c.slotStart ?? ""}`));
    if (freshCells.length === 0) return;
    const freshIds = [...new Set(freshCells.map((c) => c.studentId))];

    const { data: students, error: studentError } = await admin
      .from("students")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", freshIds.slice(0, 100));
    if (studentError) throw studentError;
    const nameById = new Map((students ?? []).map((s) => [s.id as string, s.name as string]));
    const names = [...new Set(freshCells.map((c) => nameById.get(c.studentId)).filter(Boolean))] as string[];
    if (names.length === 0) return;

    const who = names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}명`;
    const title =
      direction === "to_teacher" ? `사무실이 출석 처리 — ${who}` : `강사가 뒤늦게 출석 처리 — ${who}`;
    const body =
      direction === "to_teacher"
        ? `${date} 미출결이던 ${names.join(", ")} 학생을 사무실에서 출석으로 입력했습니다.`
        : `${date} 미출결이던 ${names.join(", ")} 학생을 강사가 출석으로 입력했습니다.`;

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

async function loadDeskOptin(
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
