import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  groupOutstandingPeriods,
  type OutstandingPeriodRow,
} from "@/features/dashboard/outstanding-periods";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { inclusiveDateWindowStart, kstToday } from "@/lib/date-kst";
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
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { type TrendPoint } from "@/features/dashboard/trend-data";
import {
  followUpUrgency,
  type FollowUpUrgency,
} from "@/features/consultations/follow-up-urgency";
import { type ClassProcessing } from "@/features/attendance/server/queries";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { audiencesForRole } from "@/features/notices/audience";

export type { TrendPoint };

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

export type SubjectChange = { subject: string; newCount: number; withdrawnCount: number; net: number };
export type EnrollmentChangeSummary = {
  days: number;
  newCount: number;
  withdrawnCount: number;
  net: number;
  bySubject: SubjectChange[]; // 순증감 낮은 순(퇴원 많은 과목 먼저)
};

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

export type TrendDataScope = { attendance?: boolean; billing?: boolean };

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
