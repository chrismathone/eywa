/**
 * 일일 브리핑 다이제스트 — 순수 함수만(서버·DB 무관, Vitest).
 *
 * 설계 원칙: 숫자·명단의 유일한 진실은 payload(결정론 신호)이고, LLM(narrative)은 서술만 담당한다.
 * - 아침(07:00 KST) 생성이라 "오늘" 신호는 구조적으로 0 → 다이제스트는 **어제 마감 + 오늘 예정**으로 조립.
 * - LLM 프롬프트에는 개인 이름을 넣지 않고(라벨+수치만), 응답은 validateNarrative(숫자 grounding·
 *   영문 토큰 금지·길이)를 통과한 것만 저장 — 실패 시 buildFallbackNarrative(결정론 요약)로 대체.
 */
import { buildTodayActions, type TodayActionItem, type TodayActionsRaw } from "./today-actions";

export type DailyBriefingPayload = {
  /** 브리핑 대상일(KST 오늘) — briefing_date와 동일 */
  date: string;
  yesterday: string;
  /** 어제 마감 + 시간 무관 조치 신호(분석실패·결재·교재·미배정·발송큐·동기화). 어제 기준 리라벨 적용. */
  attention: TodayActionItem[];
  today: { classSessions: number | null; leaves: string[]; pendingLeaveApprovals: number };
  followUps: { overdue: number; dueSoon: number };
  absenceRisks: { count: number; names: string[] };
  retention: { total: number; risk: number; warn: number; revenueRiskManwon: number } | null;
  /**
   * 위험 학생 스포트라이트(결정론) — retention 상위 + 반복 결석 병합, 최대 6명.
   * 이름·사유·권장 조치 전부 시스템 산출(retention risk.reasons·primaryAction) = 카드가 이걸 직접 렌더하고
   * LLM은 이 명단 안에서만 언급 가능(매니저 팀 보고의 grounding 재료).
   */
  spotlights: { name: string; reasons: string[]; action: string | null }[];
  /** 조회 실패 도메인(확인 불가 정직성) — 라벨만 */
  sourceIssueLabels: string[];
};

/** "오늘" 문구로 수집된 어제 기준 신호의 표시 리라벨(신호 key 고정 규칙). */
const YESTERDAY_RELABEL: Readonly<Record<string, string>> = {
  absent: "어제 무단결석",
  "unwritten-reports": "어제 미작성 보고서",
};

export type BuildDailyBriefingInput = {
  date: string;
  /** asOf=어제(nowMinutes=1440)로 수집 — absent·미작성이 '어제' 의미가 된다 */
  yesterdayRaw: TodayActionsRaw;
  /** 지금(실제 오늘) 수집 — 어제 미기록 반·오늘 휴가·승인 대기만 소비 */
  todayRaw: TodayActionsRaw;
  followUps: { overdue: number; dueSoon: number };
  absenceRisks: { studentName: string; absences: number }[];
  retention: { total: number; risk: number; warn: number; revenueRisk: number } | null;
  /** retention 상위 위험 학생(위험도 내림차순, 사유·권장 조치 포함) — 서버가 roster에서 추출. */
  retentionTop: { name: string; reasons: string[]; action: string | null }[];
  todayClassSessions: number | null;
};

const SPOTLIGHT_MAX = 6;

/** retention 상위 + 반복 결석 병합(이름 중복 제거) — 결석만 걸린 학생은 결석 사유로 추가. */
function buildSpotlights(input: BuildDailyBriefingInput): DailyBriefingPayload["spotlights"] {
  const spotlights: DailyBriefingPayload["spotlights"] = input.retentionTop.slice(0, SPOTLIGHT_MAX).map((s) => ({
    name: s.name,
    reasons: s.reasons,
    action: s.action,
  }));
  const seen = new Set(spotlights.map((s) => s.name));
  for (const risk of input.absenceRisks) {
    if (spotlights.length >= SPOTLIGHT_MAX) break;
    if (seen.has(risk.studentName)) continue;
    seen.add(risk.studentName);
    spotlights.push({ name: risk.studentName, reasons: [`최근 14일 결석 ${risk.absences}회`], action: null });
  }
  return spotlights;
}

