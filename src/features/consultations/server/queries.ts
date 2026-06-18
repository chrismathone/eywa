import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";

export type StudentConsultationCategory =
  | "general"
  | "academic"
  | "emotional"
  | "career"
  | "social"
  | "other";

export type StudentConsultationAudience = "parent" | "student" | "both";

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
};

export type StudentConsultationDetail = StudentConsultationRow & {
  counselorId: string | null;
};

const SELECT_COLUMNS = `id, consulted_at, summary, follow_up_action,
  follow_up_date, follow_up_done, category, subject, audience, counselor_id,
  student:student_id ( id, name, grade ),
  counselor:counselor_id ( display_name )`;

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
  student: unknown;
  counselor: unknown;
}): StudentConsultationDetail {
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
    counselorId: r.counselor_id,
    counselorName: counselor?.display_name ?? null,
    consultedAt: r.consulted_at,
    category: r.category as StudentConsultationCategory | null,
    subject: r.subject,
    audience: r.audience as StudentConsultationAudience | null,
    summary: r.summary,
    followUpAction: r.follow_up_action,
    followUpDate: r.follow_up_date,
    followUpDone: r.follow_up_done,
  };
}

export async function getStudentConsultations(): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(SELECT_COLUMNS)
    .order("consulted_at", { ascending: false });

  if (!data) return [];
  return data.map(mapRow);
}

export async function getStudentConsultationById(
  id: string,
): Promise<StudentConsultationDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .single();
  if (!data) return null;
  return mapRow(data);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** 로컬 기준 YYYY-MM-DD (offset일 가산). follow_up_date(date) 비교용. */
function localDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
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
  const [{ count: total }, { count: lastWeek }, { count: pending }, { count: overdue }] =
    await Promise.all([
      supabase.from("student_consultations").select("*", { count: "exact", head: true }),
      supabase
        .from("student_consultations")
        .select("*", { count: "exact", head: true })
        .gte("consulted_at", isoDaysAgo(7)),
      supabase
        .from("student_consultations")
        .select("*", { count: "exact", head: true })
        .eq("follow_up_done", false)
        .not("follow_up_date", "is", null),
      supabase
        .from("student_consultations")
        .select("*", { count: "exact", head: true })
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
  let qb = supabase.from("student_consultations").select(SELECT_COLUMNS, { count: "exact" });

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
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
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
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, status")
    .neq("status", "withdrawn")
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
  const sinceIso = since.toISOString();

  const { data } = await supabase
    .from("student_consultations")
    .select("category")
    .gte("consulted_at", sinceIso);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const key = (r.category as string) ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
}

export type MonthlyBucket = { month: string; enrollment: number; student: number };

export async function getConsultationTrend(monthCount = 6): Promise<MonthlyBucket[]> {
  const supabase = await createClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);

  const [{ data: ec }, { data: sc }] = await Promise.all([
    supabase
      .from("enrollment_consultations")
      .select("consulted_at")
      .gte("consulted_at", start.toISOString()),
    supabase
      .from("student_consultations")
      .select("consulted_at")
      .gte("consulted_at", start.toISOString()),
  ]);

  const buckets = new Map<string, MonthlyBucket>();
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(k, { month: k, enrollment: 0, student: 0 });
  }

  for (const r of ec ?? []) {
    const d = new Date(r.consulted_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.enrollment++;
  }
  for (const r of sc ?? []) {
    const d = new Date(r.consulted_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.student++;
  }

  return Array.from(buckets.values());
}
