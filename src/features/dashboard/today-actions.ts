/**
 * "오늘 조치할 것" 통합 패널 — 원시 신호(raw)를 표시 항목으로 조립하는 순수 함수.
 * 개별 위젯 난립 대신 조건부 신호(무단결석·미기록·분석실패·결재대기·휴가)를 한 패널의
 * 불릿으로 모으고, 전부 0건이면 패널이 "모든 항목 정상"을 보여준다(ijw MasterDashboard 패턴).
 * server-only 미의존(타입+순수) → Vitest로 정렬·문구·링크를 결정적으로 검증.
 */
import type { MenuKey } from "@/lib/permissions";
import { balancedTake } from "@/lib/collections/balanced-take";
export {
  enrollmentAttendsOnDay,
  isEnrollmentActiveOn,
} from "@/features/enrollments/eligibility";

export type TodayActionAccess = "read" | "write" | "manage-staff";

export type TodayActionsRaw = {
  /** 오늘 무단결석(absent) 학생 — 학생 단위 dedupe 후 */
  absentToday: { studentId: string; name: string }[];
  /**
   * 어제 출석 미기록 반. `subject`는 미리보기 이름을 **과목별로 고르게** 뽑는 데 쓴다 —
   * 이름순 앞 2개만 뽑으면 한 과목(한글 이름 반)만 계속 노출된다(gotcha #84). 필수 필드로 둔 건
   * 새 호출부가 빠뜨리면 그 편향이 조용히 되살아나기 때문.
   */
  unrecordedYesterday: { classId: string; className: string; subject: string }[];
  /** 어제 날짜(YYYY-MM-DD) — 일별 미처리 페이지 링크용 */
  yesterday: string;
  /** 최근 7일 녹음 전사/AI 분석 실패 건수(테이블별) */
  failedAnalysis: { meetings: number; enrollment: number; consultations: number };
  /** makeedu 동기화 이상(자동 동기화 ON일 때만) — 없으면 null */
  makeeduIssue: { kind: "error" | "stale"; detail: string } | null;
  /** 최근 7일 지출 결재 대기 */
  pendingExpenses: number;
  /** 교재 신청 미처리(주문 전) */
  requestedTextbooks: number;
  /** 휴가 승인 대기(아직 안 끝난 휴가만) */
  leavesPending: number;
  /** 오늘 휴가 중인 직원 */
  leavesToday: { name: string }[];
  /** 오늘 수업(시작됨)이 있는데 아직 보고서 0건인 학생 — 미작성 리마인더(5단계-1). */
  unwrittenReportsToday: { count: number; names: string[] };
  /**
   * 재원인데 활성 수강(반)이 0개인 학생 = 반 배정 필요(0097a RPC).
   * ⚠️ 출처는 students 테이블이지 등록상담이 아니다 — 등록상담을 거치지 않은 학생(임포트·선등록)도 잡는 게
   * 목적이라 상담 기준으로 재정의하지 말 것(2026-07-15 실측: 상담 기준은 89건 전원이 퇴원·과거 건 = 헛경보).
   */
  unassignedEnrolled: { studentId: string; name: string }[];
  /**
   * ClassNote 발송 주의(관리자 조치 대상) — failed/tooOld=워커 확정 실패(7일 창),
   * humanHold=사람 조치 보류(blocked_shared·name_conflict, 창 없음), stuck=processing 10분 초과 멈춤.
   */
  classnoteAttention: { failed: number; tooOld: number; humanHold: number; stuck: number };
  /** 조회 실패를 0건으로 위장하지 않기 위한 권한·도메인별 원천 상태. */
  sourceIssues?: TodaySignalSourceIssue[];
};

export type TodaySignalSourceIssue = {
  key: string;
  label: string;
  href: string;
  menuKey: MenuKey;
  requiredAccess: TodayActionAccess;
};

export type TodayActionItem = {
  key: string;
  severity: "danger" | "amber" | "info";
  label: string;
  /** null = 카운트 없는 상태 신호(makeedu 등) */
  count: number | null;
  detail: string | null;
  href: string;
  /** 현재 역할이 이 조치를 열 수 있는지 브리핑에서 판정할 메뉴 권한 키. */
  menuKey: MenuKey;
  /** 카드가 약속하는 조치를 실제로 수행하는 데 필요한 접근 수준. */
  requiredAccess: TodayActionAccess;
};

/**
 * "김A·이B·박C 외 2" — 명단 요약.
 * `total`은 이미 골라낸 미리보기만 넘길 때 전체 개수를 따로 알려주기 위한 것(기본값 = names 길이).
 * 예: 과목별로 고르게 2개를 뽑아 넘기면서 "외 N"은 전체 기준으로 세야 할 때.
 */
