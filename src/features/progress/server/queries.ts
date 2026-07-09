import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { computeSpeedStats, percentileOf, predict, type ProgressEntry } from "../analytics";
import { describePosition, TOTAL_LESSONS, type Track } from "../curriculum-position";

const WINDOW_DAYS = 30;

export type TrackAnalytics = {
  track: Track;
  current: { position: number; grade: string; unit: string; lesson: string } | null;
  chapterCount: number; // 이 컨테이너에 담긴 보고서 수
  gradeScope: string | null;
  progressPct: number; // 전체 커리큘럼 대비 위치 %
  speedPerLessonDay: number;
  lessonDays: number;
  percentile: number | null; // 같은 학년×track 또래 대비 상위 %(클수록 빠름). null=표본 없음
  poolSize: number;
  predictions: { days: number; grade: string; lesson: string }[]; // speed>0일 때만
  anomalies: { type: string; at: string }[]; // 최근 jump_error/overlap_error
};

export type StudentProgressAnalytics = {
  studentGrade: string | null;
  tracks: TrackAnalytics[]; // 활성 트랙(현행 먼저)
  totalLessons: number;
};

/**
 * 학생 진도 분석 — 활성 컨테이너(현행/선행)별 현재위치·속도·또래 백분위·예측·이상감지.
 * 순수 함수(analytics.ts)로 산출. RLS(테넌트 스코프)로 접근 제한.
 */
export async function getStudentProgressAnalytics(studentId: string): Promise<StudentProgressAnalytics> {
  const supabase = await createClient();
  const today = kstToday();

  const { data: stu } = await supabase.from("students").select("tenant_id, grade").eq("id", studentId).maybeSingle();
  if (!stu) return { studentGrade: null, tracks: [], totalLessons: TOTAL_LESSONS };
  const studentGrade = (stu.grade as string | null) ?? null;

  const [{ data: containers }, { data: entryRows }, { data: anomEvents }] = await Promise.all([
    supabase
      .from("progress_containers")
      .select("id, track, status, last_position, chapter_count, grade_scope")
      .eq("student_id", studentId),
    supabase.from("progress_entries").select("global_position, entry_date, container_id").eq("student_id", studentId),
    supabase
      .from("progress_events")
      .select("event_type, created_at")
      .eq("student_id", studentId)
      .in("event_type", ["jump_error", "overlap_error"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const conts = containers ?? [];
  const contTrack = new Map<string, Track>(conts.map((c) => [c.id as string, c.track as Track]));
  const activeByTrack = new Map<Track, (typeof conts)[number]>();
  for (const c of conts) if (c.status === "active") activeByTrack.set(c.track as Track, c);

  const tracks: TrackAnalytics[] = [];
  for (const track of ["current", "ahead"] as const) {
    const active = activeByTrack.get(track);
    if (!active) continue;
    const trackEntries: ProgressEntry[] = (entryRows ?? [])
      .filter((e) => contTrack.get(e.container_id as string) === track)
      .map((e) => ({ globalPosition: e.global_position as number, entryDate: e.entry_date as string }));
    const speed = computeSpeedStats(trackEntries, WINDOW_DAYS, today);

    const pool = studentGrade ? await peerSpeeds(supabase, stu.tenant_id as string, studentGrade, track, today) : [];
    const percentile = percentileOf(speed.speedPerLessonDay, pool);

    const cur = active.last_position != null ? describePosition(active.last_position as number) : null;
    const predictions =
      speed.speedPerDay > 0 && active.last_position != null
        ? predict(active.last_position as number, speed.speedPerDay, [30, 90]).map((p) => {
            const d = describePosition(p.position);
            return { days: p.days, grade: d?.grade ?? "", lesson: d?.lesson ?? "" };
          })
        : [];

    tracks.push({
      track,
      current: cur ? { position: cur.position, grade: cur.grade, unit: cur.unit, lesson: cur.lesson } : null,
      chapterCount: (active.chapter_count as number) ?? 0,
      gradeScope: (active.grade_scope as string | null) ?? null,
      progressPct: cur ? Math.round((cur.position / TOTAL_LESSONS) * 100) : 0,
      speedPerLessonDay: speed.speedPerLessonDay,
      lessonDays: speed.lessonDays,
      percentile,
      poolSize: pool.length,
      predictions,
      anomalies: (anomEvents ?? []).map((e) => ({ type: e.event_type as string, at: e.created_at as string })),
    });
  }

  return { studentGrade, tracks, totalLessons: TOTAL_LESSONS };
}

/** 같은 학년×track 또래의 수업당 속도 배열(백분위 풀). 활성 컨테이너 있는 학생만, 대상 학생 포함. */
async function peerSpeeds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  grade: string,
  track: Track,
  today: string,
): Promise<number[]> {
  const { data: peers } = await supabase
    .from("students")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .neq("status", "withdrawn");
  const ids = (peers ?? []).map((p) => p.id as string);
  if (ids.length === 0) return [];

  const { data: conts } = await supabase
    .from("progress_containers")
    .select("id, student_id, status")
    .eq("track", track)
    .in("student_id", ids);
  const trackContByStudent = new Map<string, Set<string>>();
  const activeStudents = new Set<string>();
  for (const c of conts ?? []) {
    const sid = c.student_id as string;
    if (!trackContByStudent.has(sid)) trackContByStudent.set(sid, new Set());
    trackContByStudent.get(sid)!.add(c.id as string);
    if (c.status === "active") activeStudents.add(sid);
  }
  const activeIds = [...activeStudents];
  if (activeIds.length === 0) return [];

  const { data: entryRows } = await supabase
    .from("progress_entries")
    .select("student_id, global_position, entry_date, container_id")
    .in("student_id", activeIds);
  const byStudent = new Map<string, ProgressEntry[]>();
  for (const e of entryRows ?? []) {
    const sid = e.student_id as string;
    if (!trackContByStudent.get(sid)?.has(e.container_id as string)) continue;
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid)!.push({ globalPosition: e.global_position as number, entryDate: e.entry_date as string });
  }
  return activeIds.map((id) => computeSpeedStats(byStudent.get(id) ?? [], WINDOW_DAYS, today).speedPerLessonDay);
}
