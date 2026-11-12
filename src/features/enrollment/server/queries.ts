import "server-only";
import { PREP_BRIEF_STALL_MS } from "@/features/enrollment/prep-stall";
import { samePersonGroups } from "../same-person";
import { findSamePersonConsultations } from "./same-person-query";
import { auditScoped, systemAuditScope } from "@/features/audit/server/system-read";
import { kstMonth, kstMonthStartIso, kstYear, shiftMonth } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import type { ExtractedConsultationForm } from "../form-fill";
import type { IntakeChecklist } from "../intake-checklist";
import type { PrepBriefRecord } from "../prep-brief";
import { DEFAULT_RANGE, RANGE_MONTHS, type RangePreset } from "../range";
import { boardStatusOf, outcomesOfStage, type BoardStageKey } from "../board-stages";
import { kstDayBounds, kstMonthBounds } from "../kst-bounds";
import { countAssignedClasses } from "./assigned-classes";
import { consultClassKeysOf } from "../consult-subject";
import { getTenantSettings } from "@/features/owner/server/queries";

/** prep_brief jsonb 방어 — 형태가 맞을 때만 통과(옛 스냅샷·수기 편집으로 깨진 값이 렌더를 죽이지 않게). */
function isPrepBriefRecord(v: unknown): v is PrepBriefRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<PrepBriefRecord>;
  return r.version === 1 && !!r.brief && typeof r.brief === "object" && !!r.facts;
}

export type LearningHistory = {
  prevAcademy?: string;
  lastScore?: string;
  weakSubjects?: string[];
};

export type Diagnosis = {
  strengths: string[];
  weaknesses: string[];
  level: string;
  summary: string;
};

export type LearningPlan = {
  immediate: string[];
  semester: string[];
  longTerm: string[];
};

