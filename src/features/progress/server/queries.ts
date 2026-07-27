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
};

/**
 * 이상 감지 1건 — **어떤 이상인지 사람이 읽을 수 있게** 위치 변화까지 담는다.
 * 예전엔 유형 배지("진도 점프 감지") 한 개뿐이라, 진도 이상 알림을 타고 와도 "뭐가 어떻게 이상한지"를
 * 알 수 없었다(2026-07-27 원장 제보). 날짜 + 어디→어디 + 몇 차시가 있어야 진도 입력을 정정할 수 있다.
 */
export type ProgressAnomaly = {
  type: string; // jump_error | overlap_error (표시 라벨은 소비처가 매핑 — raw 노출 금지)
  at: string; // ISO 타임스탬프
  from: { grade: string; lesson: string } | null; // 커리큘럼 범위 밖·미기록이면 null
  to: { grade: string; lesson: string } | null;
  jumpSize: number | null; // 건너뛴 차시 수(overlap_error엔 없을 수 있음)
};

export type StudentProgressAnalytics = {
  studentGrade: string | null;
  tracks: TrackAnalytics[]; // 활성 트랙(현행 먼저)
  totalLessons: number;
  // ⚠️ 트랙별이 아니라 **학생 단위** — progress_events엔 트랙 정보가 없어 예전엔 같은 목록이 현행·선행
  // 카드에 통째로 두 번 찍혔다(같은 이상이 2개로 보임). 학생 단위 1곳에 모아 표시한다.
  anomalies: ProgressAnomaly[];
};

/**
 * 학생 진도 분석 — 활성 컨테이너(현행/선행)별 현재위치·속도·또래 백분위·예측·이상감지.
 * 순수 함수(analytics.ts)로 산출. RLS(테넌트 스코프)로 접근 제한.
 */
export async function getStudentProgressAnalytics(studentId: string): Promise<StudentProgressAnalytics> {
  const supabase = await createClient();
  const today = kstToday();

  const { data: stu } = await supabase.from("students").select("tenant_id, grade").eq("id", studentId).maybeSingle();
  if (!stu) return { studentGrade: null, tracks: [], totalLessons: TOTAL_LESSONS, anomalies: [] };
  const studentGrade = (stu.grade as string | null) ?? null;

  const [{ data: containers }, { data: entryRows }, { data: anomEvents }] = await Promise.all([
    supabase
      .from("progress_containers")
      .select("id, track, status, last_position, chapter_count, grade_scope")
      .eq("student_id", studentId),
    supabase.from("progress_entries").select("global_position, entry_date, container_id").eq("student_id", studentId),
    supabase
      .from("progress_events")
      .select("event_type, created_at, from_position, to_position, jump_size")
      .eq("student_id", studentId)
      .in("event_type", ["jump_error", "overlap_error"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // 위치 번호(글로벌 차시 인덱스)는 화면에 그대로 내면 raw 코드다 — 커리큘럼 라벨("중3 · 3차시")로 변환.
  const describe = (pos: unknown) => {
    if (typeof pos !== "number") return null;
    const d = describePosition(pos);
    return d ? { grade: d.grade, lesson: d.lesson } : null;
  };
  const anomalies: ProgressAnomaly[] = (anomEvents ?? []).map((e) => ({
    type: e.event_type as string,
    at: e.created_at as string,
    from: describe(e.from_position),
    to: describe(e.to_position),
    jumpSize: typeof e.jump_size === "number" ? e.jump_size : null,
  }));

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
    });
  }

  return { studentGrade, tracks, totalLessons: TOTAL_LESSONS, anomalies };
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
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("grade", grade);
  // status <> 'withdrawn'를 JS로 판정 — Postgres neq는 status=NULL을 UNKNOWN→탈락시켜
  // NULL-status 또래(및 대상 학생)가 풀에서 누락되는 걸 방지(NULL은 미탈원으로 간주).
  const ids = (peers ?? []).filter((p) => p.status !== "withdrawn").map((p) => p.id as string);
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
