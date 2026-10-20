import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  groupOutstandingPeriods,
  type OutstandingPeriodRow,
} from "@/features/dashboard/outstanding-periods";
import { fetchInChunks, fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { inclusiveDateWindowStart, kstToday, kstMonthStart, kstMonth } from "@/lib/date-kst";
import {
  countAbsencesBySubject,
  type AbsenceSubjectCounts,
  type AbsenceSubjectRow,
} from "@/features/dashboard/absence-subjects";
import {
  summarizeAbsenceReasons,
  type AbsenceReasonSummary,
} from "@/features/dashboard/absence-reasons";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import type { SystemRole } from "@/lib/permissions";
import { summarizeInvoices } from "@/features/billing/calc";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { isMergedStudent } from "@/features/students/status/merged";
import { bookkeepingOnlyIds } from "@/features/withdrawals/server/bookkeeping";
import {
  buildDashboardTrendPoints,
  invoicePeriodsForRange,
  kstDateForTimestamp,
  type TrendAttendanceRow,
  type TrendInvoiceRow,
  type TrendPoint,
} from "@/features/dashboard/trend-data";
import {
  followUpUrgency,
  type FollowUpUrgency,
} from "@/features/consultations/follow-up-urgency";
import {
  getDailyProcessingStatus,
  type ClassProcessing,
} from "@/features/attendance/server/queries";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { audiencesForRole } from "@/features/notices/audience";

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export type { TrendPoint };

export async function getEnrolledStudentCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "enrolled");
  // 조회 실패를 **재원생 0명**이라는 사실 주장으로 바꾸지 않는다 — 히어로 KPI라 숫자 하나가 곧
  // "학원이 비었다"로 읽힌다. 호출부(dashboardQuery)가 실패 허용을 담당한다(이 파일의 기존 규약).
  if (error) throw new Error(`재원생 수 조회 실패: ${error.message}`);
  return count ?? 0;
}

/**
 * **학년별 재원생** — 대시보드 구성 막대(레퍼런스 `Headcount by Dept`에 대응)의 재료.
 *
 * 🔴 `fetchAllPaged`로 받는다 — 재원생이 1000명을 넘기면 무페이징 select는 **에러 없이 잘려**
 *    그만큼의 학년이 조용히 사라진다(B2). 지금 339명이라 한 장이지만 상한을 두지 않는다.
 * 🔴 `grade` **한 칸만** 받는다 — 이름·학교는 이 막대에 필요 없고, 받으면 payload만 커진다.
 * ⚠️ 라벨은 그대로 쓴다 — 학년 표기는 학원설정이 단일 소스이고 여기서 손대면 두 곳이 갈린다.
 *    빈 값은 순수부(`countByLabel`)가 "미지정"으로 모은다(버리면 합계가 재원생 수와 안 맞는다).
 */
export async function getGradeComposition(): Promise<(string | null)[]> {
  const supabase = await createClient();
  const rows = await fetchAllPaged<{ grade: string | null }>((from, to) =>
    supabase
      .from("students")
      .select("grade")
      .eq("status", "enrolled")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => r.grade);
}

export type EnrollmentChangeStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  date: string | null;
};
export type EnrollmentChanges = {
  newCount: number;
  withdrawnCount: number;
  newStudents: EnrollmentChangeStudent[];
  withdrawn: EnrollmentChangeStudent[];
};

const MONTHLY_CHANGE_PREVIEW_LIMIT = 40;

/** 이번 달 증감 조회가 받는 행 — 병합 판정(`notes`)까지 함께 받는다. */
type MonthlyChangeRecord = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolled_at?: string | null;
  withdrawn_at?: string | null;
  notes: string | null;
  /** 퇴원 쪽만 — 수업 기록 없는 장부 정리 판정(`bookkeepingOnlyIds`). */
  withdrawal_metadata?: unknown;
};

/**
 * 이번 달 신규 등록 + 퇴원 학생. 명단 preview만 보내 RSC payload를 유한하게 유지한다.
 *
 * 🔴 중복 병합으로 흡수된 쪽은 등록에도 퇴원에도 세지 않는다(원장 2026-09-13, `students/merged.ts`).
 *    판정 재료가 `notes` 접두 문자열이라 **행을 받아 JS에서 거른다** — PostgREST의 negative 문자열 필터는
 *    `notes`가 null인 행을 통째로 떨구는 NULL 함정이 있어 조용히 틀리기 쉽다. 이번 달 창이라 행은 수십 건이다.
 * ⚠️ 그래서 `count(exact)`를 버리고 **거른 행의 수**를 센다 — 덤으로 종전의 모집단 불일치도 사라진다
 *    (count는 전체인데 명단은 40건 상한이라 "N명" 옆 명단이 다른 집합이었다, [[#89]] 계열).
 */