export type PrintPayload = {
  prospect: {
    name: string;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
  // ⚠️ 아래는 **옛 텍스트 분석 경로(runAiAnalysis, 2026-09-01 삭제)만** 채웠다 — 녹음 웹훅 경로는
  // `{prospect, audioReport, speakerRoles, formSuggestions}`만 저장해 이 필드들이 통째로 없다
  // (2026-07-22 실측: 프로덕션 6행 전부 없음). print_payload는 jsonb라 타입이 강제되지 않으므로
  // **optional이 진실**이다 — 필수로 적어 두면 인쇄 페이지가 `p.diagnosis.level`을 무방비로
  // 역참조해 TypeError로 죽는다(실제로 6/6행이 인쇄 불가였다). 소비처는 존재 확인 후 역참조할 것.
  consultedAt?: string;
  consultantName?: string | null;
  parentRequest?: string | null;
  learningHistory?: LearningHistory | null;
  diagnosis?: Diagnosis;
  learningPlan?: LearningPlan;
  recommendedClasses?: string[];
};

export type ConsultationProcessingStatus =
  | "idle"
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

// ijw-calander 13-section consultation analysis (audio flow)
export type ConversationFlowNode = {
  topic: string;
  summary: string;
  children?: ConversationFlowNode[];
};

export type ConsultationAudioReport = {
  consultationType: string;
  summary: string;
  familyBackground: string;
  parentConcerns: string;
  parentQuestions: string;
  parentRequests: string;
  parentSatisfaction: string;
  studentTraits: string;
  teacherResponse: string;
  salesPoints: string;
  agreements: string;
  followUps: string;
  warnings: string;
  conversationFlow?: ConversationFlowNode[];
  extracted: {
    prospectName: string | null;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
};

/** 같은 사람의 등록상담 1건 요약 — '상담 N건' 배지 팝오버·상세 '다른 상담' 목록의 각 행. */
export type PersonConsultRef = {
  id: string;
  prospectName: string;
  subject: string | null;
  outcome: string;
  consultedAt: string;
};

export type ConsultationListRow = {
  id: string;
  prospectName: string;
  prospectGrade: string | null;
  prospectSchool: string | null;
  parentPhone: string | null;
  parentRequest: string | null;
  consultantName: string | null;
  /** 상담자 글(`counselor`) — 상담사 계정이 없을 때 목록·카드가 대신 보인다(`consultantLabel`, 상세와 같은 사실). */
  counselorText: string | null;
  outcome: string;
  consultedAt: string;
  hasAiAnalysis: boolean;
  processingStatus: ConsultationProcessingStatus;
  hasAudio: boolean;
  fromPublicIntake: boolean;
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
  /** makeedu counselSeq — 있으면 makeedu에 그 상담이 있다(들어왔거나 보냈다). 등록 완료 칸의 '동기화 완료' 표식. */
  makeeduId: string | null;
  /**
   * 연결 학생이 makeedu **원생**인가(`students.makeedu_id` — makeedu 원생 동기화가 적는다). 상담만 넘어간 것과
   * 원생 전환까지 된 것을 가른다(원장 2026-10-20 — 전환까지면 표식 테두리 이중).
   */
  studentInMakeedu: boolean;
  studentId: string | null; // 수업 배정으로 생성된 학생(연결) — null이면 아직 학생 미생성
  assignedClassCount: number; // 연결 학생의 상담 과목 미종료 수강(반) 수 → ≥1이면 "배정 완료"
  personConsultCount: number; // 같은 사람(학생/자연키)의 등록상담 총 건수 → ≥2면 "반복 접수" 힌트
  // 반복 접수(≥2건)일 때만 그 사람의 상담 전건(시간역순, 자기 포함) — 배지 클릭 팝오버로 나머지 상담 열람.
  // 1건이면 빈 배열(불필요한 데이터·팝오버 미노출).
  personConsults: PersonConsultRef[];
};

/** 프리셋 시작 시각(그 달 1일 00:00). 월 경계로 잘라야 월별 집계가 반쪽 달로 시작하지 않는다. */
function rangeStartIso(range: RangePreset): string {
  // 🔴 **KST 달 경계** — `new Date(y, m, 1)`은 런타임 로컬 자정이라 서버(UTC)에선 KST 오전 9시가 되어
  //    그 9시간의 상담이 앞 달로 샌다(date-kst `kstMonthStartIso` 주석).
  return kstMonthStartIso(shiftMonth(kstMonth(), -(RANGE_MONTHS[range] - 1)));
}

export type ConsultationFilter = {
  month?: string | null; // "YYYY-MM" — 특정 달만. 있으면 range보다 우선.
  range?: RangePreset | null; // month가 없을 때 적용되는 기간 프리셋(기본 3개월)
  consultantId?: string | null; // UUID or null/undefined for all
  q?: string | null; // 이름·전화·학교 텍스트 검색
  outcome?: string | null; // 진행 상태 **원값** 하나(내부용 — 예: AI 완료 건수 head 카운트). 화면 필터는 아래 stage.
  /**
   * 진행 단계(칸반 4칸) — 화면의 '상태' 드롭다운이 고르는 값(원장 2026-09-01, 칸반과 같은 4단계).
   * 그 칸에 묶인 outcome 원값들로 `.in()` 한다(단계당 1~2개라 URL이 길어지지 않는다).
   * ⚠️ **파생 '반 배정 완료'는 표현하지 못한다** — 배정은 연결 학생의 수강에서 나오는 값이라 SQL로
   *    못 거른다. 즉 '등록 완료'로 걸러도 outcome이 enrolled가 아닌 배정 카드는 안 담긴다(드묾).
   */
  stage?: BoardStageKey | null;
  /**
   * 접수일(`YYYY-MM-DD`, KST) — 그날 **행이 생긴** 상담만(`created_at`). 운영실 '신규문의' 카드의 목적지.
   * 🔑 경계는 카드와 **같은 함수**(`kstDayBounds`)라 두 숫자가 같다. 있으면 월·기간(`consulted_at`)보다 우선한다 —
   *    같이 걸면 상담 예정일이 3개월 밖인 오늘 접수 건이 목록에서만 빠진다.
   */
  received?: string | null;
};

// consultant_id(스칼라)는 목록뷰 인라인 수정(상담사 선택)의 현재값 — 임베드(display_name)와 별개로 함께 받는다.
// 0002 마이그레이션부터 있는 컬럼이라 옛/새 스키마 분기(#95)가 필요 없다.
const LIST_COLS = `id, prospect_name, prospect_grade, prospect_school,
   parent_phone, parent_request, outcome, consulted_at, subject, consultant_id, counselor,
   processing_status, audio_path, from_public_intake, sync_added_at, student_id, makeedu_id,
   consultant:consultant_id ( display_name )`;

/** 목록·칸반 공용 필터 적용. 두 경로가 갈라지면 "칸반엔 있는데 목록엔 없는 건"이 생긴다 — 한 함수로 묶는다. */
function applyConsultationFilter<T extends { gte: unknown }>(q: T, filter?: ConsultationFilter): T {
  let out = q as unknown as PostgrestFilterLike;
  if (filter?.received) {
    const { startIso, endIso } = kstDayBounds(filter.received);
    out = out.gte("created_at", startIso).lt("created_at", endIso);
  } else if (filter?.month) {
    // 🔴 KST 달 경계(2026-09-11 수정) — 옛 `new Date(y, m, 1)`은 서버(UTC)에서 KST 오전 9시가 되어 1일 새벽 상담이 앞 달로 샜다.
    const { startIso, endIso } = kstMonthBounds(filter.month);
    out = out.gte("consulted_at", startIso).lt("consulted_at", endIso);
  } else {
    // 🔴 기간 하한이 **항상** 걸린다 — 무필터로 전건을 여는 경로를 남기지 않는다(전체 = 2,197행).
    out = out.gte("consulted_at", rangeStartIso(filter?.range ?? DEFAULT_RANGE));
  }
  if (filter?.consultantId) out = out.eq("consultant_id", filter.consultantId);
  if (filter?.outcome) out = out.eq("outcome", filter.outcome);
  // 단계 필터는 그 칸의 원값 묶음으로(칸반과 같은 board-stages 단일 소스).
  if (filter?.stage) out = out.in("outcome", outcomesOfStage(filter.stage));
  if (filter?.q) {
    // 이름·전화·학교는 enrollment_consultations에 직접 있어 학생 id 조인 불필요(학생상담보다 단순).
    const safe = filter.q.trim().replace(/[(),]/g, " ");
    if (safe)
      out = out.or(
        `prospect_name.ilike.%${safe}%,parent_phone.ilike.%${safe}%,prospect_school.ilike.%${safe}%`,
      );
  }
  return out as unknown as T;
}

type PostgrestFilterLike = {
  gte: (c: string, v: string) => PostgrestFilterLike;
  lt: (c: string, v: string) => PostgrestFilterLike;
  eq: (c: string, v: string) => PostgrestFilterLike;
  in: (c: string, v: string[]) => PostgrestFilterLike;
  or: (f: string) => PostgrestFilterLike;
};

type BadgeSourceRow = { id: string; student_id?: string | null };

/**
 * 목록 배지 재료(AI 분석 유무 · "반 배정 완료" 판정)를 로드된 행들에 대해서만 조회.
 * 칸반(전건)과 목록(한 페이지)이 **같은 기준**으로 판정하도록 한 함수로 묶는다 —
 * 갈라지면 같은 상담이 뷰마다 다른 상태로 보인다.
 */
async function loadRowBadges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: BadgeSourceRow[],
): Promise<{
  hasAi: Set<string>;
  assignedCountFor: (s: string | null, subj: string | null) => number;
  inMakeedu: Set<string>;
}> {
  const ids = data.map((c) => c.id);
  // id가 수백+ 가능 → 청크 분할(.in() URL 414 방지, error는 throw — 조용히 삼키지 않음, B3).
  // 연결 학생(student_id)의 미종료 수강 수 = "배정 완료" 판정 재료도 병렬로(독립 조회 = B4).
  const studentIds = [...new Set(data.map((c) => c.student_id).filter((v): v is string => !!v))];
  const today = kstToday();
  const [ai, enr, mk, settings] = await Promise.all([
    fetchInChunks<{ consultation_id: string }>(ids, (chunk) =>
      supabase.from("consultation_ai_analysis").select("consultation_id").in("consultation_id", chunk),
    ),
    studentIds.length
      ? fetchInChunks<{ student_id: string; class: { subject?: string } | { subject?: string }[] | null }>(
          studentIds,
          (chunk) =>
            // 미종료 수강 = end_date IS NULL(진행) 또는 end_date >= 오늘(미래 종료 예정). 학생당 소수라 절단 없음.
            // "배정 완료"는 상담 과목의 실제 수강으로 판정하므로 class subject까지 함께 조회(교차과목 오매몰 차단).
            // 🔴 반 조인은 상세(`assignedQuery`)와 같은 `!inner` — 한쪽만 조인하면 반 행이 안 읽히는 수강이 과목 빈 상담에서 개수를 가른다.
            supabase
              .from("enrollments")
              .select("student_id, class:class_id!inner ( subject )")
              .in("student_id", chunk)
              .or(`end_date.is.null,end_date.gte.${today}`),
        )
      : Promise.resolve([] as { student_id: string; class: { subject?: string } | null }[]),
    // makeedu 원생 전환 여부 = 연결 학생에 makeedu 원생 번호가 있는가(학생당 한 행이라 절단 없음).
    studentIds.length
      ? fetchInChunks<{ id: string }>(studentIds, (chunk) =>
          supabase.from("students").select("id").in("id", chunk).not("makeedu_id", "is", null),
        )
      : Promise.resolve([] as { id: string }[]),
    getTenantSettings(),
  ]);
  const hasAi = new Set(ai.map((a) => a.consultation_id));
  // 상담 과목 글자 → 볼 반 과목 키(상세 '배정된 반'과 같은 `consultClassKeys` — 옛 이관 '수학'·'EIE'도 그 반을 찾는다).
  const classKeysOf = consultClassKeysOf(settings.operations.subjects);
  // 학생별 미종료 수강: 전체 수 + 과목별 수. "배정 완료" 판정은 상담 과목의 수강 수로(과목 없으면 전체 폴백).
  const enrByStudent = new Map<string, { total: number; bySubject: Map<string, number> }>();
  for (const row of enr) {
    const rec = enrByStudent.get(row.student_id) ?? { total: 0, bySubject: new Map<string, number>() };
    rec.total += 1;
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) as { subject?: string } | undefined;
    if (klass?.subject) rec.bySubject.set(klass.subject, (rec.bySubject.get(klass.subject) ?? 0) + 1);
    enrByStudent.set(row.student_id, rec);
  }
  return {
    hasAi,
    inMakeedu: new Set(mk.map((r) => r.id)),
    assignedCountFor: (studentId, subject) => {
      if (!studentId) return 0;
      const rec = enrByStudent.get(studentId);
      if (!rec) return 0;
      // 상담 과목이 있으면 그 과목 반의 수강만 = "이 상담이 실제 배정됐는가". 과목 미상이면 전체 수강 폴백(기존 동작) ·
      // 못 읽는 글자면 0(배정 없음).
      const keys = classKeysOf(subject);
      if (keys === null) return rec.total;
      return keys.reduce((n, key) => n + (rec.bySubject.get(key) ?? 0), 0);
    },
  };
}

