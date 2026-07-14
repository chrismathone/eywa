import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";

export type StudentConsultationCategory =
  | "general"
  | "academic"
  | "emotional"
  | "career"
  | "social"
  | "other";

export type StudentConsultationAudience = "parent" | "student" | "both";

/** 음성→전사→AI 처리 상태(0045a) — student_consultations.processing_status. */
export type ConsultationProcessingStatus =
  | "idle"
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

/** AI 분석 7섹션(features/consultations/server/ai.ts StudentConsultationReport와 동일). */
export type StudentConsultationAiReport = {
  summary: string;
  mainTopics: string;
  studentState: string;
  parentConcerns: string;
  actionItems: string;
  followUps: string;
  warnings: string;
};

export type StudentConsultationRow = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  counselorName: string | null;
  consultedAt: string;
  category: StudentConsultationCategory | null;
  subject: string | null;
  audience: StudentConsultationAudience | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  // 녹음/AI 인디케이터(목록 배지)
  processingStatus: ConsultationProcessingStatus;
  hasAudio: boolean;
  hasAi: boolean;
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
};

export type StudentConsultationDetail = StudentConsultationRow & {
  counselorId: string | null;
  transcription: string | null;
  audioDurationSec: number | null;
  processingError: string | null;
  aiReport: StudentConsultationAiReport | null;
  aiSummary: string | null;
  aiModelVersion: string | null;
  aiGeneratedAt: string | null;
};

const SELECT_COLUMNS = `id, consulted_at, summary, follow_up_action,
  follow_up_date, follow_up_done, category, subject, audience, counselor_id,
  processing_status, audio_path, ai_summary, sync_added_at,
  student:student_id ( id, name, grade ),
  counselor:counselor_id ( display_name )`;

// 상세는 무거운 컬럼(전사·ai_report)까지 — 목록 SELECT_COLUMNS에는 미포함(낭비 회피).
const DETAIL_SELECT = `${SELECT_COLUMNS},
  transcription, audio_duration_sec, processing_error,
  ai_report, ai_model_version, ai_generated_at`;

function mapRow(r: {
  id: string;
  consulted_at: string;
  summary: string;
  follow_up_action: string | null;
  follow_up_date: string | null;
  follow_up_done: boolean;
  category: string | null;
  subject: string | null;
  audience: string | null;
  counselor_id: string | null;
  processing_status?: string | null;
  audio_path?: string | null;
  ai_summary?: string | null;
  sync_added_at?: string | null;
  student: unknown;
  counselor: unknown;
}): StudentConsultationRow {
  const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
    | { id: string; name: string; grade: string | null }
    | undefined;
  const counselor = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
    | { display_name?: string }
    | undefined;
  return {
    id: r.id,
    studentId: student?.id ?? "",
    studentName: student?.name ?? "?",
    studentGrade: student?.grade ?? null,
    counselorName: counselor?.display_name ?? null,
    consultedAt: r.consulted_at,
    category: r.category as StudentConsultationCategory | null,
    subject: r.subject,
    audience: r.audience as StudentConsultationAudience | null,
    summary: r.summary,
    followUpAction: r.follow_up_action,
    followUpDate: r.follow_up_date,
    followUpDone: r.follow_up_done,
    processingStatus: (r.processing_status as ConsultationProcessingStatus | null) ?? "idle",
    hasAudio: !!r.audio_path,
    hasAi: !!r.ai_summary,
    syncAddedAt: r.sync_added_at ?? null,
  };
}

