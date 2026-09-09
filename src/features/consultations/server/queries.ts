import "server-only";
import { cache } from "react";
import {
  addIsoDateDays,
  followUpUrgency,
  type FollowUpUrgency,
} from "@/features/consultations/follow-up-urgency";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";

export { followUpUrgency, type FollowUpUrgency };

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

export type StudentConsultationCounts = {
  total: number;
  lastWeek: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
};

/** Stat 카드용 경량 집계 (head:true count — 행 fetch 0). */
export async function getStudentConsultationCounts(): Promise<StudentConsultationCounts> {
  const supabase = await createClient();
  const today = kstToday();
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
  /** 상담사(=작성자) `users.id`. 옵션은 **실제 상담이 있는 사람만**(getConsultationFilterOptions). */
  counselor?: string;
  /**
   * 과목 — 학원설정 과목 **키**(`math`)를 받는다.
   * 🔴 저장값은 키가 아니라 **한글 라벨**이다(실측 2026-09-09: `영어` 530 · `수학` 313 · 없음 949 — 이 칸이
   *    자유 입력이고 makeedu 이관분도 라벨로 들어왔다). 그래서 키·라벨 **둘 다**로 맞춘다(`.in`) — 키만 보면
   *    한 건도 안 걸리고, 라벨만 URL에 실으면 과목명을 바꾸는 순간 저장된 링크가 죽는다.
   */
  subject?: string;
  /** `subject` 키에 대응하는 학원설정 한글 라벨(호출부가 buildSubjectMaps로 구해 넘긴다 — 서버 쿼리가 설정을 또 읽지 않게). */
  subjectLabel?: string | null;
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

  // 상담사(작성자) — 강사 스코프가 이미 자기 것만 남겼으면 이 필터는 사실상 무동작이다(같은 조건).
  if (filters.counselor && filters.counselor !== "all") qb = qb.eq("counselor_id", filters.counselor);

  // 과목 — 저장값이 한글 라벨이라 키·라벨 둘 다 허용(위 타입 주석).
  if (filters.subject && filters.subject !== "all") {
    const wanted = [filters.subject, filters.subjectLabel].filter((v): v is string => !!v);
    qb = qb.in("subject", [...new Set(wanted)]);
  }

  // 후속 긴급도 — followUpUrgency()와 동일 의미를 SQL로
  const today = kstToday();
  const in3 = addIsoDateDays(today, 3);
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

/**
 * 목록 필터 드롭다운의 **상담사 선택지** — 원장 2026-09-09 *"상담 필터에 강사명도 있어야함."*
 *
 * 🔴 직원 명부(users)를 그대로 세우지 않는다 — 상담을 한 번도 안 쓴 사람까지 34명 넘게 서면 고르기가 더 어렵다.
 *    **실제로 상담 기록이 있는 사람만**(실측 2026-09-09: 34명) 세운다(보고서 목록의 강사 옵션과 같은 규약).
 * 🔴 강사 스코프를 그대로 물려받는다 — 목록이 본인 것만 보이는 계정에게 남의 이름을 고르게 하면 고를수록 0건이다.
 * ⚠️ distinct는 PostgREST가 못 하므로 counselor_id만 **전건 페이지네이션**으로 받아 접는다(B2 — bare select 금지).
 *    컬럼 하나(uuid)뿐이라 가볍고, 요청 캐시(React cache)라 한 화면에서 한 번만 돈다.
 */
export const getConsultationCounselorOptions = cache(async (): Promise<{ id: string; name: string }[]> => {
  const supabase = await createClient();
  // 강사는 **자기가 쓴 상담만** 보므로 이 필터에 고를 것이 하나뿐이다 — 선택지를 만들지 않는다(화면도 줄을 감춘다).
  if (await effectiveTeacherId()) return [];
  const rows = await fetchAllPaged<{ counselor_id: string | null }>((from, to) =>
    supabase
      .from("student_consultations")
      .select("counselor_id")
      .not("counselor_id", "is", null)
      // OFFSET 페이지가 흔들리지 않게 유일값으로 줄 세운다.
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = [...new Set(rows.map((r) => r.counselor_id).filter((v): v is string => !!v))];
  if (ids.length === 0) return [];
  const users = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  return users
    // 이름이 없는 계정은 세우지 않는다 — 빈 라벨을 고르면 무엇을 고른 건지 알 수 없다.
    .filter((u) => !!u.display_name?.trim())
    .map((u) => ({ id: u.id, name: u.display_name!.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
});

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
 *
 * 🔴 **강사는 담당 학생만**(2026-08-06 수리 전엔 전교생 230명 명단이 그대로 떴다 — 담당도 아닌 학생의
 *    이름·학년·마지막 상담일 노출). 담당 판정은 `effectiveTeacherScope().studentIds` 단일 소스.
 * ⚠️ '마지막 상담'은 **작성자를 가리지 않는다** — 다른 상담사가 어제 상담한 학생을 "상담 필요"로 재촉하면
 *    거짓 할 일이 된다. 좁히는 건 *학생 집합*이지 상담 이력이 아니다.
 */
export async function getStudentsNeedingConsultation(
  thresholdDays = 30,
  limit = 20,
): Promise<{ rows: ConsultationNeededRow[]; total: number }> {
  const supabase = await createClient();
  const scope = await effectiveTeacherScope();
  // 강사인데 담당 학생이 0명이면 조회할 것도 없다(전체로 새지 않게 여기서 끊는다).
  if (scope && scope.studentIds.length === 0) return { rows: [], total: 0 };

  const enrolled = scope
    ? // ⚠️ 담당 학생이 수십~수백이라 raw `.in()`은 URL 414(#53) → fetchInChunks.
      await fetchInChunks<{ id: string; name: string; grade: string | null }>(
        scope.studentIds,
        (chunk) =>
          supabase.from("students").select("id, name, grade").eq("status", "enrolled").in("id", chunk),
      )
    : await fetchAllPaged<{ id: string; name: string; grade: string | null }>((from, to) =>
        supabase
          .from("students")
          .select("id, name, grade")
          .eq("status", "enrolled")
          .order("name", { ascending: true })
          .range(from, to),
      );
  if (enrolled.length === 0) return { rows: [], total: 0 };

  const consults = scope
    ? // 🔴 `fetchInChunks`를 쓰면 안 된다 — 청크(100명) **안에서는 페이지네이션을 안 해서** 그 청크 결과가
      // 1000행을 넘으면 조용히 잘린다(#54). 상담은 학생당 수십 건이라 실제로 넘고, 잘리면 '마지막 상담일'이
      // 옛 날짜로 남아 **엉뚱한 학생이 '상담 필요'로 뜬다**. 청크+페이지네이션을 함께 하는 헬퍼를 쓴다.
      // ⚠️ OFFSET 페이지가 흔들리지 않게 unique tie-break(id)까지 정렬에 넣는다(헬퍼 규약).
      await fetchAllPagedInChunks<{ student_id: string; consulted_at: string }>(
        scope.studentIds,
        (chunk, from, to) =>
          supabase
            .from("student_consultations")
            .select("student_id, consulted_at, id")
            .in("student_id", chunk)
            .order("consulted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to),
      )
    : await fetchAllPaged<{ student_id: string; consulted_at: string }>((from, to) =>
        supabase
          .from("student_consultations")
          .select("student_id, consulted_at")
          .order("consulted_at", { ascending: false })
          .range(from, to),
      );
  // 청크 경로는 정렬이 청크별이라 전역 최신 보장이 없다 → 아래 Map은 '첫 등장'이 아니라 '최대값'으로 잡는다.
  consults.sort((a, b) => (a.consulted_at < b.consulted_at ? 1 : -1));
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
//
// 🔴 **통계도 목록과 같은 스코프를 탄다** (2026-08-06 원장 제보로 수리 — 그 전엔 스코프가 아예 없었다).
//    실 강사 계정에서 목록은 110건인데 통계는 1313건(학원 전체)·'상담 필요 학생'엔 담당도 아닌 전교생
//    230명 명단이 떴다. 한 화면이 서로 다른 두 우주를 보여준 것이자, 담당 밖 학생 정보의 노출이다
//    (#77 "한 표면만 잠갔다"의 전형 — 목록/카운트만 좁히고 통계 4함수를 빠뜨렸다).
// ⚠️ 새 통계 함수를 추가하면 **여기 스코프 규약을 반드시 태울 것.**
//    · 학생상담 = `counselor_id = 나`(목록·Stat 카드와 동일 기준 — "내가 한 것만")
//    · 상담 필요 학생 = **담당 학생(scope.studentIds)** 안에서만
//    · 등록상담·전환율 = 강사 도메인이 아니다 → 강사 스코프에선 0으로 내리고 화면에서도 감춘다
//      (`consultant_id`는 상담실 담당자라 강사와 무관하다. 0을 그냥 그리면 "전환율 0%"라는 거짓말이 된다.)

/**
 * 강사 본인이 작성한 상담(category·consulted_at만) — 카테고리 분포·월별 추세가 공유한다.
 * RPC(`consultation_category_counts`/`consultation_monthly_trend`)는 **상담자 인자가 없어** 강사 경로에
 * 못 쓴다. RPC에 인자를 추가하려면 마이그레이션이 필요한데, eywa는 SQL을 손으로 적용하므로 앱을 먼저
 * 배포하면 그 화면이 죽는다(#95) → 강사 경로만 앱에서 집계한다.
 * ⚠️ 본인 것만이라 행 수가 작다(실측 110건). 그래도 bare select 금지 규약대로 `fetchAllPaged`(#54).
 * React cache로 요청당 1회 — 두 함수가 같은 데이터를 두 번 읽지 않는다.
 */
const teacherOwnConsultations = cache(
  async (teacherId: string, sinceIso: string): Promise<{ category: string | null; consulted_at: string }[]> => {
    const supabase = await createClient();
    return fetchAllPaged<{ category: string | null; consulted_at: string }>((from, to) =>
      supabase
        .from("student_consultations")
        .select("category, consulted_at")
        .eq("counselor_id", teacherId)
        .gte("consulted_at", sinceIso)
        .order("consulted_at", { ascending: false })
        .range(from, to),
    );
  },
);

export type ConsultationFunnelPoint = {
  enrollmentConsultations: number; // 등록상담 전체
  studentConsultations: number; // 학생상담 전체
  enrolled: number; // 등록상담 → 학생전환된 수 (linked_student_id 채워진 row)
  conversionRate: number; // enrolled / enrollmentConsultations
  /** 강사 스코프라 등록상담·전환 지표가 성립하지 않음 — 화면은 그 카드를 감춘다(0을 그리면 거짓말). */
  teacherScoped: boolean;
};

export async function getConsultationFunnel(
  monthCount = 6,
): Promise<ConsultationFunnelPoint> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);
  const sinceIso = since.toISOString();
  const teacherId = await effectiveTeacherId();

  // 강사: 자기가 쓴 학생상담 건수만. 등록상담·전환은 상담실 지표라 **조회 자체를 안 한다**(노출 0).
  if (teacherId) {
    const { count: sc } = await supabase
      .from("student_consultations")
      .select("*", { count: "exact", head: true })
      .eq("counselor_id", teacherId)
      .gte("consulted_at", sinceIso);
    return {
      enrollmentConsultations: 0,
      studentConsultations: sc ?? 0,
      enrolled: 0,
      conversionRate: 0,
      teacherScoped: true,
    };
  }

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
    teacherScoped: false,
  };
}

export type CategoryBucket = { category: string; count: number };

export async function getConsultationByCategory(
  monthCount = 6,
): Promise<CategoryBucket[]> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);
  const teacherId = await effectiveTeacherId();

  // 강사: 본인 상담만 집계(RPC는 상담자 인자가 없다 — 위 teacherOwnConsultations 주석 참조).
  if (teacherId) {
    const counts = new Map<string, number>();
    for (const r of await teacherOwnConsultations(teacherId, since.toISOString())) {
      const k = r.category ?? "other";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].map(([category, count]) => ({ category, count }));
  }

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
  const teacherId = await effectiveTeacherId();

  const byMonth = new Map<string, { enrollment: number; student: number }>();
  if (teacherId) {
    // 강사: 본인 학생상담만. 등록상담 라인은 강사 도메인이 아니라 0으로 남긴다(조회도 안 한다).
    for (const r of await teacherOwnConsultations(teacherId, start.toISOString())) {
      const d = new Date(r.consulted_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = byMonth.get(k) ?? { enrollment: 0, student: 0 };
      byMonth.set(k, { enrollment: 0, student: cur.student + 1 });
    }
  } else {
    // DB group-by RPC(0040a) — 양 테이블 전건 fetch + JS 버킷팅은 ~1000행에서 잘려(#54) 추세 student 라인이
    // 과소집계됐다(데모 student_consultations 1340행/6개월). 월별 집계를 DB로 내려 무절단.
    const { data } = await supabase.rpc("consultation_monthly_trend", {
      p_start: start.toISOString(),
    });
    for (const r of (data ?? []) as { month: string; enrollment: number; student: number }[]) {
      byMonth.set(r.month, { enrollment: Number(r.enrollment), student: Number(r.student) });
    }
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