export async function getMonthlyEnrollmentChanges(): Promise<EnrollmentChanges> {
  const supabase = await createClient();
  const startIso = kstMonthStart();
  // 조회 실패를 '이번 달 ±0'으로 위장하지 않는다 — fetchAllPaged가 throw하고, 호출부(dashboardQuery)가 실패 허용을 담당.
  const [nw, wd] = await Promise.all([
    fetchAllPaged<MonthlyChangeRecord>((from, to) =>
      supabase
        .from("students")
        .select("id, name, grade, school, enrolled_at, notes")
        .eq("status", "enrolled")
        .gte("enrolled_at", startIso)
        .order("enrolled_at", { ascending: false })
        // OFFSET 페이지 안정화 — unique tie-break(id) 필수(batch.ts 계약)
        .order("id", { ascending: false })
        .range(from, to),
    ),
    fetchAllPaged<MonthlyChangeRecord>((from, to) =>
      supabase
        .from("students")
        .select("id, name, grade, school, withdrawn_at, notes, withdrawal_metadata")
        .eq("status", "withdrawn")
        .gte("withdrawn_at", startIso)
        .order("withdrawn_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
  ]);
  const newStudents = nw.filter((s) => !isMergedStudent(s.notes));
  // 수업 기록 없는 장부 정리는 퇴원으로 세지 않는다(퇴원관리·운영실과 같은 판정 — `isBookkeepingOnlyExit`).
  const wdReal = wd.filter((s) => !isMergedStudent(s.notes));
  const bookkeeping = await bookkeepingOnlyIds(supabase, wdReal);
  const withdrawn = wdReal.filter((s) => !bookkeeping.has(s.id));
  return {
    newCount: newStudents.length,
    withdrawnCount: withdrawn.length,
    newStudents: newStudents.slice(0, MONTHLY_CHANGE_PREVIEW_LIMIT).map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      date: s.enrolled_at ?? null,
    })),
    withdrawn: withdrawn.slice(0, MONTHLY_CHANGE_PREVIEW_LIMIT).map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      date: s.withdrawn_at ?? null,
    })),
  };
}

export type SubjectChange = { subject: string; newCount: number; withdrawnCount: number; net: number };
export type EnrollmentChangeSummary = {
  days: number;
  newCount: number;
  withdrawnCount: number;
  net: number;
  bySubject: SubjectChange[]; // 순증감 낮은 순(퇴원 많은 과목 먼저)
};

/**
 * 최근 N일(기본 7) 학생 증감 — 신규 등록/퇴원 수(전체) + 과목별. 대시보드 "최근 7일" 카드.
 * 전체 카운트는 count:exact head:true(행 미수신, B2). 과목별은 창 내 학생 id(7일 창=소량)를 받아 수강 반 과목으로
 * 집계(fetchInChunks, B3) — 한 학생이 2과목이면 각 과목에 계수(과목별 합 ≠ 전체는 정상, 학생 중복 제거는 과목 단위).
 * 신규=활성 수강(end_date null)의 과목, 퇴원=그 학생의 (종료 포함) 수강 과목.
 */
export async function getEnrollmentChangeLast7d(days = 7): Promise<EnrollmentChangeSummary> {
  const supabase = await createClient();
  const since = inclusiveDateWindowStart(kstToday(), days);

  // 🔴 중복 병합으로 흡수된 쪽은 등록에도 퇴원에도 세지 않는다 — 판정 재료가 `notes`라 행을 받아 JS에서
  //    거르고(위 월간 함수와 같은 이유·같은 규약) **그 수를 센다**. 7일 창이라 행이 소량이다.
  //    조회 실패를 '최근 7일 변동 없음'이라는 거짓 문장으로 바꾸지 않는다(fetchAllPaged가 throw).
  const [newRows, wdRows] = await Promise.all([
    fetchAllPaged<{ id: string; notes: string | null }>((from, to) =>
      supabase
        .from("students")
        .select("id, notes")
        .eq("status", "enrolled")
        .gte("enrolled_at", since)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ id: string; notes: string | null; withdrawal_metadata: unknown }>((from, to) =>
      supabase
        .from("students")
        .select("id, notes, withdrawal_metadata")
        .eq("status", "withdrawn")
        .gte("withdrawn_at", since)
        .order("id")
        .range(from, to),
    ),
  ]);
  const newIds = newRows.filter((r) => !isMergedStudent(r.notes)).map((r) => r.id);
  const wdReal = wdRows.filter((r) => !isMergedStudent(r.notes));
  const bookkeeping = await bookkeepingOnlyIds(supabase, wdReal);
  const withdrawnIds = wdReal.filter((r) => !bookkeeping.has(r.id)).map((r) => r.id);
  const newCount = newIds.length;
  const withdrawnCount = withdrawnIds.length;

  const subjOf = (row: { class: unknown }): string | null => {
    const c = (Array.isArray(row.class) ? row.class[0] : row.class) as { subject?: string | null } | undefined;
    return c?.subject ?? null;
  };
  const aggregate = async (ids: string[], activeOnly: boolean): Promise<Map<string, Set<string>>> => {
    const bySubj = new Map<string, Set<string>>();
    if (ids.length === 0) return bySubj;
    const rows = await fetchInChunks<{ student_id: string; class: unknown }>(ids, (chunk) => {
      let q = supabase.from("enrollments").select("student_id, class:class_id(subject)").in("student_id", chunk);
      if (activeOnly) q = q.is("end_date", null);
      return q;
    });
    for (const r of rows) {
      const s = subjOf(r);
      if (!s) continue;
      (bySubj.get(s) ?? bySubj.set(s, new Set()).get(s)!).add(r.student_id);
    }
    return bySubj;
  };
  const [newBySubj, wdBySubj] = await Promise.all([
    aggregate(newIds, true),
    aggregate(withdrawnIds, false),
  ]);

  const subjects = new Set([...newBySubj.keys(), ...wdBySubj.keys()]);
  const bySubject: SubjectChange[] = [...subjects]
    .map((subject) => {
      const nc = newBySubj.get(subject)?.size ?? 0;
      const wc = wdBySubj.get(subject)?.size ?? 0;
      return { subject, newCount: nc, withdrawnCount: wc, net: nc - wc };
    })
    .sort((a, b) => a.net - b.net); // 순감 큰(퇴원 많은) 과목 먼저

  return { days, newCount, withdrawnCount, net: newCount - withdrawnCount, bySubject };
}

