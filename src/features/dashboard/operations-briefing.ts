/**
 * "Eywa가 정리한 오늘" 브리핑 집계.
 *
 * 이미 조회한 대시보드 신호만 받아 표시용 lane으로 묶는 순수 함수다.
 * counts와 headline은 학생/건수 합계가 아니라 사용자가 확인할 "신호 종류 수"를 세며,
 * followUps가 preview(limit=8)라는 점은 countLabel의 "표시"로 드러낸다.
 */
import type { AbsenceRisk, DashFollowUp } from "./server/queries";
import type { TodayActionItem } from "./today-actions";

export type BriefingLane = "urgent" | "today" | "approval" | "notice";
export type BriefingPriority = "critical" | "high" | "medium" | "low";
export type AssistantState = "critical" | "attention" | "steady";

export type BriefingItem = {
  key: string;
  lane: BriefingLane;
  label: string;
  countLabel: string | null;
  detail: string | null;
  href: string;
  /** lane에서 결정되는 표시·정렬용 우선순위. LLM 판단을 사용하지 않는다. */
  priority: BriefingPriority;
  /** 원본 화면으로 이동하는 CTA 문구. 신호 key의 고정 규칙으로 결정한다. */
  actionLabel: string;
};

export type BriefingGroup = {
  lane: BriefingLane;
  label: string;
  description: string;
  items: BriefingItem[];
};

export type OperationsBriefing = {
  groups: BriefingGroup[];
  counts: Record<BriefingLane, number>;
  attentionSignalCount: number;
  headline: string;
  /** 가장 먼저 확인할 실행 신호. 긴급 → 승인 → 오늘 순서다. */
  focus: BriefingItem | null;
  /** focus를 제외한 실행 대기열. 참고 신호는 포함하지 않는다. */
  queue: BriefingItem[];
  /** 즉시 실행 대상은 아니지만 지켜볼 참고 신호. */
  watchList: BriefingItem[];
  assistantState: AssistantState;
  /** counts와 focus만으로 만드는 결정론적 한국어 요약. */
  summary: string;
};

export type BriefingFollowUp = Pick<DashFollowUp, "id" | "studentId" | "studentName" | "urgency">;
export type BriefingAbsenceRisk = Pick<AbsenceRisk, "studentId" | "studentName" | "absences">;

/**
 * 반복 결석의 기준이 되는 출결 원천 데이터의 신선도.
 * staleDays는 KST 달력 날짜 차이이며, 최근 기록이 없을 때는 null을 넘긴다.
 */
export type BriefingAttendanceFreshness = {
  referenceDate: string | null;
  staleDays: number | null;
  /** 조회 실패로 기록 유무·신선도를 신뢰할 수 없음. */
  unavailable?: boolean;
};

export type BuildOperationsBriefingInput = {
  actions: readonly TodayActionItem[];
  followUps: readonly BriefingFollowUp[];
  /** 상담 후속 원천 조회 실패. 빈 배열(실제 0건)과 구분해 사용자에게 확인 불가로 표시한다. */
  followUpsUnavailable?: boolean;
  absenceRisks: readonly BriefingAbsenceRisk[];
  /** null이면 역할상 출결 원천을 볼 수 없음. 객체의 null 값은 권한은 있으나 기록이 없음을 뜻한다. */
  attendanceFreshness: BriefingAttendanceFreshness | null;
};

export const ATTENDANCE_STALE_AFTER_DAYS = 7;
const ISO_DATE_PATTERN = /^\d{4}-(\d{2})-(\d{2})$/;

const GROUP_META: ReadonlyArray<Omit<BriefingGroup, "items">> = [
  { lane: "urgent", label: "긴급", description: "지금 먼저 확인해 주세요." },
  { lane: "today", label: "오늘", description: "오늘 안에 처리할 항목입니다." },
  { lane: "approval", label: "승인 대기", description: "내용을 확인하고 승인해 주세요." },
  { lane: "notice", label: "참고", description: "오늘 운영에 참고할 알림입니다." },
];

const PRIORITY_BY_LANE: Readonly<Record<BriefingLane, BriefingPriority>> = {
  urgent: "critical",
  approval: "high",
  today: "medium",
  notice: "low",
};

const ACTION_LABEL_BY_KEY: Readonly<Record<string, string>> = {
  absent: "출결 확인",
  unrecorded: "출결 확인",
  "unwritten-reports": "보고서 작성",
  "classnote-attention": "발송 확인",
  "unassigned-enrolled": "반 배정",
  expenses: "결재 확인",
  textbooks: "신청 확인",
  "leaves-pending": "승인 확인",
  "leaves-today": "휴가 일정 확인",
  makeedu: "연동 확인",
  "followup-overdue": "후속조치 확인",
  "followup-due": "후속조치 확인",
  "followup-data-unavailable": "상담 화면 확인",
  "attendance-data-unavailable": "출결 확인",
  "attendance-data-missing": "출결 확인",
  "attendance-data-stale": "출결 갱신",
  "repeated-absence": "학생 확인",
};