export function nameList(names: string[], max = 3, total = names.length): string {
  const head = names.slice(0, max).join("·");
  return total > max ? `${head} 외 ${total - max}` : head;
}

const SEVERITY_RANK: Record<TodayActionItem["severity"], number> = { danger: 0, amber: 1, info: 2 };

/**
 * 오늘 미작성 보고서 학생을 학생×과목으로 판정한다.
 * lesson_reports에는 class_id가 없으므로 같은 학생의 같은 과목 여러 반은 한 대상으로 합치되,
 * 그 과목을 듣는 시작된 반이 전부 결석이면 작성 대상에서 제외한다.
 */
export function findStudentsMissingLessonReports(
  targets: readonly { studentId: string; classId: string; subject: string }[],
  absentClassKeys: ReadonlySet<string>,
  reports: readonly { studentId: string; subject: string | null }[],
): string[] {
  const classesByTarget = new Map<string, Set<string>>();
  const studentOrder: string[] = [];
  const seenStudents = new Set<string>();

  for (const target of targets) {
    const key = `${target.studentId}::${target.subject}`;
    const classes = classesByTarget.get(key) ?? new Set<string>();
    classes.add(target.classId);
    classesByTarget.set(key, classes);
    if (!seenStudents.has(target.studentId)) {
      seenStudents.add(target.studentId);
      studentOrder.push(target.studentId);
    }
  }

  // 과목 컬럼 도입 전 레거시/cron 보고서는 subject=null일 수 있다. 이미 보고서가 존재하는 학생을
  // 미작성으로 잘못 재촉하지 않도록 null/빈 과목 보고서는 그날 해당 학생의 모든 과목을 충족한 것으로 본다.
  const legacyReportedStudents = new Set(
    reports.filter((report) => !report.subject?.trim()).map((report) => report.studentId),
  );
  const reported = new Set(
    reports
      .filter((report): report is { studentId: string; subject: string } => !!report.subject?.trim())
      .map((report) => `${report.studentId}::${report.subject}`),
  );
  const missingStudents = new Set<string>();
  for (const [targetKey, classIds] of classesByTarget) {
    const separator = targetKey.indexOf("::");
    const studentId = targetKey.slice(0, separator);
    if (legacyReportedStudents.has(studentId)) continue;
    const hasAttendedTarget = [...classIds].some((classId) => !absentClassKeys.has(`${studentId}::${classId}`));
    if (hasAttendedTarget && !reported.has(targetKey)) missingStudents.add(studentId);
  }

  return studentOrder.filter((studentId) => missingStudents.has(studentId));
}