export async function getEnrollmentConsultations(
  filter?: ConsultationFilter,
): Promise<ConsultationListRow[]> {
  const supabase = await createClient();
  // 무필터 기본 칸반은 enrollment_consultations 전건이라 무페이징 select면 1000행에서 silent 절단된다(B2).
  // fetchAllPaged 콜백 안에서 매번 새 빌더로 필터·정렬을 재적용(range/filter 누적 방지).
  const data = await fetchAllPaged((from, to) =>
    applyConsultationFilter(
      supabase.from("enrollment_consultations").select(LIST_COLS),
      filter,
    ).order("consulted_at", { ascending: false }).range(from, to),
  );
  if (data.length === 0) return [];

  const { hasAi, assignedCountFor, inMakeedu } = await loadRowBadges(supabase, data);

  // 같은 학생의 반복 접수 힌트(카드 'N건' 배지) — 판정은 `same-person.ts` 한 벌(원생 연결 · 이름+학교+학년 ·
  // 이름+보호자 연락처 중 하나라도 같으면 같은 학생, 이어진 것끼리 한 묶음 · 반대 증거가 있으면 안 잇는다). 로드된 목록(기간 안)
  // 기준이라 상세 '다른 상담'(기간 없이 찾는다)보다 적을 수 있다.
  // 🔴 이름만으로는 묶지 않는다 — 옛 시트 이관분 이름 칸의 "영어문의"·"예비중1" 같은 접수 표기가 한 사람으로 뜬다(실측 316건).
  const groupOf = samePersonGroups(data);
  const personKey = (c: { id: string }) => groupOf.get(c.id) ?? c.id;
  const personCount = new Map<string, number>();
  const personGroups = new Map<string, PersonConsultRef[]>();
  for (const c of data) {
    const k = personKey(c);
    personCount.set(k, (personCount.get(k) ?? 0) + 1);
    // data는 consulted_at desc 정렬이라 각 그룹도 시간역순으로 쌓인다(팝오버 최신순 표시).
    const arr = personGroups.get(k) ?? [];
    arr.push({
      id: c.id,
      prospectName: c.prospect_name,
      subject: (c as { subject?: string | null }).subject ?? null,
      outcome: c.outcome,
      consultedAt: c.consulted_at,
    });
    personGroups.set(k, arr);
  }

  return data.map((c) => {
    const consultant = (Array.isArray(c.consultant) ? c.consultant[0] : c.consultant) as
      | { display_name?: string }
      | undefined;
    return {
      id: c.id,
      prospectName: c.prospect_name,
      prospectGrade: c.prospect_grade,
      prospectSchool: c.prospect_school,
      parentPhone: c.parent_phone,
      parentRequest: c.parent_request,
      consultantName: consultant?.display_name ?? null,
      counselorText: (c as { counselor?: string | null }).counselor?.trim() || null,
      outcome: c.outcome,
      consultedAt: c.consulted_at,
      hasAiAnalysis: hasAi.has(c.id),
      processingStatus: c.processing_status as ConsultationProcessingStatus,
      hasAudio: !!c.audio_path,
      fromPublicIntake: !!(c as { from_public_intake?: boolean }).from_public_intake,
      syncAddedAt: (c as { sync_added_at?: string | null }).sync_added_at ?? null,
      makeeduId: (c as { makeedu_id?: string | null }).makeedu_id ?? null,
      studentInMakeedu: !!c.student_id && inMakeedu.has(c.student_id),
      studentId: (c as { student_id?: string | null }).student_id ?? null,
      assignedClassCount: assignedCountFor(
        c.student_id,
        (c as { subject?: string | null }).subject ?? null,
      ),
      personConsultCount: personCount.get(personKey(c)) ?? 1,
      // 반복 접수(≥2)일 때만 전건 첨부 — 1건이면 빈 배열(팝오버 미노출·데이터 절약).
      personConsults: (personCount.get(personKey(c)) ?? 1) > 1 ? (personGroups.get(personKey(c)) ?? []) : [],
    };
  });
}

