import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { parentPortalAvailable } from "@/features/shuttle/parent/server/parent-availability";
import type { ParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import {
  buildChildTimetable,
  classBlocksByDate,
  type TimetableBlock,
  type TimetableClass,
  type TimetableDayRow,
  type TimetableEnrollment,
  type TimetableSlot,
} from "../parent-timetable";

/**
 * 학부모 '수업 시간표' 재료 — 연결된 아이들의 이번 주 월~금 수업 시각.
 * 🔴 학부모 세션은 RLS로 아무 표도 못 읽는다 → service_role로 읽되 **호출부가 넘긴 아이 id는 `getParentViewer()`의
 *    연결된 아이**여야 하고(주소·폼 값 금지, [[#77]]), 모든 조회에 `tenant_id`를 건다.
 * ⚠️ 실패하면 null(화면은 안내 문구) — 빈 시간표로 삼키면 "수업 없음"이라는 거짓이 된다.
 * 🔑 아이 몇 명 × 반 몇 개라 `.in()`·행 수가 작다 — 그래도 배치 표는 이력이 쌓이니 상한을 명시한다(B2).
 */
/**
 * 학부모 월별 달력의 **수업 있는 날과 그날 수업** — 날짜 → 수업 덩어리(과목 · 시작 · 끝). 수업 없는 날은 없다.
 * ⚠️ 실패하면 null(달력은 표시 없이 그대로 산다 — 등하원 달력을 수업 조회가 멈추게 하지 않는다).
 */
export async function loadParentClassDates(
  viewer: ParentViewer,
  studentId: string,
  dates: readonly { day: string; ymd: string }[],
): Promise<Map<string, TimetableBlock[]> | null> {
  if (dates.length === 0) return new Map();
  const tables = await loadParentTimetables(viewer, [studentId], dates, "dates");
  return tables === null ? null : new Map((tables.get(studentId) ?? []).map((r) => [r.ymd, r.blocks]));
}

export async function loadParentTimetables(
  viewer: ParentViewer,
  studentIds: readonly string[],
  week: readonly { day: string; ymd: string }[],
  /** "dates" = 요일 한 줄씩이 아니라 **수업 있는 날짜마다 한 행** — 월별 달력용. 조회는 같은 한 벌을 쓴다. */
  mode: "week" | "dates" = "week",
): Promise<Map<string, TimetableDayRow[]> | null> {
  const out = new Map<string, TimetableDayRow[]>();
  if (studentIds.length === 0 || week.length === 0) return out;
  if (!(await parentPortalAvailable(viewer))) return out;
  const linked = new Set(viewer.children.map((child) => child.id));
  if (studentIds.some((studentId) => !linked.has(studentId))) return out;
  const tenantId = viewer.tenantId;
  const ymds = week.map((w) => w.ymd).sort();
  const from = ymds[0]!;
  const to = ymds[ymds.length - 1]!;
  const admin = createAdminClient();
  try {
    // 이번 주와 겹치는 수강만.
    const { data: ens, error } = await admin
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, attendance_days")
      .eq("tenant_id", tenantId)
      .in("student_id", [...studentIds])
      .lte("start_date", to)
      .or(`end_date.is.null,end_date.gte.${from}`)
      .limit(200);
    if (error) throw error;
    const classIds = [...new Set((ens ?? []).map((e) => e.class_id as string))];

    const [classRes, slotRes, settings] = await Promise.all([
      classIds.length
        ? admin.from("classes").select("id, class_name, subject").eq("tenant_id", tenantId).in("id", classIds)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? admin
            .from("class_schedules")
            .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to")
            .eq("tenant_id", tenantId)
            .in("class_id", classIds)
            .lte("valid_from", to)
            .or(`valid_to.is.null,valid_to.gte.${from}`)
            .order("id")
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      getTenantSettingsByTenantId(tenantId),
    ]);
    if (classRes.error) throw classRes.error;
    if (slotRes.error) throw slotRes.error;

    const subjects = buildSubjectMaps(settings.operations.subjects);
    const classes = new Map<string, TimetableClass>(
      (classRes.data ?? []).map((c) => [
        c.id as string,
        { name: c.class_name as string, subjectLabel: subjects.labelOf(c.subject as string) },
      ]),
    );
    const slots: TimetableSlot[] = (slotRes.data ?? []).map((s) => ({
      classId: s.class_id as string,
      day: s.day_of_week as string,
      start: String(s.start_time).slice(0, 5),
      end: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from ? String(s.valid_from).slice(0, 10) : null,
      validTo: s.valid_to ? String(s.valid_to).slice(0, 10) : null,
    }));

    for (const id of studentIds) {
      const enrollments: TimetableEnrollment[] = (ens ?? [])
        .filter((e) => e.student_id === id)
        .map((e) => ({
          classId: e.class_id as string,
          startDate: String(e.start_date).slice(0, 10),
          endDate: e.end_date ? String(e.end_date).slice(0, 10) : null,
          onHold: e.on_hold === true,
          attendanceDays: (Array.isArray(e.attendance_days) ? e.attendance_days : []) as string[],
        }));
      out.set(
        id,
        mode === "dates"
          ? [...classBlocksByDate({ dates: week, enrollments, slots, classes })].map(([ymd, blocks]) => ({ day: "mon" as const, ymd, blocks }))
          : buildChildTimetable({ week, enrollments, slots, classes }),
      );
    }
    return out;
  } catch (e) {
    reportError(e, { scope: "classes.parentTimetable" });
    return null;
  }
}