export type AttendanceSnapshot = {
  date: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

async function snapshotForDate(date: string): Promise<AttendanceSnapshot | null> {
  const supabase = await createClient();
  const rows = await fetchAllPaged<EffectiveAttendanceRecord & { status: string }>((from, to) =>
    supabase
      .from("attendance_records")
      .select("id, student_id, class_id, session_date, status, recorded_at")
      .eq("session_date", date)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const data = effectiveAttendanceRecords(rows);

  if (data.length === 0) return null;

  const present = data.filter((r) => r.status === "present").length;
  const absent = data.filter((r) => r.status === "absent").length;
  const late = data.filter((r) => r.status === "late").length;
  const excused = data.filter((r) => r.status === "excused").length;
  const total = data.length;
  return {
    date,
    total,
    present,
    absent,
    late,
    excused,
    rate: attendanceRate(attendedCount({ present, late }), total),
  };
}

export async function getMostRecentAttendanceSnapshot(): Promise<AttendanceSnapshot | null> {
  const today = kstToday();
  const todaySnap = await snapshotForDate(today);
  if (todaySnap) return todaySnap;

  const supabase = await createClient();
  const { data: recent, error } = await supabase
    .from("attendance_records")
    .select("session_date")
    .lte("session_date", today)
    .order("session_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(`recent attendance date: ${error.message}`);
  const fallback = recent?.[0]?.session_date;
  if (!fallback) return null;
  return snapshotForDate(fallback);
}

export type DashboardAttendanceState = {
  snapshot: AttendanceSnapshot | null;
  todayProcessing: ClassProcessing[];
  snapshotProcessing: ClassProcessing[];
  snapshotIssue: boolean;
  todayProcessingIssue: boolean;
  snapshotProcessingIssue: boolean;
};

async function collectProcessing(date: string): Promise<{
  value: ClassProcessing[];
  issue: boolean;
}> {
  try {
    return { value: await getDailyProcessingStatus(date), issue: false };
  } catch (error) {
    console.error(`[dashboard/attendance] ${date} 처리 현황 조회 실패`, error);
    return { value: [], issue: true };
  }
}

async function collectAttendanceSnapshot(): Promise<{
  value: AttendanceSnapshot | null;
  issue: boolean;
}> {
  try {
    return { value: await getMostRecentAttendanceSnapshot(), issue: false };
  } catch (error) {
    console.error("[dashboard/attendance] 최근 출결 스냅샷 조회 실패", error);
    return { value: null, issue: true };
  }
}

/** 헤더 출석률과 오늘 미처리 배지가 같은 예정학생 대비 처리 현황을 공유한다. */
export async function getDashboardAttendanceState(): Promise<DashboardAttendanceState> {
  const today = kstToday();
  const [snapshotResult, todayCollected] = await Promise.all([
    collectAttendanceSnapshot(),
    collectProcessing(today),
  ]);
  const snapshot = snapshotResult.value;
  const snapshotProcessingCollected =
    snapshot && snapshot.date !== today
      ? await collectProcessing(snapshot.date)
      : todayCollected;
  return {
    snapshot,
    todayProcessing: todayCollected.value,
    snapshotProcessing: snapshotProcessingCollected.value,
    snapshotIssue: snapshotResult.issue,
    todayProcessingIssue: todayCollected.issue,
    snapshotProcessingIssue: snapshotProcessingCollected.issue,
  };
}

export type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  audience: string;
  pinned: boolean;
  createdAt: string;
  authorName: string | null;
};

export async function getRecentAnnouncements(
  role: SystemRole,
  limit = 3,
): Promise<AnnouncementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(
      `id, title, content, audience, pinned, created_at,
       author:author_id ( display_name )`,
    )
    .in("audience", audiencesForRole(role))
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  // 조회 실패를 '공지 없음'으로 위장하지 않는다 — 호출부(dashboardQuery)가 실패 허용을 담당.
  if (error) throw new Error(`공지 조회 실패: ${error.message}`);
  if (!data) return [];

  return data.map((row) => {
    const authorField = row.author as { display_name?: string } | { display_name?: string }[] | null;
    let authorName: string | null = null;
    if (Array.isArray(authorField)) {
      authorName = authorField[0]?.display_name ?? null;
    } else if (authorField) {
      authorName = authorField.display_name ?? null;
    }
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      audience: row.audience,
      pinned: row.pinned,
      createdAt: row.created_at,
      authorName,
    };
  });
}

