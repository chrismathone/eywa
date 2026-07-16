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
  todayClassSessions: number | null;
};

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
    sourceIssueLabels: [...new Set(issueLabels)],
  };
}

/** LLM 서술 생성이 필요한가 — 조치 신호가 하나도 없으면 호출 자체를 스킵(비용, 원장 승인 조건). */
export function shouldGenerateNarrative(payload: DailyBriefingPayload): boolean {
  return (
    payload.attention.length > 0 ||
    payload.followUps.overdue + payload.followUps.dueSoon > 0 ||
    payload.absenceRisks.count > 0 ||
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

export function buildNarrativePrompt(payload: DailyBriefingPayload): string {
  return [
    "당신은 학원 운영실의 아침 브리핑 비서입니다. 아래 결정론 수치 요약만 근거로, 원장이 아침에 가장 먼저 읽을 운영 브리핑 서술을 JSON으로만 답하세요.",
    "",
    "규칙(반드시 준수):",
    "- 한국어 존댓말 3~5문장. 첫 문장은 오늘 가장 먼저 확인할 일.",
    "- 아래 요약에 있는 숫자만 그대로 사용. 새 숫자·비율·합산·추정 금지.",
    "- 학생·직원 개인 이름 금지(요약에 없어도 만들지 말 것).",
    "- 영어 단어·코드·키 이름 금지.",
    `- 출력 형식: {"narrative": "..."}`,
    "",
    `[${payload.date} 아침 기준 운영 요약]`,
    ...digestFactLines(payload),
  ].join("\n");
}

/** LLM 서술 후검증 — 숫자 grounding(화이트리스트 밖 숫자 = 폐기)·영문 토큰·길이. */
export function validateNarrative(
  narrative: string,
  payload: DailyBriefingPayload,
): { ok: true } | { ok: false; reason: string } {
  const text = narrative.trim();
  if (text.length < 20) return { ok: false, reason: "서술이 너무 짧음" };
  if (text.length > 700) return { ok: false, reason: "서술이 너무 김" };
  if (/[A-Za-z]{3,}/.test(text)) return { ok: false, reason: "영문 토큰 포함" };
  const allowed = narrativeNumberWhitelist(payload);
  for (const token of text.match(/\d+/g) ?? []) {
    const normalized = String(Number(token));
    if (!allowed.has(normalized) && !allowed.has(token)) {
      return { ok: false, reason: `근거 없는 숫자 ${token}` };
    }
  }
  return { ok: true };
}

/** 결정론 폴백 요약 — LLM 실패·검증 탈락·신호 없음 모두 이 문장으로 안전하게 수렴한다. */
export function buildFallbackNarrative(payload: DailyBriefingPayload): string {
  if (payload.attention.length === 0) {
    const todayPart =
      payload.today.classSessions != null ? ` 오늘 수업 일정은 ${payload.today.classSessions}건입니다.` : "";
    return `어제 마감 기준 조치할 운영 신호가 없습니다.${todayPart}`;
  }
  const first = payload.attention[0];
  const firstPart = first.count != null ? `${first.label} ${first.count}건` : first.label;
  const rest = payload.attention.length - 1;
  const restPart = rest > 0 ? ` 그 외 확인할 신호가 ${rest}종 있습니다.` : "";
  const todayPart =
    payload.today.classSessions != null ? ` 오늘 수업 일정은 ${payload.today.classSessions}건입니다.` : "";
  return `가장 먼저 ${firstPart}을(를) 확인해 주세요.${restPart}${todayPart}`;
}