/**
 * 목록(표) 뷰 전용 — 한 페이지만 가져온다.
 *
 * 🔴 반복접수 배지(`personConsultCount`)를 **타입에서 뺀다**. 그 값은 "로드된 목록 안에서 같은 사람이
 * 몇 번 나오나"를 세는 것이라, 50행짜리 페이지에서 세면 실제 3건인 사람이 1건으로 나온다(#89 —
 * 상한 걸린 목록의 길이를 건수로 쓰면 영원히 거짓말). 표는 이 배지를 안 그리므로 아예 안 준다:
 * 나중에 누가 표에 배지를 붙이려 하면 컴파일이 막는다(주석은 강제력이 없다).
 */
export type ConsultationTableRow = Omit<ConsultationListRow, "personConsultCount" | "personConsults"> & {
  /** 상담 과목 원값(학원설정 키 또는 옛 시트 자유 텍스트) — '과목' 열·인라인 수정의 현재값. 표시는 labelOf. */
  subject: string | null;
  /** 상담사 user id — 인라인 '상담사' 선택의 현재값(이름은 consultantName). */
  consultantId: string | null;
};

/**
 * 연·월 피커의 하한 — 데이터가 있는 가장 이른 연도. 1행만 받는다(정렬은 ec_tenant_consulted_idx가 덮는다).
 * 이 값이 없으면 피커가 2000년까지 훑을 수 있어 "눌러도 빈 화면"인 연도를 걸어 다니게 된다.
 */
export async function getConsultationMinYear(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollment_consultations")
    .select("consulted_at")
    .order("consulted_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // 🔴 기본값도 **KST 올해** — `new Date().getFullYear()`는 서버가 UTC라 1/1 새벽에 작년이 나온다.
  if (!data?.consulted_at) return kstYear();
  // KST 기준 연도 — 1월 1일 00시 UTC 저장분이 전년으로 밀리지 않게.
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(
      new Date(data.consulted_at),
    ),
  );
}

/**
 * 헤더 스탯용 — **행을 받지 않고** count만(B2). 페이지 rows에서 도출하면 50행짜리 페이지에서
 * "전체 50건"이라고 말하게 된다. 필터는 목록과 같은 것을 적용해야 "필터 결과 N건"이 맞는다.
 */