export type DashFollowUp = {
  id: string;
  studentId: string;
  studentName: string;
  followUpAction: string | null;
  followUpDate: string | null;
  urgency: FollowUpUrgency;
};

/**
 * 학생상담 후속조치 — 미완료 + 기한 임박/경과(긴급도 overdue/today/soon)만, 빠른 순.
 * db = cron(admin) 주입 경로 — RLS 우회라 명시 tenant 필터 필수.
 */
export async function getFollowUpConsultations(
  limit = 8,
  db?: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string },
): Promise<DashFollowUp[]> {
  const supabase = db?.supabase ?? (await createClient());
  let query = supabase
    .from("student_consultations")
    .select("id, student_id, follow_up_action, follow_up_date, student:student_id ( name )")
    .eq("follow_up_done", false)
    .not("follow_up_date", "is", null);
  if (db) query = query.eq("tenant_id", db.tenantId);
  const { data, error } = await query.order("follow_up_date", { ascending: true }).limit(60);
  if (error) throw new Error(`dashboard follow-ups: ${error.message}`);
  const rows: DashFollowUp[] = [];
  for (const r of data ?? []) {
    const u = followUpUrgency(r.follow_up_date as string | null, false);
    if (u !== "overdue" && u !== "today" && u !== "soon") continue;
    const st = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
    rows.push({
      id: r.id,
      studentId: r.student_id,
      studentName: st?.name ?? "(학생)",
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      urgency: u,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export type ManageAnnouncementRow = {
  id: string;
  title: string;
  content: string;
  audience: string;
  pinned: boolean;
  createdAt: string;
  authorName: string | null;
};

/**
 * 공지 관리 모달용 — 최근 공지(고정 우선) 목록. AnnouncementRow의 상위집합(작성자·일시 포함)이라
 * canManage면 카드(앞 4건)도 여기서 도출 = getRecentAnnouncements 이중 fetch 제거(정렬 동일).
 */
export async function getAnnouncementsForManage(limit = 30): Promise<ManageAnnouncementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(
      `id, title, content, audience, pinned, created_at,
       author:author_id ( display_name )`,
    )
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  // 조회 실패를 '공지 없음'으로 위장하지 않는다 — 호출부(dashboardQuery)가 실패 허용을 담당.
  if (error) throw new Error(`공지 관리 목록 조회 실패: ${error.message}`);
  if (!data) return [];
  return data.map((row) => {
    const a = (Array.isArray(row.author) ? row.author[0] : row.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      audience: row.audience,
      pinned: row.pinned,
      createdAt: row.created_at as string,
      authorName: a?.display_name ?? null,
    };
  });
}

export type DashEnrollmentRow = {
  id: string;
  name: string;
  /** 학교·학년 (없으면 null) */
  meta: string | null;
  outcome: "pending" | "scheduled" | "consulted" | "ai_done";
  /** 상담일(consultation_date) ?? 접수 시각 날짜부 — "YYYY-MM-DD" */
  date: string | null;
};

export type DashEnrollmentList = { total: number; rows: DashEnrollmentRow[] };

/**
 * 등록상담 목록(활성 = 대기·예약·상담완료·AI완료) — 최근 순 limit건 + 건수(count exact, 절단 무관).
 * 대시보드는 **최근 30일만** — 전체 기간은 활성 상담이 283건까지 쌓여(대부분 몇 달 전 '상담완료' 잔류)
 * 카드 건수가 "지금 챙길 일"이 아니라 누적 재고를 뜻했다(원장 지적 2026-07-15). 전체는 '전체 →' 링크로.
 * 기준 컬럼은 칸반 월 필터와 동일한 `consulted_at`(정렬 키와도 일치).
 */
export async function getActiveEnrollmentConsultations(limit = 6, days = 30): Promise<DashEnrollmentList> {
  const supabase = await createClient();
  const since = inclusiveDateWindowStart(kstToday(), days);
  const { data, count, error } = await supabase
    .from("enrollment_consultations")
    .select("id, prospect_name, prospect_school, prospect_grade, outcome, consultation_date, consulted_at", {
      count: "exact",
    })
    .in("outcome", ["pending", "scheduled", "consulted", "ai_done"])
    .gte("consulted_at", `${since}T00:00:00+09:00`)
    .order("consulted_at", { ascending: false })
    .limit(limit);
  // 조회 실패를 '상담 0건'으로 위장하지 않는다 — 호출부(dashboardQuery)가 실패 허용을 담당.
  if (error) throw new Error(`등록상담 목록 조회 실패: ${error.message}`);
  const rows: DashEnrollmentRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.prospect_name as string | null) ?? "(이름 없음)",
    meta: schoolGradeLabel(r.prospect_school as string | null, r.prospect_grade as string | null) || null,
    outcome: r.outcome as DashEnrollmentRow["outcome"],
    // consulted_at은 timestamptz(UTC ISO) — slice(0,10)은 UTC 날짜라 KST 오전 접수가 전날로 밀린다.
    date:
      (r.consultation_date as string | null) ??
      (typeof r.consulted_at === "string" ? kstDateForTimestamp(r.consulted_at) : null),
  }));
  return { total: count ?? 0, rows };
}