export async function getStudentConsultationById(
  id: string,
): Promise<StudentConsultationDetail | null> {
  const supabase = await createClient();
  // 강사 스코프: 강사는 **본인이 등록한 상담**만 열람 — 남의 상담은 URL 직접 진입해도 null(notFound).
  // (RLS는 테넌트만 격리하므로 역할·작성자 스코프는 앱 레벨에서 강제 #58. 목록/검색과 동일 불변식.)
  const tId = await effectiveTeacherId();
  let qb = supabase.from("student_consultations").select(DETAIL_SELECT).eq("id", id);
  if (tId) qb = qb.eq("counselor_id", tId);
  const { data } = await qb.maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    ...mapRow(data),
    counselorId: (d.counselor_id as string | null) ?? null,
    transcription: (d.transcription as string | null) ?? null,
    audioDurationSec: (d.audio_duration_sec as number | null) ?? null,
    processingError: (d.processing_error as string | null) ?? null,
    aiReport: (d.ai_report as StudentConsultationAiReport | null) ?? null,
    aiSummary: (d.ai_summary as string | null) ?? null,
    aiModelVersion: (d.ai_model_version as string | null) ?? null,
    aiGeneratedAt: (d.ai_generated_at as string | null) ?? null,
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** KST 기준 YYYY-MM-DD (offset일 가산). follow_up_date(date) 비교용 — 서버 UTC 오차 방지. */
function localDateStr(offsetDays = 0): string {
  if (offsetDays === 0) return kstToday();
  const [y, m, d0] = kstToday().split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d0! + offsetDays)).toISOString().slice(0, 10);
}

export type StudentConsultationCounts = {
  total: number;
  lastWeek: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
};

/** Stat 카드용 경량 집계 (head:true count — 행 fetch 0). */
export async function getStudentConsultationCounts(): Promise<StudentConsultationCounts> {
  const supabase = await createClient();
  const today = localDateStr(0);
  // 강사 스코프: Stat 카드도 **본인이 등록한 상담(counselor_id=나)** 기준(목록과 일치).
  // 담당 학생이어도 남이 쓴 상담은 제외 — 작성자 기준(사용자 요청 "내가 한 것만").
  const teacherId = await effectiveTeacherId();
  const base = () => {
    const q = supabase.from("student_consultations").select("*", { count: "exact", head: true });
    return teacherId ? q.eq("counselor_id", teacherId) : q;
  };
  const [{ count: total }, { count: lastWeek }, { count: pending }, { count: overdue }] =
    await Promise.all([
      base(),
      base().gte("consulted_at", isoDaysAgo(7)),
      base().eq("follow_up_done", false).not("follow_up_date", "is", null),
      base()
        .eq("follow_up_done", false)
        .not("follow_up_date", "is", null)
        .lt("follow_up_date", today),
    ]);
  return {
    total: total ?? 0,
    lastWeek: lastWeek ?? 0,
    pendingFollowUps: pending ?? 0,
    overdueFollowUps: overdue ?? 0,
  };
}

export type ConsultationListFilters = {
  q?: string;
  range?: "all" | "7d" | "30d";
  cat?: "all" | StudentConsultationCategory;
  urg?: "all" | "overdue" | "today" | "soon" | "later" | "done";
};

/**
 * 필터 적용 + 서버 페이지네이션. urgency는 followUpUrgency() 로직을 SQL로 표현,
 * 검색은 요약(base) OR 학생명(조인 id 해석)으로 처리. {rows,total} 반환.
 */