export function buildTodayActions(raw: TodayActionsRaw): TodayActionItem[] {
  const items: TodayActionItem[] = [];

  if (raw.absentToday.length > 0) {
    items.push({
      key: "absent",
      severity: "danger",
      label: "오늘 무단결석",
      count: raw.absentToday.length,
      detail: nameList(raw.absentToday.map((s) => s.name)),
      href: "/attendance",
      menuKey: "attendance",
      requiredAccess: "read",
    });
  }

  const analysisItems: ReadonlyArray<{
    key: string;
    count: number;
    label: string;
    href: string;
    menuKey: MenuKey;
    requiredAccess: TodayActionItem["requiredAccess"];
  }> = [
    {
      key: "failed-analysis-meetings",
      count: raw.failedAnalysis.meetings,
      label: "회의 녹음 분석 실패",
      href: "/meetings",
      menuKey: "meetings",
      requiredAccess: "write",
    },
    {
      key: "failed-analysis-enrollment",
      count: raw.failedAnalysis.enrollment,
      label: "등록상담 녹음 분석 실패",
      href: "/enrollment",
      menuKey: "enrollment",
      requiredAccess: "write",
    },
    {
      key: "failed-analysis-consultations",
      count: raw.failedAnalysis.consultations,
      label: "학생상담 녹음 분석 실패",
      href: "/consultations",
      menuKey: "consultations",
      requiredAccess: "write",
    },
  ];
  for (const analysis of analysisItems) {
    if (analysis.count === 0) continue;
    items.push({
      ...analysis,
      severity: "danger",
      detail: "최근 7일",
    });
  }

  if (raw.unwrittenReportsToday.count > 0) {
    items.push({
      key: "unwritten-reports",
      severity: "amber",
      label: "오늘 미작성 보고서",
      count: raw.unwrittenReportsToday.count,
      detail: nameList(raw.unwrittenReportsToday.names),
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
      requiredAccess: "read",
    });
  }

  const cn = raw.classnoteAttention;
  const cnTotal = cn.failed + cn.tooOld + cn.humanHold + cn.stuck;
  if (cnTotal > 0) {
    // raw 상태 키(blocked_shared 등)는 화면에 내보내지 않는다 — 한글 구분만(UI raw 코드 노출 금지).
    const cnParts = [
      cn.failed > 0 ? `발송 실패 ${cn.failed}` : null,
      cn.tooOld > 0 ? `기한 초과 ${cn.tooOld}` : null,
      cn.humanHold > 0 ? `확인 필요 ${cn.humanHold}` : null,
      cn.stuck > 0 ? `멈춤 ${cn.stuck}` : null,
    ].filter((part): part is string => part !== null);
    items.push({
      key: "classnote-attention",
      severity: "amber",
      label: "리포트 발송 주의",
      count: cnTotal,
      detail: cnParts.join(" · "),
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
      requiredAccess: "read",
    });
  }

  if (raw.unassignedEnrolled.length > 0) {
    // 소수(대개 1~2명)라 1명이면 그 학생 창으로 바로, 여럿이면 학생목록으로(목록엔 '미수강만' 필터가 없음).
    const only = raw.unassignedEnrolled.length === 1 ? raw.unassignedEnrolled[0] : null;
    items.push({
      key: "unassigned-enrolled",
      severity: "amber",
      label: "반 미배정 재원생",
      count: raw.unassignedEnrolled.length,
      detail: nameList(raw.unassignedEnrolled.map((s) => s.name)),
      href: only ? `/students/${only.studentId}` : "/students",
      menuKey: "students",
      requiredAccess: "write",
    });
  }

  if (raw.unrecordedYesterday.length > 0) {
    items.push({
      key: "unrecorded",
      severity: "amber",
      label: "어제 출석 미기록",
      count: raw.unrecordedYesterday.length,
      // ⚠️ 앞 2개를 그냥 자르지 않는다(gotcha #84). 목록이 이름순인데 ICU 한국어 정렬은 한글을
      // 로마자보다 앞에 둬서, 한글 이름 반(수학)이 미리보기를 독점하고 로마자 코드 반(영어)은
      // 미기록이 아무리 많아도 이름이 절대 안 뜬다 — 영어 담당자는 자기 반이 걸렸는지 알 수 없었다.
      // 과목별로 고르게 2개를 뽑고 "외 N"은 전체 기준으로 센다.
      detail: nameList(
        balancedTake(raw.unrecordedYesterday, (c) => c.subject, 2).map((c) => c.className),
        2,
        raw.unrecordedYesterday.length,
      ),
      href: `/attendance/${raw.yesterday}`,
      menuKey: "attendance",
      requiredAccess: "read",
    });
  }

  if (raw.pendingExpenses > 0) {
    items.push({
      key: "expenses",
      severity: "amber",
      label: "지출 결재 대기",
      count: raw.pendingExpenses,
      detail: "최근 7일",
      href: "/billing?tab=expenses",
      menuKey: "billing",
      requiredAccess: "write",
    });
  }

  if (raw.requestedTextbooks > 0) {
    items.push({
      key: "textbooks",
      severity: "amber",
      label: "교재 신청 미처리",
      count: raw.requestedTextbooks,
      detail: null,
      href: "/billing?tab=textbooks&status=requested",
      menuKey: "billing",
      requiredAccess: "write",
    });
  }

  if (raw.leavesPending > 0) {
    items.push({
      key: "leaves-pending",
      severity: "amber",
      label: "휴가 승인 대기",
      count: raw.leavesPending,
      detail: null,
      href: "/staff/leaves",
      menuKey: "staff",
      requiredAccess: "manage-staff",
    });
  }

  if (raw.makeeduIssue) {
    items.push({
      key: "makeedu",
      severity: "amber",
      label: "makeedu 동기화 이상",
      count: null,
      detail: raw.makeeduIssue.detail,
      href: "/owner?tab=sheets",
      menuKey: "owner",
      requiredAccess: "read",
    });
  }

  if (raw.leavesToday.length > 0) {
    items.push({
      key: "leaves-today",
      severity: "info",
      label: "오늘 휴가",
      count: raw.leavesToday.length,
      detail: nameList(raw.leavesToday.map((l) => l.name)),
      href: "/staff/leaves",
      menuKey: "staff",
      requiredAccess: "read",
    });
  }

  for (const issue of raw.sourceIssues ?? []) {
    items.push({
      key: `source-issue-${issue.key}`,
      severity: "amber",
      label: `${issue.label} 확인 불가`,
      count: null,
      detail: "새로고침 후 다시 확인해 주세요",
      href: issue.href,
      menuKey: issue.menuKey,
      requiredAccess: issue.requiredAccess,
    });
  }

  // 심각도(danger→amber→info) → 건수 desc(카운트 없는 상태 신호는 뒤로).
  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.count ?? -1) - (a.count ?? -1),
  );
}