export type UnassignedEnrolled = {
  studentId: string;
  name: string;
  meta: string | null; // 학교·학년 압축 라벨
  enrolledAt: string | null; // 등록일(YYYY-MM-DD)
};

/**
 * 등록됨(enrolled)인데 활성 수강(반)이 없는 학생 = "배정 필요". anti-join RPC(0097a, security invoker +
 * auth_tenant_id 이중격리) — 대시보드 반응속도 1순위라 전건 fetch+JS 대신 DB 1쿼리.
 *
 * ⚠️ **`students.length`를 건수로 쓰지 말 것** — limit로 잘린 미리보기다. 총계는 `total`(0159a
 * `count(*) over ()`, LIMIT 이전 평가라 왕복 추가 없음)을 쓴다. 예전엔 배열 길이를 "N명"으로 보고해
 * 상한(30)에 닿은 뒤로 실제가 34명이어도 화면이 영원히 30이었다(2026-07-31 실측).
 *
 * db(cron admin) 경로는 p_tenant 변형(0114a) — 세션용 RPC는 auth_tenant_id()가 service_role에서
 * null이라 **에러 없이 0행**을 반환하는 silent 오보가 나기 때문(브리핑 cron 필수 분기).
 */
export async function getUnassignedEnrolledStudents(
  limit = 30,
  db?: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string },
): Promise<{ students: UnassignedEnrolled[]; total: number }> {
  const supabase = db?.supabase ?? (await createClient());
  const { data, error } = db
    ? await supabase.rpc("dashboard_unassigned_enrolled_admin", { p_limit: limit, p_tenant: db.tenantId })
    : await supabase.rpc("dashboard_unassigned_enrolled", { p_limit: limit });
  if (error) throw new Error(`getUnassignedEnrolledStudents: ${error.message}`);
  const rows = (data ?? []) as Array<{
    student_id: string;
    student_name: string;
    grade: string | null;
    school: string | null;
    enrolled_at: string | null;
    total_count: number | string | null;
  }>;
  return {
    students: rows.map((r) => ({
      studentId: r.student_id,
      name: r.student_name,
      meta: schoolGradeLabel(r.school, r.grade) || null,
      enrolledAt: r.enrolled_at,
    })),
    // bigint는 postgrest에서 문자열로 올 수 있다. 0행이면 윈도우 행 자체가 없으므로 0.
    total: rows.length > 0 ? Number(rows[0]!.total_count ?? rows.length) : 0,
  };
}

export type PaymentSnapshot = {
  period: string;
  totalCount: number;
  paidCount: number;
  /** 부분납 + 전액 미납 (밴드 "미수 N건"의 기존 의미). */
  unpaidCount: number;
  /** 🔴 갈라 둔다 — 2026-09 실측은 26건이 **전부 부분납**이고 전액 미납은 0건이었다.
   *  둘을 뭉쳐 "미납 26건"이라 적으면 대부분 낸 학부모를 안 낸 것처럼 말한다. */
  partialCount: number;
  fullyUnpaidCount: number;
  paymentRate: number;
  outstanding: number;
};