export async function getStudentConsultationsPage(
  filters: ConsultationListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: StudentConsultationRow[]; total: number }> {
  const supabase = await createClient();

  // 강사 스코프: teacher면 **본인이 등록한 상담(counselor_id=나)** 만 — 담당 학생이어도 남이 쓴 상담은 제외.
  // (사용자 요청 "내가 한 것만 보이게". 담당 학생 기준이던 것에서 작성자 기준으로 전환.)
  const teacherId = await effectiveTeacherId();

  let qb = supabase.from("student_consultations").select(SELECT_COLUMNS, { count: "exact" });
  if (teacherId) qb = qb.eq("counselor_id", teacherId);

  // 기간
  if (filters.range === "7d") qb = qb.gte("consulted_at", isoDaysAgo(7));
  else if (filters.range === "30d") qb = qb.gte("consulted_at", isoDaysAgo(30));

  // 카테고리
  if (filters.cat && filters.cat !== "all") qb = qb.eq("category", filters.cat);

  // 후속 긴급도 — followUpUrgency()와 동일 의미를 SQL로
  const today = localDateStr(0);
  const in3 = localDateStr(3);
  switch (filters.urg) {
    case "done":
      qb = qb.eq("follow_up_done", true);
      break;
    case "overdue":
      qb = qb
        .eq("follow_up_done", false)
        .not("follow_up_date", "is", null)
        .lt("follow_up_date", today);
      break;
    case "today":
      qb = qb.eq("follow_up_done", false).eq("follow_up_date", today);
      break;
    case "soon":
      qb = qb
        .eq("follow_up_done", false)
        .gt("follow_up_date", today)
        .lte("follow_up_date", in3);
      break;
    case "later":
      qb = qb.eq("follow_up_done", false).gt("follow_up_date", in3);
      break;
    default:
      break;
  }

  // 검색 — 요약(base) OR 학생명(조인). 학생명은 id 해석 후 in.(...)으로 OR.
  const term = filters.q?.trim();
  if (term) {
    const { data: stu } = await supabase
      .from("students")
      .select("id")
      .ilike("name", `%${term}%`);
    const ids = (stu ?? []).map((s) => s.id);
    const safe = term.replace(/[(),]/g, " "); // PostgREST .or 파서 보호
    const orParts = [`summary.ilike.%${safe}%`];
    if (ids.length) orParts.push(`student_id.in.(${ids.join(",")})`);
    qb = qb.or(orParts.join(","));
  }

  const from = (page - 1) * pageSize;
  const { data, count } = await qb
    .order("consulted_at", { ascending: false })
    .range(from, from + pageSize - 1);

  return { rows: (data ?? []).map(mapRow), total: count ?? 0 };
}

/** follow-up 긴급도: ijw의 getFollowUpUrgency() 포팅 */
export type FollowUpUrgency = "done" | "overdue" | "today" | "soon" | "later" | "none";