export async function getConsultationFilteredCounts(
  filter?: ConsultationFilter,
): Promise<{ total: number; aiDone: number }> {
  const supabase = await createClient();
  const head = (f?: ConsultationFilter) =>
    applyConsultationFilter(
      supabase.from("enrollment_consultations").select("*", { count: "exact", head: true }),
      f,
    );
  const [all, ai] = await Promise.all([
    head(filter),
    head({ ...(filter ?? {}), outcome: "ai_done" }),
  ]);
  return { total: all.count ?? 0, aiDone: ai.count ?? 0 };
}

export async function getEnrollmentConsultationsPage(
  filter: ConsultationFilter | undefined,
  page = 1,
  pageSize = 50,
): Promise<{ rows: ConsultationTableRow[]; total: number }> {
  const supabase = await createClient();
  const from = Math.max(0, (page - 1) * pageSize);
  const { data, count, error } = await applyConsultationFilter(
    supabase.from("enrollment_consultations").select(LIST_COLS, { count: "exact" }),
    filter,
  )
    .order("consulted_at", { ascending: false })
    .range(from, from + pageSize - 1);
  // 조회 실패를 '0건'으로 위장하지 않는다 — 빈 목록과 장애는 화면에서 구분돼야 한다.
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return { rows: [], total: count ?? 0 };

  const { hasAi, assignedCountFor, inMakeedu } = await loadRowBadges(supabase, rows);

  return {
    total: count ?? rows.length,
    rows: rows.map((c) => {
      const consultant = (Array.isArray(c.consultant) ? c.consultant[0] : c.consultant) as
        | { display_name?: string }
        | undefined;
      return {
        id: c.id,
        prospectName: c.prospect_name,
        prospectGrade: c.prospect_grade,
        prospectSchool: c.prospect_school,
        parentPhone: c.parent_phone,
        parentRequest: c.parent_request,
        consultantName: consultant?.display_name ?? null,
        counselorText: (c as { counselor?: string | null }).counselor?.trim() || null,
        outcome: c.outcome,
        consultedAt: c.consulted_at,
        hasAiAnalysis: hasAi.has(c.id),
        processingStatus: c.processing_status as ConsultationProcessingStatus,
        hasAudio: !!c.audio_path,
        fromPublicIntake: !!c.from_public_intake,
        syncAddedAt: c.sync_added_at ?? null,
        makeeduId: c.makeedu_id ?? null,
        studentInMakeedu: !!c.student_id && inMakeedu.has(c.student_id),
        studentId: c.student_id ?? null,
        assignedClassCount: assignedCountFor(c.student_id, c.subject ?? null),
        subject: c.subject ?? null,
        consultantId: (c as { consultant_id?: string | null }).consultant_id ?? null,
      };
    }),
  };
}

/**
 * 상세 페이지용 — 이 신규 콜&상담과 **같은 학생**의 다른 상담(자기 제외, 최신순).
 * 판정은 카드 'N건' 배지와 같은 한 벌(`same-person.ts` — 원생 연결 · 이름+학교+학년 · 이름+보호자 연락처).
 * RLS 스코프 클라이언트라 같은 학원(tenant)만 반환 — 누수 없음. 신규 콜&상담 표만 대상(재원생 상담 미포함).
 */
export async function getSiblingConsultations(consultationId: string): Promise<PersonConsultRef[]> {
  const supabase = await createClient();
  const { data: self } = await supabase
    .from("enrollment_consultations")
    .select("id, student_id, prospect_name, prospect_school, prospect_grade, parent_phone")
    .eq("id", consultationId)
    .single();
  if (!self) return [];
  const rows = await findSamePersonConsultations(supabase, self);
  return rows.map((c) => ({
    id: c.id,
    prospectName: c.prospect_name ?? "",
    subject: c.subject,
    outcome: c.outcome,
    consultedAt: c.consulted_at,
  }));
}

export type IntakeTokenRow = {
  id: string;
  name: string;
  token: string;
  isActive: boolean;
  expiresAt: string | null;
  usageCount: number;
  submissionCount: number;
  createdAt: string;
};

/** 공개 접수 토큰 목록(직원용, 최신순). RLS로 테넌트 격리. */
export async function getIntakeTokens(): Promise<IntakeTokenRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intake_tokens")
    .select("id, name, token, is_active, expires_at, usage_count, submission_count, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    token: t.token,
    isActive: t.is_active,
    expiresAt: t.expires_at,
    usageCount: t.usage_count ?? 0,
    submissionCount: t.submission_count ?? 0,
    createdAt: t.created_at,
  }));
}

export type AiAnalysisDetail = {
  id: string;
  modelVersion: string;
  diagnosis: Diagnosis;
  learningPlan: LearningPlan;
  printPayload: PrintPayload;
  recommendedClassIds: string[] | null;
  generatedAt: string;
  reportEditedBy: string | null; // AI 분석 섹션 마지막 수정자
  reportEditedAt: string | null;
};

/** 등록 상담 폼 전체 필드(0046a) — 상세 표시·수정 초기값. */
export type FullConsultationFields = {
  englishName: string | null;
  gender: string | null;
  bloodType: string | null;
  birthDate: string | null;
  studentPhone: string | null;
  homePhone: string | null;
  parentRelation: string | null;
  address: string | null;
  zipCode: string | null;
  addressDetail: string | null;
  consultationPath: string | null;
  subject: string | null;
  careerGoal: string | null;
  siblings: string | null;
  safetyNotes: string | null;
  registrationStatus: string | null;
  paymentAmount: string | null;
  paymentDate: string | null;
  registrar: string | null;
  followUpDate: string | null;
  followUpContent: string | null;
  nonRegistrationReason: string | null;
  shuttleBusRequest: boolean;
  privacyAgreement: boolean;
  installmentAgreement: boolean;
  subjectDetails: Record<string, Record<string, string>> | null;
  /** 공개 QR 접수 2단계 사전 체크리스트(0109a). null = 미작성(직원 수기 등록 등). */
  intakeChecklist: IntakeChecklist | null;
  // 완전 이식(0064a)
  counselor: string | null;
  receivedDate: string | null;
  studentType: string | null;
  siblingsDetails: string | null;
  consultationDate: string | null; // consulted_at → 상담일(date)
};