export async function getPaymentRateThisMonth(): Promise<PaymentSnapshot | null> {
  const supabase = await createClient();
  const period = kstMonth();
  // B2: 집계용 전건 fetch는 fetchAllPaged(무페이징 select는 1000행 silent 절단).
  const data = await fetchAllPaged<{
    id: string;
    amount_total: number;
    amount_paid: number;
    amount_discount: number | null;
    status: string;
  }>((from, to) =>
    supabase
      .from("invoices")
      .select("id, amount_total, amount_paid, amount_discount, status")
      .eq("period", period)
      // void = makeedu에서 삭제된 청구(동기화 무효 처리) — 분모(청구 총액·수납률)에서도 제외.
      .neq("status", "void")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (data.length === 0) return null;

  // 수납 지표 단일 진실 = billing/calc summarizeInvoices — 수납관리 KPI와 같은 숫자 보장.
  // (수납률 = 수납/실청구(청구−할인)·100% 상한, 미수 = 행 레벨 clamp·refunded/void/paid 제외)
  const s = summarizeInvoices(
    data.map((r) => ({
      amountTotal: Number(r.amount_total),
      amountPaid: Number(r.amount_paid),
      amountDiscount: Number(r.amount_discount ?? 0),
      status: r.status,
    })),
    period,
  );
  return {
    period,
    totalCount: s.totalCount,
    paidCount: s.paidCount,
    unpaidCount: s.unpaidCount + s.partialCount, // 밴드 '미수 N건' = 미수+부분납(기존 의미 유지)
    partialCount: s.partialCount,
    fullyUnpaidCount: s.unpaidCount,
    paymentRate: s.paymentRate,
    outstanding: s.outstanding,
  };
}

export type TrendDataScope = { attendance?: boolean; billing?: boolean };

/**
 * 최근 7일 추세(스파크라인) — **60초 캐시**(B6). 이웃 두 위젯(미수 상위·결석 위험)이 같은 이유로
 * 이미 캐시돼 있다.
 *
 * 왜 캐시인가: 이 한 함수가 **출결 7일 전건 + 겹치는 청구월 invoices 전건**(`line_items` jsonb 포함)을
 * 끌어온다 — 실측 규모로 대략 3,000~4,000행이고 이 페이지에서 바이트가 가장 큰 조회다. 게다가
 * aywa는 **창(iframe)마다 셸+페이지가 다시 도는 구조**라 창 N개면 N배고, 운영실은 5분마다 스스로
 * `router.refresh()`까지 한다(하루 90여 회). 7일 추세선에 초 단위 신선도는 필요 없다.
 *
 * 🔴 **호출 전에 권한을 확인할 것** — 캐시 안에서 admin 클라이언트를 쓰므로 RLS를 타지 않는다
 *    (캐시엔 쿠키가 없다, B6). 그래서 `tenant_id`를 **명시로** 건다. 대시보드 페이지는 이미
 *    `access.read.attendance || access.read.billing`로 갈라 부르고, 어느 축을 실을지도 scope로 넘긴다.
 * 🔴 캐시 키에 **scope 두 축이 들어간다** — 안 넣으면 수납 권한이 없는 사람이 남의 캐시(청구 포함)를
 *    받는다.
 */
export const getTrendDataLast7Days = (
  tenantId: string,
  scope: TrendDataScope = {},
): Promise<TrendPoint[]> => {
  const includeAttendance = scope.attendance ?? true;
  const includeBilling = scope.billing ?? true;
  if (!includeAttendance && !includeBilling) return Promise.resolve([]);
  return unstable_cache(
    async () => loadTrendPoints(tenantId, includeAttendance, includeBilling),
    ["dashboard-trend-7d", tenantId, String(includeAttendance), String(includeBilling)],
    { tags: [dashboardWidgetsTag(tenantId)], revalidate: 60 },
  )();
};

async function loadTrendPoints(
  tenantId: string,
  includeAttendance: boolean,
  includeBilling: boolean,
): Promise<TrendPoint[]> {
  const supabase = createAdminClient();
  // Window ends yesterday — today is still in progress and shouldn't drag the
  // line to 0% just because attendance hasn't been recorded yet. KST 날짜 문자열을
  // UTC 자정 Date로 바꿔 서버 로컬 시간대와 무관하게 같은 7일 창을 만든다.
  const end = new Date(`${kstToday()}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const invoicePeriods = invoicePeriodsForRange(startIso, endIso);

  // B2: 둘 다 집계용 전건 fetch — fetchAllPaged(출결 7일·겹치는 청구월 invoices 모두 1000행 초과 가능).
  const [attendanceRows, invRows] = await Promise.all([
    includeAttendance
      ? fetchAllPaged<TrendAttendanceRow & EffectiveAttendanceRecord>((from, to) =>
          supabase
            .from("attendance_records")
            .select("id, student_id, class_id, session_date, status, recorded_at")
            // ⚠️ admin은 RLS를 우회하므로 **tenant 필터가 필수**(캐시 안엔 쿠키가 없다).
            .eq("tenant_id", tenantId)
            .gte("session_date", startIso)
            .lte("session_date", endIso)
            .order("recorded_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([]),
    // 7일 창과 겹치는 청구월 invoices — 월 경계에서도 각 월 누적 수납률을 계산한다.
    includeBilling
      ? fetchAllPaged<TrendInvoiceRow>((from, to) =>
          supabase
            .from("invoices")
            .select("id, period, amount_total, amount_paid, amount_discount, paid_at, line_items")
            .eq("tenant_id", tenantId)
            .in("period", invoicePeriods)
            .neq("status", "void")
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);

  return buildDashboardTrendPoints({
    startIso,
    endIso,
    attendanceRows: effectiveAttendanceRecords(attendanceRows),
    invoiceRows: invRows,
    includeAttendance,
    includeBilling,
  });
}

// ─────────── 추가 대시보드 위젯 ───────────

export type OutstandingItem = {
  studentId: string;
  studentName: string;
  amount: number; // 잔액(미납)
  status: string; // unpaid | partial
  /**
   * 그 잔액이 **어느 달 몫인지**(`YYYY-MM`, 오래된 순). 원장 2026-08-31: *"몇월분이 미납인건지
   * 26.08 이런식으로 월미납 붙여놓자"* — 이 카드 금액은 전 기간 합산이라 달을 안 적으면 이번 달치로 읽힌다.
   * ⚠️ 라벨은 부가 정보라 조회가 실패해도 **빈 배열**로 두고 카드는 그대로 띄운다(수치가 먼저다).
   */
  periods: string[];
};

/**
 * 미수 상위 — unpaid/partial 인보이스의 잔액 큰 순(이름 명단). 밴드의 '미수 N건'(카운트)에
 * '누구'를 붙이는 명단. due_date 창에 의존하지 않아 항상 채워진다(데모 미납 187건).
 */
export async function getTopOutstanding(limit = 8): Promise<OutstandingItem[]> {
  const supabase = await createClient();
  // 학생별 미납 잔액 합산 top N — DB group-by RPC 1쿼리(구: 전건 fetch + JS 집계, 0039a).
  const { data, error } = await supabase.rpc("dashboard_top_outstanding", { p_limit: limit });
  if (error) throw new Error(`getTopOutstanding: ${error.message}`);
  const rows = (data ?? []) as Array<{
    student_id: string;
    student_name: string;
    amount: number | string;
    status: string;
  }>;
  // 명단이 8명 남짓이라 한 번의 조회로 끝난다(B2/B3 안전). 실패해도 라벨만 비고 카드는 그대로.
  const ids = rows.map((r) => r.student_id);
  const detail = ids.length
    ? await supabase
        .from("invoices")
        .select("student_id, period, amount_total, amount_discount, amount_paid")
        .in("student_id", ids)
        .in("status", ["unpaid", "partial"])
    : { data: [], error: null };
  const byStudent = groupOutstandingPeriods(
    (detail.error ? [] : (detail.data ?? [])) as OutstandingPeriodRow[],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    amount: Number(r.amount),
    status: r.status,
    periods: byStudent.get(r.student_id) ?? [],
  }));
}

/**
 * 대시보드 위젯(미수 상위·결석 위험) 캐시 태그 — 테넌트별. 지금은 TTL(60초)만 쓰지만, 즉시 반영이
 * 필요해지면 저장 액션에서 `updateTag(dashboardWidgetsTag(tenantId))`로 비우면 된다.
 */
export function dashboardWidgetsTag(tenantId: string): string {
  return `dashboard-widgets:${tenantId}`;
}

/**
 * 🔴 **호출 전에 권한을 반드시 확인할 것** — 아래 두 함수는 캐시 안에서 **admin 클라이언트**를 쓰므로
 * RLS를 타지 않는다(캐시엔 쿠키가 없다, B6 규칙 — `loadTenantSettingsRaw`와 같은 패턴).
 * 대시보드 페이지는 이미 `access.read.billing` / `access.read.students && access.read.attendance`로
 * 갈라 부르므로 안전하다. **게이트 없는 새 호출부는 RLS를 타는 원래 함수**(`getTopOutstanding`·
 * `getAbsenceRiskStudents`)를 쓸 것 — 대화형 비서 툴이 그 경우다.
 *
 * 왜 캐시인가(실측 2026-08-13): 이 두 RPC는 **RLS 경로에서 70~90배 비싸다** — 직접 실행 0.1~1.3ms인데
 * authenticated 롤로는 86ms·103ms(콜드 454ms·241ms)다. 게이트 함수(`auth_billing_can_read` 등)가
 * 표마다 붙는 값이라 쿼리를 더 조여도 안 줄어든다. 게다가 aywa는 **창(iframe)마다 셸+페이지가 다시
 * 도는 구조**라 창 N개면 N배로 든다. 59일 실측 총합 **48분+26분**이 이 둘이었다.
 * 60초 TTL이면 창을 몇 개를 띄우든 1분에 한 번만 돈다. 미수·결석 위험은 초 단위 신선도가 필요 없다.
 */
export const getTopOutstandingCached = (tenantId: string, limit = 8): Promise<OutstandingItem[]> =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("dashboard_top_outstanding_admin", {
        p_limit: limit,
        p_tenant: tenantId,
      });
      if (error) throw new Error(`getTopOutstandingCached: ${error.message}`);
      const rows = (data ?? []) as Array<{
        student_id: string;
        student_name: string;
        amount: number | string;
        status: string;
      }>;
      // ⚠️ admin은 RLS를 우회하므로 **tenant 필터가 필수**(캐시 안엔 쿠키가 없다 — 위 주석의 규약).
      const ids = rows.map((r) => r.student_id);
      const detail = ids.length
        ? await admin
            .from("invoices")
            .select("student_id, period, amount_total, amount_discount, amount_paid")
            .eq("tenant_id", tenantId)
            .in("student_id", ids)
            .in("status", ["unpaid", "partial"])
        : { data: [], error: null };
      const byStudent = groupOutstandingPeriods(
        (detail.error ? [] : (detail.data ?? [])) as OutstandingPeriodRow[],
      );
      return rows.map((r) => ({
        studentId: r.student_id,
        studentName: r.student_name,
        amount: Number(r.amount),
        status: r.status,
        periods: byStudent.get(r.student_id) ?? [],
      }));
    },
    ["dashboard-top-outstanding", tenantId, String(limit)],
    { tags: [dashboardWidgetsTag(tenantId)], revalidate: 60 },
  )();

export type AbsenceRisk = {
  studentId: string;
  studentName: string;
  absences: number;
};

/**
 * 결석 위험 학생: 최근 14일 결석 ≥ 3건. 단 데모 출결이 과거에 몰려 있어 'today-14d'로는 0건이 되므로
 * 가장 최근 기록일을 앵커로 그 직전 14일 창을 본다(실데이터가 최신이면 today와 동일하게 동작).
 */
export async function getAbsenceRiskStudents(
  db?: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string },
): Promise<AbsenceRisk[]> {
  const supabase = db?.supabase ?? (await createClient());
  // 최근 기록일 기준 14일 결석 ≥3 — DB group-by/having RPC 1쿼리(구: anchor + 전건 조인 + JS, 0039a).
  // db(cron admin) 경로는 p_tenant 변형(0114a) — 세션용 RPC는 service_role에서 에러 없이 0행(silent 오보).
  const { data, error } = db
    ? await supabase.rpc("dashboard_absence_risk_admin", { p_min: 3, p_tenant: db.tenantId })
    : await supabase.rpc("dashboard_absence_risk", { p_min: 3 });
  if (error) throw new Error(`getAbsenceRiskStudents: ${error.message}`);
  return ((data ?? []) as Array<{ student_id: string; student_name: string; absences: number | string }>).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    absences: Number(r.absences),
  }));
}

/**
 * 결석 위험 14일 창의 **기준일**(anchor) — `dashboard_absence_risk*`가 쓰는 값과 같은 정의:
 * 그 테넌트의 `max(session_date)` 중 **오늘(KST) 이하**(0220a — 미리 찍은 미래 결석이 창을 밀지 않게).
 *
 * 행을 모아 JS에서 max를 구하지 않고 **정렬 1행만** 받는다(B2). 실측 4ms(injaewon 12,910행 —
 * index-only scan + top-N heapsort). 아침 cron에서 1회라 이 이상 조일 이유가 없다.
 * 출결이 한 건도 없으면 null → 호출부는 과목 분해를 포기한다(창을 임의로 지어내지 않는다).
 */
export async function getAbsenceRiskAnchor(db: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  tenantId: string;
}): Promise<string | null> {
  const { data, error } = await db.supabase
    .from("attendance_records")
    .select("session_date")
    .eq("tenant_id", db.tenantId)
    .lte("session_date", kstToday())
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getAbsenceRiskAnchor: ${error.message}`);
  return (data?.session_date as string | undefined) ?? null;
}

/**
 * 결석 위험 학생의 "N회"를 **과목별로 쪼개고 사유를 요약한다**(원장 2026-08-29).
 *
 * 🔴 status로 미리 거르지 않는다 — 유효 행은 (학생,반,수업일,교시)별 **최신 1건**이라, 결석을 출석으로
 *    정정한 날은 새 행이 있어야 그 결석이 사라진다. `eq("status","absent")`로 좁히면 정정 전 결석이 되살아나
 *    분해 합이 총계보다 커진다. 세는 규칙은 [absence-subjects.ts](../absence-subjects.ts) 단일 소스.
 * B2/B3: 학생 id로 좁힌 뒤 `fetchAllPagedInChunks`(청크 + range 페이징) — 영어는 하루가 2~3행이라
 * 위험 학생 십수 명 × 14일이면 청크당 1,000행에 닿을 수 있다.
 */
export async function getAbsenceBreakdown(
  db: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string },
  studentIds: string[],
  anchorDate: string,
): Promise<{ subjects: AbsenceSubjectCounts; reasons: Map<string, AbsenceReasonSummary> }> {
  if (studentIds.length === 0) return { subjects: new Map(), reasons: new Map() };
  const rows = await fetchAllPagedInChunks(studentIds, (chunk, from, to) =>
    db.supabase
      .from("attendance_records")
      .select("id, student_id, class_id, session_date, slot_start, status, recorded_at, note, class:class_id ( subject )")
      .eq("tenant_id", db.tenantId)
      .in("student_id", chunk)
      .gte("session_date", inclusiveDateWindowStart(anchorDate, 14))
      .lte("session_date", anchorDate)
      .order("id", { ascending: true }) // OFFSET 페이지가 흔들리지 않도록 unique tie-break
      .range(from, to),
  );
  const flat = (rows as RawAbsenceRow[]).map((row) => {
    // PostgREST 임베드는 1:1이라도 배열로 올 수 있다(retention queries 선례).
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    return { ...row, subject: cls?.subject ?? null };
  });
  // 과목 분해와 사유 요약은 **같은 행**에서 나온다 — 왕복을 늘리지 않고, 세는 단위가 갈릴 여지도 없앤다.
  return { subjects: countAbsencesBySubject(flat), reasons: summarizeAbsenceReasons(flat) };
}

/** 위 select가 돌려주는 모양 — 과목은 임베드 안에 있어 순수 함수 입력으로 평탄화한다. */
type RawAbsenceRow = Omit<AbsenceSubjectRow, "subject"> & {
  class: { subject: string | null } | { subject: string | null }[] | null;
};

/** 결석 위험 학생 — 위 `getTopOutstandingCached`와 같은 계약(권한은 호출부가 확인, 60초 캐시). */
export const getAbsenceRiskCached = (tenantId: string): Promise<AbsenceRisk[]> =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("dashboard_absence_risk_admin", { p_min: 3, p_tenant: tenantId });
      if (error) throw new Error(`getAbsenceRiskCached: ${error.message}`);
      return ((data ?? []) as Array<{ student_id: string; student_name: string; absences: number | string }>).map(
        (r) => ({ studentId: r.student_id, studentName: r.student_name, absences: Number(r.absences) }),
      );
    },
    ["dashboard-absence-risk", tenantId],
    { tags: [dashboardWidgetsTag(tenantId)], revalidate: 60 },
  )();
