import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import {
  intersectWindows,
  isSplitDay,
  splitUnitMinutes,
  toMin,
  type SplitDay,
  type TimeWindow,
} from "../rules";

/**
 * 나누기 판단 재료 — 두 반의 정보·그 주 배치·학생의 원래 반 수강. 미리보기와 저장이 **같은 함수**로 읽는다
 * (화면이 보여 준 선택지와 서버가 받아 주는 선택지가 갈리지 않게).
 */
export type SplitClassInfo = {
  id: string;
  name: string;
  subject: string | null;
  englishTrack: string | null;
  teacherName: string | null;
  classroomId: string | null;
};

export type ScheduleRow = {
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
  classroom_id: string | null;
};

export type SplitContext = {
  source: SplitClassInfo;
  target: SplitClassInfo;
  student: { id: string; name: string };
  /** 원래 반에서 지금 열린 수강(없으면 null — 나눌 수 없다). */
  enrollment: { id: string; attendanceDays: string[] } | null;
  /** 요일 → 두 반이 같이 도는 구간(그 주 기준). 비어 있는 요일은 나눌 수 없다. */
  windows: Partial<Record<SplitDay, TimeWindow[]>>;
  /** 받는 반의 그 주 배치(강의실 정원 확인용). */
  targetRows: ScheduleRow[];
  unit: number;
};

type ClassRow = {
  id: string;
  class_name: string;
  subject: string | null;
  english_track: string | null;
  classroom_id: string | null;
  teacher?: { display_name?: string } | { display_name?: string }[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

export async function loadSplitContext(
  sb: SupabaseClient,
  tenantId: string,
  args: { studentId: string; sourceClassId: string; targetClassId: string; refDate: string; onDate: string },
): Promise<SplitContext | { error: string }> {
  const [classes, schedules, student, enrollments] = await Promise.all([
    sb
      .from("classes")
      .select("id, class_name, subject, english_track, classroom_id, teacher:teacher_id ( display_name )")
      .eq("tenant_id", tenantId)
      .in("id", [args.sourceClassId, args.targetClassId]),
    sb
      .from("class_schedules")
      .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, classroom_id")
      .eq("tenant_id", tenantId)
      .in("class_id", [args.sourceClassId, args.targetClassId]),
    sb.from("students").select("id, name").eq("tenant_id", tenantId).eq("id", args.studentId).maybeSingle(),
    sb
      .from("enrollments")
      .select("id, start_date, end_date, attendance_days")
      .eq("tenant_id", tenantId)
      .eq("student_id", args.studentId)
      .eq("class_id", args.sourceClassId),
  ]);
  if (classes.error || schedules.error || student.error || enrollments.error) {
    return { error: "반·학생 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  const toInfo = (r: ClassRow | undefined): SplitClassInfo | null =>
    r
      ? {
          id: r.id,
          name: r.class_name,
          subject: r.subject,
          englishTrack: r.english_track,
          teacherName: one(r.teacher)?.display_name ?? null,
          classroomId: r.classroom_id,
        }
      : null;
  const rows = (classes.data ?? []) as ClassRow[];
  const source = toInfo(rows.find((r) => r.id === args.sourceClassId));
  const target = toInfo(rows.find((r) => r.id === args.targetClassId));
  if (!source || !target) return { error: "반을 찾지 못했습니다." };
  if (!student.data) return { error: "학생을 찾지 못했습니다." };

  // 원래 반 수강 — 나누는 날(onDate)에 열려 있어야 한다(반열림 '[)', end_date 당일은 이미 끝).
  const open = (enrollments.data ?? []).find(
    (e) => e.start_date <= args.onDate && (e.end_date === null || e.end_date > args.onDate),
  );

  const live = ((schedules.data ?? []) as ScheduleRow[]).filter((r) =>
    slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, args.refDate),
  );
  const windowsOf = (classId: string, day: string): TimeWindow[] =>
    live
      .filter((r) => r.class_id === classId && r.day_of_week === day)
      .map((r) => ({ start: toMin(r.start_time), end: toMin(r.end_time) }));
  const windows: Partial<Record<SplitDay, TimeWindow[]>> = {};
  for (const day of new Set(live.map((r) => r.day_of_week))) {
    if (!isSplitDay(day)) continue;
    const both = intersectWindows(windowsOf(source.id, day), windowsOf(target.id, day));
    if (both.length > 0) windows[day] = both;
  }

  return {
    source,
    target,
    student: { id: student.data.id, name: student.data.name },
    enrollment: open ? { id: open.id, attendanceDays: (open.attendance_days as string[] | null) ?? [] } : null,
    windows,
    targetRows: live.filter((r) => r.class_id === target.id),
    unit: splitUnitMinutes([source, target]),
  };
}