/** 등록상담 녹음 행(consultation_recordings, 0068a) — 여러 상담사가 각자 추가한 녹음. */
export type ConsultationRecordingRow = {
  id: string;
  createdAt: string;
  sizeBytes: number | null;
  durationSec: number | null;
  status: ConsultationProcessingStatus;
  error: string | null;
  transcription: string | null;
  speakerLabels: { speaker: string; text: string }[] | null;
  recordedByName: string | null;
};

export type ConsultationDetail = ConsultationListRow & {
  parentName: string | null;
  learningHistory: LearningHistory | null;
  aiAnalysis: AiAnalysisDetail | null;
  audioReport: ConsultationAudioReport | null;
  /** 녹음 분석이 전사에서 추출한 폼 값 원본(빈 칸만 자동입력됨). 이미 채워진 필드는 '✨ AI 제안'으로 비파괴 제시. */
  aiFormSuggestions: ExtractedConsultationForm | null;
  transcription: string | null;
  speakerLabels: { speaker: string; text: string }[] | null;
  speakerRoles: Record<string, string> | null;
  processingError: string | null;
  audioDurationSec: number | null;
  /** 녹음 행들(시간순) — 상세의 녹음 섹션·수정 폼 "등록된 녹음 N개" 표시가 소비. */
  recordings: ConsultationRecordingRow[];
  recommendedClasses: { id: string; className: string; subject: string }[];
  /** 사전 상담 브리프 스냅샷(0152a) — 미생성이면 null. 상담 *전* 준비 문서. */
  prepBrief: PrepBriefRecord | null;
  /** 브리프 생성 상태(0153b): null=대기/완료 · generating=백그라운드 생성 중 · failed=실패. */
  prepBriefStatus: "generating" | "failed" | null;
  /** 생성 실패 사유(한글 요약) — status=failed일 때만. */
  prepBriefError: string | null;
  /** 생성 작업 시작 시각(s2_0068 · generating일 때). */
  prepBriefJobAt: string | null;
  /** 240초 넘게 '생성 중' — 멈춘 작업(화면이 '다시 작성'을 보인다). */
  prepBriefStalled: boolean;
  studentId: string | null;
  fields: FullConsultationFields;
};

