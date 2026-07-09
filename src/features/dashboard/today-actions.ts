/**
 * "오늘 조치할 것" 통합 패널 — 원시 신호(raw)를 표시 항목으로 조립하는 순수 함수.
 * 개별 위젯 난립 대신 조건부 신호(무단결석·미기록·분석실패·결재대기·휴가)를 한 패널의
 * 불릿으로 모으고, 전부 0건이면 패널이 "모든 항목 정상"을 보여준다(ijw MasterDashboard 패턴).
 * server-only 미의존(타입+순수) → Vitest로 정렬·문구·링크를 결정적으로 검증.
 */

export type TodayActionsRaw = {
  /** 오늘 무단결석(absent) 학생 — 학생 단위 dedupe 후 */
  absentToday: { studentId: string; name: string }[];
  /** 어제 출석 미기록 반 */
  unrecordedYesterday: { classId: string; className: string }[];
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
};

export type TodayActionItem = {
  key: string;
  severity: "danger" | "amber" | "info";
  label: string;
  /** null = 카운트 없는 상태 신호(makeedu 등) */
  count: number | null;
  detail: string | null;
  href: string;
};

/** "김A·이B·박C 외 2" — 명단 요약. */
export function nameList(names: string[], max = 3): string {
  const head = names.slice(0, max).join("·");
  return names.length > max ? `${head} 외 ${names.length - max}` : head;
}

const SEVERITY_RANK: Record<TodayActionItem["severity"], number> = { danger: 0, amber: 1, info: 2 };

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
    });
  }

  const failedTotal =
    raw.failedAnalysis.meetings + raw.failedAnalysis.enrollment + raw.failedAnalysis.consultations;
  if (failedTotal > 0) {
    const parts: string[] = [];
    if (raw.failedAnalysis.meetings) parts.push(`회의 ${raw.failedAnalysis.meetings}`);
    if (raw.failedAnalysis.enrollment) parts.push(`등록상담 ${raw.failedAnalysis.enrollment}`);
    if (raw.failedAnalysis.consultations) parts.push(`학생상담 ${raw.failedAnalysis.consultations}`);
    // 실패가 가장 많은 메뉴로 링크(동수면 회의→등록→상담 순).
    const max = Math.max(raw.failedAnalysis.meetings, raw.failedAnalysis.enrollment, raw.failedAnalysis.consultations);
    const href =
      raw.failedAnalysis.meetings === max
        ? "/meetings"
        : raw.failedAnalysis.enrollment === max
          ? "/enrollment"
          : "/consultations";
    items.push({
      key: "failed-analysis",
      severity: "danger",
      label: "녹음 분석 실패",
      count: failedTotal,
      detail: parts.join(" · "),
      href,
    });
  }

  if (raw.unwrittenReportsToday.count > 0) {
    items.push({
      key: "unwritten-reports",
      severity: "amber",
      label: "오늘 미작성 보고서",
      count: raw.unwrittenReportsToday.count,
      detail: nameList(raw.unwrittenReportsToday.names),
      href: "/onescreen",
    });
  }

  if (raw.unrecordedYesterday.length > 0) {
    items.push({
      key: "unrecorded",
      severity: "amber",
      label: "어제 출석 미기록",
      count: raw.unrecordedYesterday.length,
      detail: nameList(raw.unrecordedYesterday.map((c) => c.className), 2),
      href: `/attendance/${raw.yesterday}`,
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
    });
  }

  // 심각도(danger→amber→info) → 건수 desc(카운트 없는 상태 신호는 뒤로).
  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.count ?? -1) - (a.count ?? -1),
  );
}