function actionLabelForKey(key: string): string {
  if (key.startsWith("failed-analysis-")) return "다시 분석";
  if (key.startsWith("source-issue-")) return "원본 확인";
  return ACTION_LABEL_BY_KEY[key] ?? "확인하기";
}

function briefingItem(item: Omit<BriefingItem, "priority" | "actionLabel">): BriefingItem {
  return {
    ...item,
    priority: PRIORITY_BY_LANE[item.lane],
    actionLabel: actionLabelForKey(item.key),
  };
}

function assistantSummary(
  counts: Readonly<Record<BriefingLane, number>>,
  focus: BriefingItem | null,
): string {
  if (counts.urgent > 0 && focus) {
    const remaining = [
      counts.approval > 0 ? `승인 대기 ${counts.approval}종` : null,
      counts.today > 0 ? `오늘 할 일 ${counts.today}종` : null,
    ].filter((part): part is string => part !== null);
    return remaining.length > 0
      ? `${focus.label}부터 확인해 주세요. 긴급 ${counts.urgent}종을 처리한 뒤 ${remaining.join("과 ")}이 있습니다.`
      : `${focus.label}부터 확인해 주세요. 긴급 신호 ${counts.urgent}종이 있습니다.`;
  }
  if (counts.approval > 0 && focus) {
    return counts.today > 0
      ? `${focus.label}부터 확인해 주세요. 승인 대기 ${counts.approval}종과 오늘 할 일 ${counts.today}종이 있습니다.`
      : `${focus.label}부터 확인해 주세요. 승인 대기 ${counts.approval}종이 있습니다.`;
  }
  if (counts.today > 0 && focus) {
    return `${focus.label}부터 확인해 주세요. 오늘 처리할 항목 ${counts.today}종이 있습니다.`;
  }
  if (counts.notice > 0) {
    return `즉시 처리할 항목은 없습니다. 참고할 운영 신호 ${counts.notice}종을 확인해 주세요.`;
  }
  return "긴급하거나 오늘 처리할 운영 신호가 없습니다.";
}

function laneForAction(action: TodayActionItem): BriefingLane {
  if (action.key === "expenses" || action.key === "leaves-pending") return "approval";
  if (action.severity === "danger") return "urgent";
  if (action.severity === "amber") return "today";
  return "notice";
}

function countLabelForAction(action: TodayActionItem): string | null {
  if (action.count === null) return null;
  if (action.key === "unrecorded") return `${action.count}개 반`;
  if (
    action.key === "absent" ||
    action.key === "unwritten-reports" ||
    action.key === "unassigned-enrolled" ||
    action.key === "leaves-today"
  ) {
    return `${action.count}명`;
  }
  return `${action.count}건`;
}

function summarizeNames(names: readonly string[], max = 3): string {
  const head = names.slice(0, max).join("·");
  return names.length > max ? `${head} 외 ${names.length - max}` : head;
}

function summarizeAbsences(items: readonly BriefingAbsenceRisk[], max = 3): string {
  const head = items
    .slice(0, max)
    .map((item) => `${item.studentName} ${item.absences}회`)
    .join(" · ");
  return items.length > max ? `${head} 외 ${items.length - max}명` : head;
}

function formatReferenceDate(date: string | null): string {
  if (!date) return "마지막 기록일 미확인";
  const match = ISO_DATE_PATTERN.exec(date);
  return match ? `${Number(match[1])}월 ${Number(match[2])}일` : date;
}