export async function getEnrollmentConsultationById(id: string): Promise<ConsultationDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_name, parent_phone, parent_request, learning_history,
       outcome, consulted_at, student_id, from_public_intake, makeedu_id,
       audio_path, audio_duration_sec, transcription, speaker_labels,
       processing_status, processing_error,
       english_name, gender, blood_type, birth_date, student_phone, home_phone,
       parent_relation, address, zip_code, address_detail, consultation_path,
       subject, career_goal, siblings, safety_notes,
       payment_amount, payment_date, registrar, follow_up_date, follow_up_content,
       non_registration_reason, shuttle_bus_request, privacy_agreement,
       installment_agreement, subject_details, intake_checklist, prep_brief, prep_brief_status, prep_brief_error, prep_brief_job_at,
       counselor, received_date, student_type, siblings_details, consultation_date,
       consultant:consultant_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  // AI 분석 + 녹음 행은 서로 독립 → 병렬(B4). 녹음은 시간순(=녹음 1·2·… 번호와 일치).
  const [{ data: aiList }, { data: recRows }] = await Promise.all([
    supabase
      .from("consultation_ai_analysis")
      .select(
        `id, model_version, diagnosis, learning_plan, print_payload, recommended_class_ids, generated_at, report_edited_by, report_edited_at`,
      )
      .eq("consultation_id", id)
      .order("generated_at", { ascending: false })
      .limit(1),
    supabase
      .from("consultation_recordings")
      .select(
        `id, created_at, audio_size_bytes, audio_duration_sec, transcription, speaker_labels,
         processing_status, processing_error, recordedBy:recorded_by ( display_name )`,
      )
      .eq("consultation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const ai = aiList?.[0] ?? null;

  const recordings: ConsultationRecordingRow[] = (recRows ?? []).map((r) => {
    const by = (Array.isArray(r.recordedBy) ? r.recordedBy[0] : r.recordedBy) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      createdAt: r.created_at,
      sizeBytes: r.audio_size_bytes,
      durationSec: r.audio_duration_sec,
      status: r.processing_status as ConsultationProcessingStatus,
      error: r.processing_error,
      transcription: r.transcription,
      // 비배열/null이면 null(TranscriptSection 방어 — 상담 행 speaker_labels와 동일 규칙).
      speakerLabels: Array.isArray(r.speaker_labels)
        ? (r.speaker_labels as { speaker: string; text: string }[])
        : null,
      recordedByName: by?.display_name ?? null,
    };
  });

  let recommendedClasses: { id: string; className: string; subject: string }[] = [];
  const recommendedIds = (ai?.recommended_class_ids ?? []) as string[];
  if (recommendedIds.length > 0) {
    const { data: cls } = await supabase
      .from("classes")
      .select("id, class_name, subject")
      .in("id", recommendedIds);
    recommendedClasses = (cls ?? []).map((row) => ({
      id: row.id,
      className: row.class_name,
      subject: row.subject,
    }));
  }

  const consultant = (Array.isArray(c.consultant) ? c.consultant[0] : c.consultant) as
    | { display_name?: string }
    | undefined;

  // 연결 학생의 미종료 수강 수(목록과 동일 기준: 상담 과목의 수강만 = 이 상담이 실제 배정됐는가).
  // 상담 과목이 있으면 그 과목 수강만 카운트(교차과목 오매몰 차단), 미상이면 전체 수강 폴백.
  // ⚠️ 필터 본문은 [`assigned-classes.ts`](./assigned-classes.ts)로 옮겼다(2026-09-10) — 상세 화면의
  //    '배정된 반' 카드가 **같은 조건으로 행을 편다**. 세는 곳과 펴는 곳이 갈리면 "반 배정 완료"라면서
  //    반이 한 줄도 안 서는 화면이 된다.
  const linkedStudentId = (c as { student_id?: string | null }).student_id ?? null;
  const consultSubject = (c as { subject?: string | null }).subject ?? null;
  const assignedClassCount = await countAssignedClasses(supabase, linkedStudentId, consultSubject);

  const printPayload =
    (ai?.print_payload as
      | (PrintPayload & {
          audioReport?: ConsultationAudioReport;
          speakerRoles?: Record<string, string>;
          formSuggestions?: ExtractedConsultationForm;
        })
      | null) ?? null;
  const audioReport =
    printPayload && typeof printPayload === "object" && "audioReport" in printPayload
      ? (printPayload.audioReport as ConsultationAudioReport | undefined) ?? null
      : null;
  const speakerRoles =
    printPayload && typeof printPayload === "object" && printPayload.speakerRoles
      ? printPayload.speakerRoles
      : null;
  const aiFormSuggestions =
    printPayload && typeof printPayload === "object" && printPayload.formSuggestions
      ? printPayload.formSuggestions
      : null;

  return {
    id: c.id,
    prospectName: c.prospect_name,
    prospectGrade: c.prospect_grade,
    prospectSchool: c.prospect_school,
    parentName: c.parent_name,
    parentPhone: c.parent_phone,
    parentRequest: c.parent_request,
    learningHistory: c.learning_history as LearningHistory | null,
    consultantName: consultant?.display_name ?? null,
    counselorText: (c.counselor as string | null)?.trim() || null,
    outcome: c.outcome,
    consultedAt: c.consulted_at,
    hasAiAnalysis: ai !== null,
    processingStatus: c.processing_status as ConsultationProcessingStatus,
    hasAudio: !!c.audio_path,
    fromPublicIntake: !!(c as { from_public_intake?: boolean }).from_public_intake,
    syncAddedAt: null, // 상세 화면은 목록 ↻ 배지가 불필요 → null(타입만 충족)
    studentInMakeedu: false, // 상세는 목록 표식을 안 그린다(타입만 충족)
    transcription: c.transcription,
    // 비배열/null이면 null로(잘못된 jsonb가 TranscriptSection.slice 크래시 안 나게) — meetings 쿼리와 동일 방어.
    speakerLabels: Array.isArray(c.speaker_labels)
      ? (c.speaker_labels as { speaker: string; text: string }[])
      : null,
    speakerRoles,
    processingError: c.processing_error,
    audioDurationSec: c.audio_duration_sec,
    recordings,
    audioReport,
    aiFormSuggestions,
    aiAnalysis: ai
      ? {
          id: ai.id,
          modelVersion: ai.model_version,
          diagnosis: ai.diagnosis as Diagnosis,
          learningPlan: ai.learning_plan as LearningPlan,
          printPayload: ai.print_payload as PrintPayload,
          recommendedClassIds: ai.recommended_class_ids as string[] | null,
          generatedAt: ai.generated_at,
          reportEditedBy: ai.report_edited_by ?? null,
          reportEditedAt: ai.report_edited_at ?? null,
        }
      : null,
    recommendedClasses,
    // 버전 필드가 맞는 스냅샷만 통과 — 옛/깨진 jsonb가 화면 렌더를 크래시시키지 않게(speaker_labels 방어와 동일).
    prepBrief: isPrepBriefRecord(c.prep_brief) ? c.prep_brief : null,
    prepBriefStatus:
      c.prep_brief_status === "generating" || c.prep_brief_status === "failed"
        ? c.prep_brief_status
        : null,
    prepBriefError: (c.prep_brief_error as string | null) ?? null,
    // 생성 작업 시작 시각(s2_0068) · 240초 넘게 '생성 중'이면 멈춘 것 — 화면이 '다시 작성'을 보인다(검수 2026-11-11).
    prepBriefJobAt: (c.prep_brief_job_at as string | null) ?? null,
    prepBriefStalled:
      c.prep_brief_status === "generating" &&
      (!c.prep_brief_job_at || Date.now() - Date.parse(c.prep_brief_job_at as string) > PREP_BRIEF_STALL_MS),
    studentId: linkedStudentId,
    assignedClassCount,
    personConsultCount: 1, // 상세는 목록 카드 배지를 안 씀 — 타입 충족용(상세의 '다른 상담'은 getSiblingConsultations로 별도 조회).
    personConsults: [],
    makeeduId: (c as { makeedu_id?: string | null }).makeedu_id ?? null,
    fields: mapFullFields(c as Record<string, unknown>, assignedClassCount),
  };
}

const s = (v: unknown): string | null => (v == null ? null : String(v));

function mapFullFields(c: Record<string, unknown>, assignedClassCount: number): FullConsultationFields {
  return {
    englishName: s(c.english_name),
    gender: s(c.gender),
    bloodType: s(c.blood_type),
    birthDate: s(c.birth_date),
    studentPhone: s(c.student_phone),
    homePhone: s(c.home_phone),
    parentRelation: s(c.parent_relation),
    address: s(c.address),
    zipCode: s(c.zip_code),
    addressDetail: s(c.address_detail),
    consultationPath: s(c.consultation_path),
    subject: s(c.subject),
    careerGoal: s(c.career_goal),
    siblings: s(c.siblings),
    safetyNotes: s(c.safety_notes),
    registrationStatus: boardStatusOf({ outcome: String(c.outcome), assignedClassCount }).label,
    paymentAmount: s(c.payment_amount),
    paymentDate: s(c.payment_date),
    registrar: s(c.registrar),
    followUpDate: s(c.follow_up_date),
    followUpContent: s(c.follow_up_content),
    nonRegistrationReason: s(c.non_registration_reason),
    shuttleBusRequest: !!c.shuttle_bus_request,
    privacyAgreement: !!c.privacy_agreement,
    installmentAgreement: !!c.installment_agreement,
    subjectDetails: (c.subject_details as Record<string, Record<string, string>> | null) ?? null,
    intakeChecklist: (c.intake_checklist as IntakeChecklist | null) ?? null,
    counselor: s(c.counselor),
    receivedDate: s(c.received_date),
    studentType: s(c.student_type),
    siblingsDetails: s(c.siblings_details),
    // 상담일 = 전용 date 컬럼(순수 date라 TZ 변환/slice 불필요). consulted_at을 자르지 않는다(하루밀림 방지).
    consultationDate: s(c.consultation_date),
  };
}

// ─────────────────────── 상담 결과(outcome) 라벨 ───────────────────────

export type OutcomeKey =
  | "pending"
  | "scheduled"
  | "consulted"
  | "ai_done"
  | "enrolled"
  | "declined"
  | "no_show";

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  pending: "대기",
  scheduled: "예약",
  consulted: "상담완료",
  ai_done: "AI 완료",
  enrolled: "재원생 등록 완료", // 원장 2026-09-18 — outcome-meta 정본과 같은 문자열
  declined: "거절",
  no_show: "노쇼",
};