export function followUpUrgency(
  date: string | null,
  done: boolean,
): FollowUpUrgency {
  if (done) return "done";
  if (!date) return "none";
  // 날짜-only 비교(KST 오늘 기준) — 양쪽 UTC 자정 파싱이라 TZ 영향 없음(relativeDayKo 패턴).
  const diff = Math.round(
    (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${kstToday()}T00:00:00Z`)) / 86_400_000,
  );
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "later";
}

export type StudentOption = {
  id: string;
  name: string;
  grade: string | null;
};

export async function getStudentOptionsForConsultation(): Promise<StudentOption[]> {
  const supabase = await createClient();
  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 학생만 상담 대상 드롭다운에.
  const teacherStudentIds = (await effectiveTeacherScope())?.studentIds ?? null;
  if (teacherStudentIds && teacherStudentIds.length === 0) return [];
  let qb = supabase
    .from("students")
    .select("id, name, grade, status")
    .neq("status", "withdrawn");
  if (teacherStudentIds) qb = qb.in("id", teacherStudentIds);
  const { data } = await qb
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  if (!data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, grade: r.grade }));
}

export type ConsultationNeededRow = {
  id: string;
  name: string;
  grade: string | null;
  lastConsultedAt: string | null;
  daysSince: number | null;
};

/**
 * 상담 필요 학생 — 재원생 중 마지막 학생상담이 thresholdDays 초과(또는 한 번도 없음).
 * 상담 1340건을 전건 안전 수집(fetchAllPaged, 1000행 절단 회피) 후 학생별 최신만 집계.
 */
export async function getStudentsNeedingConsultation(
  thresholdDays = 30,
  limit = 20,
): Promise<{ rows: ConsultationNeededRow[]; total: number }> {
  const supabase = await createClient();
  const enrolled = await fetchAllPaged<{ id: string; name: string; grade: string | null }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, grade")
      .eq("status", "enrolled")
      .order("name", { ascending: true })
      .range(from, to),
  );
  if (enrolled.length === 0) return { rows: [], total: 0 };

  const consults = await fetchAllPaged<{ student_id: string; consulted_at: string }>((from, to) =>
    supabase
      .from("student_consultations")
      .select("student_id, consulted_at")
      .order("consulted_at", { ascending: false })
      .range(from, to),
  );
  const last = new Map<string, string>();
  for (const c of consults) {
    if (!last.has(c.student_id)) last.set(c.student_id, c.consulted_at); // desc → 첫 등장이 최신
  }

  const now = Date.now();
  const cutoff = now - thresholdDays * 86_400_000;
  const all = enrolled
    .map((s) => {
      const lc = last.get(s.id) ?? null;
      const t = lc ? new Date(lc).getTime() : null;
      return {
        id: s.id,
        name: s.name,
        grade: s.grade,
        lastConsultedAt: lc,
        daysSince: t ? Math.floor((now - t) / 86_400_000) : null,
      };
    })
    .filter((r) => r.lastConsultedAt === null || new Date(r.lastConsultedAt).getTime() < cutoff)
    .sort((a, b) => {
      if (a.lastConsultedAt === null && b.lastConsultedAt !== null) return -1;
      if (b.lastConsultedAt === null && a.lastConsultedAt !== null) return 1;
      return (b.daysSince ?? 0) - (a.daysSince ?? 0);
    });

  return { rows: all.slice(0, limit), total: all.length };
}

// ────────────────────── 통계뷰 ──────────────────────

export type ConsultationFunnelPoint = {
  enrollmentConsultations: number; // 등록상담 전체
  studentConsultations: number; // 학생상담 전체
  enrolled: number; // 등록상담 → 학생전환된 수 (linked_student_id 채워진 row)
  conversionRate: number; // enrolled / enrollmentConsultations
};

export async function getConsultationFunnel(
  monthCount = 6,
): Promise<ConsultationFunnelPoint> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);
  const sinceIso = since.toISOString();

  const [
    { count: ec },
    { count: sc },
    { count: enr },
  ] = await Promise.all([
    supabase
      .from("enrollment_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso),
    supabase
      .from("student_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso),
    supabase
      .from("enrollment_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso)
      .not("student_id", "is", null),
  ]);

  const enrollmentConsultations = ec ?? 0;
  const enrolled = enr ?? 0;
  return {
    enrollmentConsultations,
    studentConsultations: sc ?? 0,
    enrolled,
    conversionRate:
      enrollmentConsultations > 0 ? (enrolled / enrollmentConsultations) * 100 : 0,
  };
}

export type CategoryBucket = { category: string; count: number };

export async function getConsultationByCategory(
  monthCount = 6,
): Promise<CategoryBucket[]> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);

  // DB group-by RPC(0040a) — 전건 fetch + JS Map 집계는 PostgREST ~1000행에서 잘려(#54) 데모 상담 1340행 중
  // 340행을 잃고 카테고리 분포가 과소집계됐다. 집계를 DB로 내려 1쿼리·무절단.
  const { data } = await supabase.rpc("consultation_category_counts", {
    p_since: since.toISOString(),
  });
  return (data ?? []).map((r: { category: string; count: number }) => ({
    category: r.category ?? "other",
    count: Number(r.count),
  }));
}

export type MonthlyBucket = { month: string; enrollment: number; student: number };

export async function getConsultationTrend(monthCount = 6): Promise<MonthlyBucket[]> {
  const supabase = await createClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);

  // DB group-by RPC(0040a) — 양 테이블 전건 fetch + JS 버킷팅은 ~1000행에서 잘려(#54) 추세 student 라인이
  // 과소집계됐다(데모 student_consultations 1340행/6개월). 월별 집계를 DB로 내려 무절단.
  const { data } = await supabase.rpc("consultation_monthly_trend", {
    p_start: start.toISOString(),
  });
  const byMonth = new Map<string, { enrollment: number; student: number }>();
  for (const r of (data ?? []) as { month: string; enrollment: number; student: number }[]) {
    byMonth.set(r.month, { enrollment: Number(r.enrollment), student: Number(r.student) });
  }

  // 데이터 없는 달도 0으로 채워 monthCount개 버킷 유지(기존 출력 형태 보존).
  const buckets: MonthlyBucket[] = [];
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const hit = byMonth.get(k);
    buckets.push({ month: k, enrollment: hit?.enrollment ?? 0, student: hit?.student ?? 0 });
  }
  return buckets;
}
