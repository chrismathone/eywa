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
import { visibleConsultationSummary } from "../internal-link";
import type { ClassSource } from "../class-mapping";
import { classSchemaWorthTrying, isMissingClassSchema, noteClassSchema } from "./class-support";
import { annotateAutoClasses } from "./list-classes";

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
  counselorId: string | null;
  /**
   * 반 매핑(0318a) — 저장된 값. `classSource`가 null이면 아직 판정 안 한 옛 행이라 목록은 화면에서만 자동 판정해 보여 준다
   * (`classAuto: true`). 0318a 전이면 전부 null이고 목록은 '반 이름' 열을 숨긴다.
   */
  classId: string | null;
  className: string | null;
  classSource: ClassSource | null;
  /** true = 저장값이 아니라 목록을 그리며 판정한 값(저장은 안 됐다 — 백필·다음 저장 때 굳는다). */
  classAuto: boolean;
};

export type StudentConsultationDetail = StudentConsultationRow & {
  /** 0318a 칸이 있나 — 없으면 폼이 '반' 칸을 숨기고 저장도 반을 건드리지 않는다([[#95]]). */
  classSupported: boolean;
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

/**
 * 반 매핑 칸(0318a). 🔴 임베드는 **FK 이름을 명시**한다([[#94]]) — 이 FK가 생기면서 student_consultations가 students↔classes·
 * users↔classes 사이의 또 하나의 연결 표가 됐다. 없으면 SQL 적용 전이라 이 조각을 빼고 다시 묻는다([[#95]]).
 */
const CLASS_COLUMNS = `,
  class_id, class_source,
  cls:classes!student_consultations_class_id_fkey ( class_name )`;

// 상세는 무거운 컬럼(전사·ai_report)까지 — 목록 SELECT_COLUMNS에는 미포함(낭비 회피).
const DETAIL_EXTRA = `,
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
  class_id?: string | null;
  class_source?: string | null;
  cls?: unknown;
  student: unknown;
  counselor: unknown;
}): StudentConsultationRow {
  const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
    | { id: string; name: string; grade: string | null }
    | undefined;
  const counselor = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
    | { display_name?: string }
    | undefined;
  const cls = (Array.isArray(r.cls) ? r.cls[0] : r.cls) as { class_name?: string | null } | undefined;
  const source = r.class_source === "auto" || r.class_source === "manual" ? r.class_source : null;
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
    summary: visibleConsultationSummary(r.summary),
    followUpAction: r.follow_up_action,
    followUpDate: r.follow_up_date,
    followUpDone: r.follow_up_done,
    processingStatus: (r.processing_status as ConsultationProcessingStatus | null) ?? "idle",
    hasAudio: !!r.audio_path,
    hasAi: !!r.ai_summary,
    syncAddedAt: r.sync_added_at ?? null,
    counselorId: r.counselor_id ?? null,
    classId: r.class_id ?? null,
    className: r.class_id ? (cls?.class_name ?? null) : null,
    classSource: source,
    classAuto: false,
  };
}

export async function getStudentConsultationById(
  id: string,
): Promise<StudentConsultationDetail | null> {
  const supabase = await createClient();
  // 강사 스코프: 강사는 **본인이 등록한 상담**만 열람 — 남의 상담은 URL 직접 진입해도 null(notFound).
  // (RLS는 테넌트만 격리하므로 역할·작성자 스코프는 앱 레벨에서 강제 #58. 목록/검색과 동일 불변식.)
  const tId = await effectiveTeacherId();
  const read = (withClass: boolean) => {
    let qb = supabase
      .from("student_consultations")
      .select(`${SELECT_COLUMNS}${withClass ? CLASS_COLUMNS : ""}${DETAIL_EXTRA}`)
      .eq("id", id);
    if (tId) qb = qb.eq("counselor_id", tId);
    return qb.maybeSingle();
  };
  let withClass = classSchemaWorthTrying();
  let { data, error } = await read(withClass);
  if (withClass && error && isMissingClassSchema(error)) {
    noteClassSchema(false);
    withClass = false;
    ({ data, error } = await read(false));
  } else if (withClass && !error) noteClassSchema(true);
  if (!data) return null;
  const d = data as unknown as Record<string, unknown>;
  const row = mapRow(data as unknown as Parameters<typeof mapRow>[0]);
  // 아직 판정 안 한 옛 행이면 목록과 같은 판정을 보여 준다(목록은 반이 보이는데 상세는 '—'면 두 화면이 다른 말을 한다).
  const [shown] = withClass && row.classSource === null ? await annotateAutoClasses([row]) : [row];
  return {
    ...shown,
    classSupported: withClass,
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

/** 목록 기간 필터의 시작 시각(ISO) — 통계(목록 위 요약 띠·통계 화면)가 목록과 **같은 창**을 쓰게. 전체면 null. */
export function rangeSinceIso(range: ConsultationListFilters["range"]): string | null {
  return range === "7d" ? isoDaysAgo(7) : range === "30d" ? isoDaysAgo(30) : null;
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
  const results =
    await Promise.all([
      base(),
      base().gte("consulted_at", isoDaysAgo(7)),
      base().eq("follow_up_done", false).not("follow_up_date", "is", null),
      base()
        .eq("follow_up_done", false)
        .not("follow_up_date", "is", null)
        .lt("follow_up_date", today),
    ]);
  for (const result of results) {
    if (result.error) throw new Error(`상담 집계 실패: ${result.error.message}`);
  }
  const [{ count: total }, { count: lastWeek }, { count: pending }, { count: overdue }] = results;
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
): Promise<{ rows: StudentConsultationRow[]; total: number; classSupported: boolean }> {
  const supabase = await createClient();

  // 강사 스코프: teacher면 **본인이 등록한 상담(counselor_id=나)** 만 — 담당 학생이어도 남이 쓴 상담은 제외.
  // (사용자 요청 "내가 한 것만 보이게". 담당 학생 기준이던 것에서 작성자 기준으로 전환.)
  const teacherId = await effectiveTeacherId();

  // 검색 — 요약(base) OR 학생명(조인). 학생명은 id 해석 후 in.(...)으로 OR. (재시도해도 같은 값이라 한 번만 푼다.)
  const term = filters.q?.trim();
  let orClause: string | null = null;
  if (term) {
    const { data: stu } = await supabase
      .from("students")
      .select("id")
      .ilike("name", `%${term}%`);
    const ids = (stu ?? []).map((s) => s.id);
    const safe = term.replace(/[(),]/g, " "); // PostgREST .or 파서 보호
    const orParts = [`summary.ilike.%${safe}%`];
    if (ids.length) orParts.push(`student_id.in.(${ids.join(",")})`);
    orClause = orParts.join(",");
  }

  const from = (page - 1) * pageSize;
  const build = (withClass: boolean) => {
    let qb = filteredConsultations(
      supabase.from("student_consultations").select(`${SELECT_COLUMNS}${withClass ? CLASS_COLUMNS : ""}`, { count: "exact" }),
      filters,
      teacherId,
    );
    if (orClause) qb = qb.or(orClause);
    return qb.order("consulted_at", { ascending: false }).range(from, from + pageSize - 1);
  };

  // 반 칸(0318a)이 없으면 그 조각을 빼고 다시 묻는다([[#95]] — 목록은 '반 이름' 열만 숨긴다).
  let classSupported = classSchemaWorthTrying();
  let { data, count, error } = await build(classSupported);
  if (classSupported && error && isMissingClassSchema(error)) {
    noteClassSchema(false);
    classSupported = false;
    ({ data, count, error } = await build(false));
  } else if (classSupported && !error) noteClassSchema(true);
  if (error) console.error("[consultations] 목록 조회 실패:", error.message);

  const rows = ((data ?? []) as unknown as Parameters<typeof mapRow>[0][]).map(mapRow);
  // 아직 판정 안 한 옛 행(class_source 비어 있음)은 화면에서만 판정해 보여 준다 — 쪽 하나를 RPC 한 번으로(N+1 없음).
  const shown = classSupported ? await annotateAutoClasses(rows) : rows;
  return { rows: shown, total: count ?? 0, classSupported };
}

/**
 * 목록 필터(기간·카테고리·상담사·과목·후속 긴급도) + 강사 스코프를 건다 — **목록과 통계(요약 띠·통계 화면)가 같은 함수**를 탄다
 * (두 벌이면 한쪽만 고쳐 통계 수치와 목록 건수가 갈린다). 검색어(q)는 목록 전용이라 여기 없다.
 * 후속 긴급도는 followUpUrgency()와 같은 뜻을 SQL로 적은 것이다(0318a `consultation_stats`도 같은 식).
 */
export function filteredConsultations<Q>(builder: Q, filters: ConsultationListFilters, teacherId: string | null): Q {
  // PostgREST 빌더 타입은 select 문자열을 파싱한 결과라 제네릭으로 넘기면 인스턴스화가 폭주한다(TS2589) — 쓰는 메서드만 가진
  // 구조 타입으로 보고 끝에 원래 타입으로 돌린다.
  let qb = builder as unknown as ConsultationFilterable;
  if (teacherId) qb = qb.eq("counselor_id", teacherId);
  if (filters.range === "7d") qb = qb.gte("consulted_at", isoDaysAgo(7));
  else if (filters.range === "30d") qb = qb.gte("consulted_at", isoDaysAgo(30));
  if (filters.cat && filters.cat !== "all") qb = qb.eq("category", filters.cat);
  // 상담사(작성자) — 강사 스코프가 이미 자기 것만 남겼으면 이 필터는 사실상 무동작이다(같은 조건).
  if (filters.counselor && filters.counselor !== "all") qb = qb.eq("counselor_id", filters.counselor);
  // 과목 — 저장값이 한글 라벨이라 키·라벨 둘 다 허용(위 타입 주석).
  const wanted = consultationSubjectValues(filters);
  if (wanted) qb = qb.in("subject", wanted);
  const today = kstToday();
  const in3 = addIsoDateDays(today, 3);
  switch (filters.urg) {
    case "done":
      qb = qb.eq("follow_up_done", true);
      break;
    case "overdue":
      qb = qb.eq("follow_up_done", false).not("follow_up_date", "is", null).lt("follow_up_date", today);
      break;
    case "today":
      qb = qb.eq("follow_up_done", false).eq("follow_up_date", today);
      break;
    case "soon":
      qb = qb.eq("follow_up_done", false).gt("follow_up_date", today).lte("follow_up_date", in3);
      break;
    case "later":
      qb = qb.eq("follow_up_done", false).gt("follow_up_date", in3);
      break;
    default:
      break;
  }
  return qb as unknown as Q;
}

/** `filteredConsultations`가 쓰는 PostgREST 필터 메서드만 — 목록(select+count)·통계(head count) 빌더를 같이 받으려고. */
type ConsultationFilterable = {
  eq(column: string, value: unknown): ConsultationFilterable;
  gte(column: string, value: unknown): ConsultationFilterable;
  gt(column: string, value: unknown): ConsultationFilterable;
  lt(column: string, value: unknown): ConsultationFilterable;
  lte(column: string, value: unknown): ConsultationFilterable;
  in(column: string, values: readonly unknown[]): ConsultationFilterable;
  not(column: string, operator: string, value: unknown): ConsultationFilterable;
};

/** 과목 필터의 저장값 후보(키·라벨) — 목록·통계가 같은 값으로 거른다. 필터가 없으면 null. */
export function consultationSubjectValues(filters: Pick<ConsultationListFilters, "subject" | "subjectLabel">): string[] | null {
  if (!filters.subject || filters.subject === "all") return null;
  const wanted = [filters.subject, filters.subjectLabel].filter((v): v is string => !!v);
  return [...new Set(wanted)];
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
  type Row = { id: string; name: string; grade: string | null };
  // ⚠️ 담당 학생이 많은 강사는 단일 `.in()`이 URL 414로 실패하고, 오류를 `?? []`로 삼키면 드롭다운이
  //    조용히 비어 상담을 쓸 수 없었다(감사 T4, #53) → 100개 청크. 사무실은 전건이라 페이징(B2).
  const rows: Row[] = teacherStudentIds
    ? await fetchInChunks<Row>(teacherStudentIds, (chunk) =>
        supabase.from("students").select("id, name, grade").neq("status", "withdrawn").in("id", chunk),
      )
    : await fetchAllPaged<Row>((from, to) =>
        supabase
          .from("students")
          .select("id, name, grade")
          .neq("status", "withdrawn")
          .order("id")
          .range(from, to),
      );
  // 청크마다 따로 정렬되므로 합친 뒤 한 번 정렬한다(학년 → 이름, 종전 순서와 같다 — 학년 없는 학생은 뒤로).
  return rows
    .map((r) => ({ id: r.id, name: r.name, grade: r.grade }))
    .sort((a, b) => {
      if (a.grade !== b.grade) {
        if (a.grade == null) return 1;
        if (b.grade == null) return -1;
        return a.grade < b.grade ? -1 : 1;
      }
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
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

// 통계는 목록 오른쪽 패널로 옮겼다가(원장 2026-09-30) 전용 화면 `/consultations/stats`로 다시 나갔다(2026-10-01) — 집계는 [stats.ts](./stats.ts)(0318a RPC). 옛 통계 화면의 함수
// (전환 퍼널·카테고리 분포·월별 추세)는 그 화면과 함께 걷었다. 🔴 스코프 규약은 그대로다: 학생상담 = `counselor_id = 나`,
// 상담 공백 = 담당 학생 안에서만(옛 화면이 한 번 어긋났던 자리 — 목록과 다른 우주를 보여 주면 안 된다).