export async function getConsultantOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role")
    .in("system_role", ["counselor", "manager", "admin", "master", "teacher"])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({ id: u.id, name: u.display_name }));
}

/**
 * 병합으로 사라진 상담 → **남은(병합된) 상담 id**. 없으면 null.
 *
 * 원장 2026-09-01 제보: *"병합 처리시 이렇게 404가 나오는데 자동으로 병합된 곳으로 이동하도록."*
 * 병합은 진 쪽 행을 지우므로 그 주소는 404가 된다 — 병합 다이얼로그는 자기 창을 옮기지만, **그 상담을
 * 열어 둔 다른 창·뒤로가기·북마크·복원된 창**은 지워진 id를 그대로 들고 있다.
 *
 * 🔑 근거는 병합이 남긴 **감사로그**뿐이다(별도 매핑 표를 새로 만들지 않는다 — 병합은 `metadata`에
 *    `{winnerId, loserIds}`를 이미 적는다). jsonb 포함 검색이라 인덱스 없이도 소량이고, 실패하면
 *    그냥 null(=평소대로 404)이라 화면을 죽이지 않는다.
 * ⚠️ **사슬을 따라간다** — A→B로 합친 뒤 B→C로 또 합칠 수 있다. 무한 루프를 막으려고 걸음 수를 막고
 *    (MERGE_CHAIN_MAX) 이미 지나온 id는 다시 안 본다.
 */
const MERGE_CHAIN_MAX = 5;

export async function findMergeSuccessor(lostId: string): Promise<string | null> {
  const supabase = await createClient();
  const seen = new Set<string>([lostId]);
  let cur = lostId;
  for (let hop = 0; hop < MERGE_CHAIN_MAX; hop += 1) {
    // 🔴 감사로그는 **좁은 문**으로 읽는다 — 원장 2026-09-09 *"감사로그는 마스터 이상급으로만"* 으로
    //    정책을 좁혔기 때문에, 세션 클라로 읽으면 병합된 상담 링크가 강사에게만 404가 된다.
    const scope = await systemAuditScope(["consultation_merge"]);
    if (!scope) return null;
    const { data, error } = await auditScoped(
      scope.admin.from("audit_logs").select("metadata"),
      scope,
    )
      .contains("metadata", { loserIds: [cur] })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const winner = (data.metadata as { winnerId?: string } | null)?.winnerId;
    // 자기 자신·이미 지나온 id면 사슬이 꼬인 것 — 더 가지 않는다(무한 리다이렉트 방지).
    if (!winner || seen.has(winner)) return null;
    // 살아 있는 행일 때만 보낸다 — 승자가 또 지워졌으면 그 승자의 승자를 계속 찾는다.
    const { data: alive } = await supabase
      .from("enrollment_consultations")
      .select("id")
      .eq("id", winner)
      .maybeSingle();
    if (alive) return winner;
    seen.add(winner);
    cur = winner;
  }
  return null;
}