export function buildOperationsBriefing({
  actions,
  followUps,
  followUpsUnavailable = false,
  absenceRisks,
  attendanceFreshness,
}: BuildOperationsBriefingInput): OperationsBriefing {
  const itemsByLane: Record<BriefingLane, BriefingItem[]> = {
    urgent: [],
    today: [],
    approval: [],
    notice: [],
  };

  for (const action of actions) {
    const lane = laneForAction(action);
    itemsByLane[lane].push(briefingItem({
      key: action.key,
      lane,
      label: action.label,
      countLabel: countLabelForAction(action),
      detail: action.detail,
      href: action.href,
    }));
  }

  if (followUpsUnavailable) {
    itemsByLane.today.push(briefingItem({
      key: "followup-data-unavailable",
      lane: "today",
      label: "상담 후속조치 확인 불가",
      countLabel: null,
      detail: "후속조치 목록을 불러오지 못했습니다. 상담 화면에서 직접 확인해 주세요.",
      href: "/consultations",
    }));
  }

  const overdueFollowUps = followUpsUnavailable
    ? []
    : followUps.filter((item) => item.urgency === "overdue");
  if (overdueFollowUps.length > 0) {
    itemsByLane.urgent.push(briefingItem({
      key: "followup-overdue",
      lane: "urgent",
      label: "기한 지난 상담 후속조치",
      countLabel: `${overdueFollowUps.length}건 표시`,
      detail: summarizeNames(overdueFollowUps.map((item) => item.studentName)),
      href: "/consultations",
    }));
  }

  const dueFollowUps = followUpsUnavailable
    ? []
    : followUps.filter((item) => item.urgency === "today" || item.urgency === "soon");
  if (dueFollowUps.length > 0) {
    itemsByLane.today.push(briefingItem({
      key: "followup-due",
      lane: "today",
      label: "오늘·임박 상담 후속조치",
      countLabel: `${dueFollowUps.length}건 표시`,
      detail: summarizeNames(dueFollowUps.map((item) => item.studentName)),
      href: "/consultations",
    }));
  }

  const attendanceStaleDays = attendanceFreshness?.staleDays ?? null;
  const attendanceIsUnavailable = attendanceFreshness?.unavailable === true;
  const attendanceIsMissing =
    attendanceFreshness !== null &&
    attendanceFreshness.referenceDate === null &&
    attendanceFreshness.staleDays === null;
  const attendanceIsStale =
    attendanceStaleDays !== null && attendanceStaleDays > ATTENDANCE_STALE_AFTER_DAYS;

  if (attendanceIsUnavailable) {
    itemsByLane.today.push(briefingItem({
      key: "attendance-data-unavailable",
      lane: "today",
      label: "출결 현황 확인 불가",
      countLabel: null,
      detail: "처리 현황을 불러오지 못했습니다. 원본 출결 화면에서 다시 확인해 주세요.",
      href: "/attendance",
    }));
  } else if (attendanceIsMissing) {
    itemsByLane.today.push(briefingItem({
      key: "attendance-data-missing",
      lane: "today",
      label: "출결 기록 확인 필요",
      countLabel: null,
      detail: "최근 출결 기록을 찾지 못해 반복 결석 신호를 계산하지 못했습니다.",
      href: "/attendance",
    }));
  } else if (attendanceIsStale && attendanceFreshness) {
    itemsByLane.urgent.push(briefingItem({
      key: "attendance-data-stale",
      lane: "urgent",
      label: "출결 데이터 갱신 필요",
      countLabel: `${attendanceStaleDays}일 지연`,
      detail: `${formatReferenceDate(attendanceFreshness.referenceDate)} 이후 새 기록이 없습니다. 반복 결석 신호는 최신 출결이 들어올 때까지 숨겼습니다.`,
      href: "/attendance",
    }));
  } else if (attendanceFreshness && absenceRisks.length > 0) {
    itemsByLane.urgent.push(briefingItem({
      key: "repeated-absence",
      lane: "urgent",
      label: "최근 출결 기록 기준 반복 결석",
      countLabel: `${absenceRisks.length}명`,
      detail: summarizeAbsences(absenceRisks),
      href: "/students",
    }));
  }

  const groups = GROUP_META.map((meta) => ({ ...meta, items: itemsByLane[meta.lane] })).filter(
    (group) => group.items.length > 0,
  );
  const counts: Record<BriefingLane, number> = {
    urgent: itemsByLane.urgent.length,
    today: itemsByLane.today.length,
    approval: itemsByLane.approval.length,
    notice: itemsByLane.notice.length,
  };
  const attentionSignalCount = counts.urgent + counts.today + counts.approval;
  const headline =
    attentionSignalCount > 0
      ? `지금 확인할 신호 ${attentionSignalCount}종`
      : counts.notice > 0
        ? `참고할 운영 신호 ${counts.notice}종`
        : "오늘 확인할 운영 신호가 없습니다";

  const actionableItems = [
    ...itemsByLane.urgent,
    ...itemsByLane.approval,
    ...itemsByLane.today,
  ];
  const focus = actionableItems[0] ?? null;
  const queue = actionableItems.slice(1);
  const watchList = [...itemsByLane.notice];
  const assistantState: AssistantState =
    counts.urgent > 0
      ? "critical"
      : counts.approval > 0 || counts.today > 0
        ? "attention"
        : "steady";
  const summary = assistantSummary(counts, focus);

  return {
    groups,
    counts,
    attentionSignalCount,
    headline,
    focus,
    queue,
    watchList,
    assistantState,
    summary,
  };
}