export function buildDailyBriefingPayload(input: BuildDailyBriefingInput): DailyBriefingPayload {
  const merged: TodayActionsRaw = {
    ...input.yesterdayRaw,
    // 어제 미기록 반은 오늘 수집분이 정확하다(asOf=어제 수집은 그저께를 보게 됨).
    unrecordedYesterday: input.todayRaw.unrecordedYesterday,
    yesterday: input.todayRaw.yesterday,
    // 휴가는 attention이 아니라 '오늘 예정' 섹션으로 분리.
    leavesToday: [],
    leavesPending: 0,
    sourceIssues: [],
  };
  const attention = buildTodayActions(merged).map((item) =>
    YESTERDAY_RELABEL[item.key] ? { ...item, label: YESTERDAY_RELABEL[item.key] } : item,
  );
  const issueLabels = [
    ...(input.yesterdayRaw.sourceIssues ?? []),
    ...(input.todayRaw.sourceIssues ?? []),
  ].map((issue) => issue.label.replace(/^오늘 /, ""));
  return {
    date: input.date,
    yesterday: input.todayRaw.yesterday,
    attention,
    today: {
      classSessions: input.todayClassSessions,
      leaves: input.todayRaw.leavesToday.map((leave) => leave.name),
      pendingLeaveApprovals: input.todayRaw.leavesPending,
    },
    followUps: input.followUps,
    absenceRisks: {
      count: input.absenceRisks.length,
      names: input.absenceRisks.slice(0, 5).map((risk) => risk.studentName),
    },
    retention: input.retention
      ? {
          total: input.retention.total,
          risk: input.retention.risk,
          warn: input.retention.warn,
          revenueRiskManwon: Math.round(input.retention.revenueRisk / 10_000),
        }
      : null,
    spotlights: buildSpotlights(input),
    sourceIssueLabels: [...new Set(issueLabels)],
  };
}

/** LLM 서술 생성이 필요한가 — 조치 신호가 하나도 없으면 호출 자체를 스킵(비용, 원장 승인 조건). */
export function shouldGenerateNarrative(payload: DailyBriefingPayload): boolean {
  return (
    payload.attention.length > 0 ||
    payload.followUps.overdue + payload.followUps.dueSoon > 0 ||
    payload.absenceRisks.count > 0 ||
    payload.spotlights.length > 0 ||
    (payload.retention?.risk ?? 0) > 0
  );
}

/** 프롬프트·가드가 공유하는 숫자 화이트리스트 — narrative의 모든 숫자는 이 집합 안이어야 한다. */
export function narrativeNumberWhitelist(payload: DailyBriefingPayload): Set<string> {
  const numbers = new Set<string>();
  const add = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return;
    numbers.add(String(value));
  };
  for (const ymd of [payload.date, payload.yesterday]) {
    const [y, m, d] = ymd.split("-");
    numbers.add(y);
    add(Number(m));
    add(Number(d));
  }
  for (const item of payload.attention) add(item.count);
  add(payload.attention.length);
  add(payload.today.classSessions);
  add(payload.today.leaves.length);
  add(payload.today.pendingLeaveApprovals);
  add(payload.followUps.overdue);
  add(payload.followUps.dueSoon);
  add(payload.followUps.overdue + payload.followUps.dueSoon);
  add(payload.absenceRisks.count);
  if (payload.retention) {
    add(payload.retention.total);
    add(payload.retention.risk);
    add(payload.retention.warn);
    add(payload.retention.risk + payload.retention.warn);
    add(payload.retention.revenueRiskManwon);
  }
  add(payload.spotlights.length);
  // 스포트라이트 사유 문자열 속 숫자("성적 15점 하락", "결석 3회")도 LLM이 인용할 수 있는 근거.
  for (const spotlight of payload.spotlights) {
    for (const text of [...spotlight.reasons, spotlight.action ?? ""]) {
      for (const token of text.match(/\d+/g) ?? []) numbers.add(String(Number(token)));
    }
  }
  return numbers;
}

/** 개인 이름 없이 라벨+수치만 — 서술 재료. 프롬프트와 폴백 요약이 같은 사실 목록을 쓴다. */
export function digestFactLines(payload: DailyBriefingPayload): string[] {
  const lines: string[] = [];
  for (const item of payload.attention) {
    lines.push(`- ${item.label}: ${item.count ?? "상태 이상"}${item.count != null ? "건" : ""}`);
  }
  const followUpTotal = payload.followUps.overdue + payload.followUps.dueSoon;
  if (followUpTotal > 0) {
    lines.push(`- 상담 후속조치: 기한 지남 ${payload.followUps.overdue}건, 오늘·임박 ${payload.followUps.dueSoon}건`);
  }
  if (payload.absenceRisks.count > 0) lines.push(`- 반복 결석 위험 학생: ${payload.absenceRisks.count}명`);
  if (payload.retention && payload.retention.risk + payload.retention.warn > 0) {
    lines.push(
      `- 재등록 이탈 신호: 위험 ${payload.retention.risk}명 · 관심 ${payload.retention.warn}명 (관련 월 수강료 약 ${payload.retention.revenueRiskManwon}만원)`,
    );
  }
  if (payload.today.classSessions != null) lines.push(`- 오늘 수업 일정: ${payload.today.classSessions}건`);
  if (payload.today.leaves.length > 0) lines.push(`- 오늘 휴가 직원: ${payload.today.leaves.length}명`);
  if (payload.today.pendingLeaveApprovals > 0) lines.push(`- 휴가 승인 대기: ${payload.today.pendingLeaveApprovals}건`);
  if (payload.sourceIssueLabels.length > 0) {
    lines.push(`- 확인 불가(조회 실패) 영역: ${payload.sourceIssueLabels.join("·")}`);
  }
  return lines;
}

// LLM 프롬프트·검증·폴백은 briefing-team-report.ts("학원 매니저 팀" 보고 v2)로 이동 —
// 이 파일은 결정론 payload(숫자·명단의 진실)와 그 재료 함수만 담당한다.
