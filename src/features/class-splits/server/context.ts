import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import {
  mergeWindows,
  splitBoundaries,
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
  /** 요일 → 받는 반의 그날 수업 구간(두 반이 둘 다 도는 요일만, 그 주 기준). 비어 있는 요일은 나눌 수 없다. */
  windows: Partial<Record<SplitDay, TimeWindow[]>>;
  /** 요일 → 겹치는 구간을 **교시 칸**으로 자른 경계(`splitBoundaries`). 선택지·저장 검증이 이것만 본다. */
  bounds: Partial<Record<SplitDay, number[][]>>;
  /** 받는 반의 그 주 배치(강의실 정원 확인용). */
  targetRows: ScheduleRow[];
  /** 원래 반의 그 주 배치(고른 시간이 원래 수업 밖인지 알리는 데). */
  sourceRows: ScheduleRow[];
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
  const unit = splitUnitMinutes([source, target]);
  const windows: Partial<Record<SplitDay, TimeWindow[]>> = {};
  const bounds: Partial<Record<SplitDay, number[][]>> = {};
  for (const day of new Set(live.map((r) => r.day_of_week))) {
    if (!isSplitDay(day)) continue;
    // 🔑 요일 = 두 반이 **둘 다 도는 날**(그날 수업의 일부를 다른 반에서) · 시간 = **받는 반의 수업 시간 안**.
    //    원장 2026-10-06 *"유형숙은 18시부터 22시까진데 20시부터 된다는데 — 옮겨지는 쌤 시간 내에서"* — 두 반이
    //    겹치는 구간으로 좁히면 받는 선생님 반의 앞 교시를 못 고른다. 원래 반과 안 겹치는 시간도 고를 수 있다
    //    (그 시간 원래 반 출결은 그대로다 — 출석부 규약이 겹치는 교시만 뺀다).
    const sourceWins = windowsOf(source.id, day);
    const targetWins = windowsOf(target.id, day);
    if (sourceWins.length === 0 || targetWins.length === 0) continue;
    const targetSpan = mergeWindows(targetWins);
    windows[day] = targetSpan;
    // 교시 경계 = 받는 반 배치 행의 시작·끝 — 칸이 곧 단위다(수학 55분 교시 = '1시간').
    const b = splitBoundaries(targetSpan, targetWins.flatMap((w) => [w.start, w.end]), unit);
    if (b.length > 0) bounds[day] = b;
  }

  return {
    source,
    target,
    student: { id: student.data.id, name: student.data.name },
    enrollment: open ? { id: open.id, attendanceDays: (open.attendance_days as string[] | null) ?? [] } : null,
    windows,
    bounds,
    targetRows: live.filter((r) => r.class_id === target.id),
    sourceRows: live.filter((r) => r.class_id === source.id),
    unit,
  };
}
