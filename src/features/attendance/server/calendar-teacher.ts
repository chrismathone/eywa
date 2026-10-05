import "server-only";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { isHolidayOn } from "@/features/class-sheets/lib/holiday";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { lessonProfileOf, type LessonProfile } from "@/features/owner/lesson-profile";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { createAdminClient } from "@/lib/supabase/admin";

const DIFFERS = "같은 날 정규 수업의 담당 강사와 보강 강사가 달라 함께 기록할 수 없습니다";
const UNKNOWN = "정규 시간표를 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";

type Db = Pick<ReturnType<typeof createAdminClient>, "from">;

export type CurrentCalendar =
  | { status: "none"; profile: LessonProfile }
  | { status: "unknown" }
  | { status: "ready"; teachers: (string | null)[]; profile: LessonProfile };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ymd(value: unknown): string | null {
  const day = text(value)?.slice(0, 10) ?? null;
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function openClass(row: { is_active?: unknown; closed_at?: unknown } | null, date: string): boolean {
  if (!row || row.is_active !== true) return false;
  if (row.closed_at == null || row.closed_at === "") return true;
  const closed = ymd(row.closed_at);
  return closed != null && closed >= date;
}

/** 그날 유효한 정규 교시의 실효 담당. 교시 담당이 비면 반 담임. 없으면 null. */
export function currentCalendarTeachers(
  date: string,
  classTeacherId: string | null,
  rows: readonly { day_of_week?: unknown; teacher_id?: unknown; valid_from?: unknown; valid_to?: unknown }[],
): (string | null)[] | null {
  const dow = dowKeyOf(date);
  const ids = new Set<string>();
  let any = false;
  for (const row of rows) {
    if (text(row.day_of_week)?.toLowerCase() !== dow) continue;
    const from = ymd(row.valid_from);
    if (!from || from > date) continue;
    if (row.valid_to != null && row.valid_to !== "") {
      const until = ymd(row.valid_to);
      if (!until || until < date) continue;
    }
    any = true;
    ids.add(text(row.teacher_id) ?? classTeacherId ?? "");
  }
  if (!any) return null;
  return [...ids].map((id) => id || null);
}

/** 시간표가 없거나 담당이 같으면 null. 모르거나 다르면 연결 효과를 멈추는 문장. */
export function calendarTeacherHold(calendar: CurrentCalendar, makeupTeacherId: string | null): string | null {
  if (calendar.status === "none") return null;
  if (calendar.status === "unknown") return UNKNOWN;
  const teachers = calendar.teachers;
  if (teachers.length !== 1) return DIFFERS;
  const only = teachers[0];
  if (!only || !makeupTeacherId || only !== makeupTeacherId) return DIFFERS;
  return null;
}

/** 정규 시간표의 현재 담당. 조회 실패는 수업이 없다는 뜻이 아니다. 프로필은 이 엄격 조회 한 번으로만 정한다. */
export async function loadCurrentCalendar(db: Db, tenantId: string, classId: string, date: string): Promise<CurrentCalendar> {
  const tenant = tenantId.trim();
  const klass = classId.trim();
  const day = date.trim();
  if (!tenant || !klass || !day) return { status: "unknown" };
  try {
    const settings = await getTenantSettingsByTenantId(tenant, { failOnReadError: true });
    const profile = lessonProfileOf(settings);
    if (isHolidayOn(buildHolidayMap(settings.operations?.holidays), day)) return { status: "none", profile };
    const cls = await db.from("classes").select("teacher_id, is_active, closed_at").eq("tenant_id", tenant).eq("id", klass).maybeSingle();
    if (cls.error) return { status: "unknown" };
    if (!openClass(cls.data, day)) return { status: "none", profile };
    const rows = await fetchAllPaged<{
      day_of_week: string; teacher_id: string | null; valid_from: string; valid_to: string | null;
    }>((from, to) =>
      db.from("class_schedules")
        .select("day_of_week, teacher_id, valid_from, valid_to")
        .eq("tenant_id", tenant)
        .eq("class_id", klass)
        .lte("valid_from", day)
        .or(`valid_to.is.null,valid_to.gte.${day}`)
        .order("id")
        .range(from, to),
    );
    const teachers = currentCalendarTeachers(day, text(cls.data?.teacher_id), rows);
    return teachers ? { status: "ready", teachers, profile } : { status: "none", profile };
  } catch {
    return { status: "unknown" };
  }
}
