/**
 * 일일 브리핑 다이제스트 — 순수 함수만(서버·DB 무관, Vitest).
 *
 * 설계 원칙: 숫자·명단의 유일한 진실은 payload(결정론 신호)이고, LLM(narrative)은 서술만 담당한다.
 * - 아침(07:00 KST) 생성이라 "오늘" 신호는 구조적으로 0 → 다이제스트는 **어제 마감 + 오늘 예정**으로 조립.
 * - LLM 프롬프트에는 개인 이름을 넣지 않고(라벨+수치만), 응답은 validateNarrative(숫자 grounding·
 *   영문 토큰 금지·길이)를 통과한 것만 저장 — 실패 시 buildFallbackNarrative(결정론 요약)로 대체.
 */
import { absenceReasonTail, unexplainedAbsences, type AbsenceReasonSummary } from "./absence-reasons";
import {
  buildTodayActions,
  labelSubjectCounts,
  subjectBreakdownText,
  type SubjectLabelResolver,
  type TodayActionItem,
  type TodayActionsRaw,
} from "./today-actions";

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
   *
   * `bySubject` = **그 사유가 관측된 과목**(원장 2026-08-29 "운영실 보고시에 과목별 표기되도록 과목 라벨").
   * ⚠️ 옛 payload(2026-08-29 이전 저장분)엔 이 키가 없다 — 읽는 쪽은 항상 `?? []`로 받을 것.
   */
  spotlights: {
    studentId: string | null;
    name: string;
    reasons: string[];
    action: string | null;
    bySubject: { label: string; count: number }[];
    /**
     * 사전 통보(양해된) 결석 건수 — 매니저 보고가 "위험 신호인가"를 가르는 재료.
     * ⚠️ 옛 payload엔 없다(`?? 0`). 사유 **원문**은 payload에 싣지 않는다(AI 전송 규약).
     */
    preNotified?: number;
    /**
     * 사유 요약 문자열(`가족여행·병결`) — **화면 전용**.
     * 🔴 프롬프트를 만드는 `buildTeamPrompt`는 이 필드를 읽지 않는다(읽으면 자유 텍스트가 외부로 나간다).
     */
    reasonText?: string;
  }[];
  /** 조회 실패 도메인(확인 불가 정직성) — 라벨만 */
  sourceIssueLabels: string[];
};

/**
 * "오늘" 문구로 수집된 어제 기준 신호의 표시 리라벨(신호 key 고정 규칙).
 * ⚠️ absent는 "결석"이다 — 공결 폐지 후 사전 통보 결석까지 전부 absent라 "무단결석"은 과장이다
 * (2026-07-31 교정, today-actions `absentToday` 주석 참조). 되돌리지 말 것.
 */
const YESTERDAY_RELABEL: Readonly<Record<string, string>> = {
  absent: "어제 결석",
  "unwritten-reports": "어제 미작성 보고서",
};

export type BuildDailyBriefingInput = {
  date: string;
  /** asOf=어제(nowMinutes=1440)로 수집 — absent·미작성이 '어제' 의미가 된다 */
  yesterdayRaw: TodayActionsRaw;
  /** 지금(실제 오늘) 수집 — 어제 미기록 반·오늘 휴가·승인 대기만 소비 */
  todayRaw: TodayActionsRaw;
  followUps: { overdue: number; dueSoon: number };
  /**
   * 반복 결석 위험 학생. `bySubject`(과목 키 단위 raw 집계)는 서버가 붙인다 —
   * 합은 반드시 `absences`와 같다(같은 세는 규칙, absence-subjects.ts). 없으면 과목 표기를 생략한다.
   */
  absenceRisks: {
    studentId?: string | null;
    studentName: string;
    absences: number;
    bySubject?: { subject: string; count: number }[];
    /**
     * 사유 요약 + 사전 통보 건수. 🔴 `absences`는 **깎지 않는다**(원장 2026-08-29 선택) — 그 숫자는
     * RPC의 사실이고 결석 마일스톤 알림도 같은 값을 쓴다. 대신 옆에 갈라 보여 준다.
     */
    reasonSummary?: AbsenceReasonSummary;
  }[];
  retention: { total: number; risk: number; warn: number; revenueRisk: number } | null;
  /** retention 상위 위험 학생(위험도 내림차순, 사유·권장 조치 포함) — 서버가 roster에서 추출. */
  retentionTop: { studentId: string; name: string; reasons: string[]; action: string | null }[];
  todayClassSessions: number | null;
  /** 조회에 실패해 이번 브리핑에서 빠진 영역 라벨(예: 재등록 이탈 신호) — "0"으로 위장하지 않기 위함. */
  missingDomainLabels?: string[];
  /**
   * 과목 키 → 학원설정 라벨. 없으면 과목 분해를 통째로 생략한다(raw 키 노출 금지).
   * ⚠️ 여기에 하드코딩 맵을 넣지 말 것 — 서버가 `buildSubjectMaps(getTenantSettings…)`로 만들어 주입한다.
   */
  subjectLabel?: SubjectLabelResolver;
};

const SPOTLIGHT_MAX = 6;

/**
 * 분해 합이 "N회"와 다르면 **분해를 통째로 버린다**.
 *
 * 총계(RPC)와 분해(별도 조회)는 창 기준일을 각각 계산하므로, 두 조회 사이에 더 나중 날짜의 출결이
 * 들어오면 창이 하루 어긋나 합이 갈릴 수 있다(아침 cron에선 사실상 없지만 0은 아니다). 그때 나란히
 * 놓인 "8회"와 "수학 6 · 영어 1"은 둘 중 하나가 거짓인데 화면만 봐선 알 수 없다 — 비우는 쪽이 낫다.
 */
function groundedSubjects(risk: BuildDailyBriefingInput["absenceRisks"][number]): { subject: string; count: number }[] {
  const buckets = risk.bySubject ?? [];
  if (buckets.length === 0) return [];
  const sum = buckets.reduce((total, bucket) => total + bucket.count, 0);
  return sum === risk.absences ? buckets : [];
}

/**
 * retention 상위 + 반복 결석 병합(이름 중복 제거) — 결석만 걸린 학생은 결석 사유로 추가.
 *
 * ■ 과목 표기(원장 2026-08-29)는 **사유가 관측된 과목**만 붙인다. 두 재료의 사정이 다르다:
 *   · **반복 결석** = 어느 반에서 빠졌는지가 행에 그대로 있다 → 과목별 건수를 정확히 쪼갤 수 있고
 *     합이 "N회"와 일치한다(absence-subjects.ts). 실데이터(injaewon 2026-08-29, 위험 12명)에서
 *     **9명이 영어·수학 양쪽에 결석이 걸려 있다**("수학 6 · 영어 2" 하은결) — 그래서 한 과목만 고르면
 *     나머지가 사라진다. 전부, 건수와 함께 보여준다(원장이 "어느 과목부터"를 고를 수 있게).
 *   · **retention 위험**은 성적·숙제·상담공백·학부모 신호가 뒤섞인 점수라 **어느 과목의 문제인지
 *     데이터가 말해주지 않는다**(risk.ts는 과목 축을 아예 갖고 있지 않다). 수강 과목을 대신 붙이면
 *     같은 자리에 "문제 난 과목"과 "그냥 듣는 과목"이 섞여 거짓말이 된다 → **비운다**.
 *     (실사용 영향 0: injaewon은 retention 메뉴가 꺼져 있어 스포트라이트가 전부 결석 재료다.)
 */
function buildSpotlights(input: BuildDailyBriefingInput): DailyBriefingPayload["spotlights"] {
  const spotlights: DailyBriefingPayload["spotlights"] = input.retentionTop.slice(0, SPOTLIGHT_MAX).map((s) => ({
    studentId: s.studentId,
    name: s.name,
    reasons: s.reasons,
    action: s.action,
    bySubject: [],
  }));
  const seen = new Set(spotlights.map((s) => s.name));
  for (const risk of input.absenceRisks) {
    if (spotlights.length >= SPOTLIGHT_MAX) break;
    if (seen.has(risk.studentName)) continue;
    // 🔴 사전 통보로 **전부** 설명되는 결석은 목록에 올리지 않는다(원장 2026-08-29 후속
    //    *"결석과 사전통보가 똑같은데 의미 없음"*). 판정은 `unexplainedAbsences` 단일 소스이고,
    //    **표시되는 "N회"는 그대로**다(RPC 값·마일스톤 알림과 갈리지 않게).
    if (unexplainedAbsences(risk.absences, risk.reasonSummary) === 0) continue;
    seen.add(risk.studentName);
    spotlights.push({
      studentId: risk.studentId ?? null,
      name: risk.studentName,
      // 🔴 `reasons`엔 **숫자만** 담는다 — 이 배열은 AI 프롬프트로 그대로 나간다. 사유 원문은
      //    자유 텍스트라 `병결(입원)` 같은 건강 정보가 섞여 있어 아래 reasonText로 갈라 둔다.
      reasons: [`최근 14일 결석 ${risk.absences}회${absenceReasonTail(risk.reasonSummary, { forPrompt: true })}`],
      action: null,
      // 라벨은 학원설정 단일 소스 — 리졸버가 없으면 분해를 통째로 생략한다(raw 키 노출 금지).
      bySubject: labelSubjectCounts(groundedSubjects(risk), input.subjectLabel),
      // 🔴 사유 원문은 안 싣는다 — payload는 AI 프롬프트로도 나가고, 사유엔 `병결(입원)` 같은
      //    건강 정보가 자유 텍스트로 들어 있다. 판단에 필요한 건 "양해된 결석인가"뿐이다.
      preNotified: risk.reasonSummary?.preNotified ?? 0,
      // 화면 전용 — 위 reasons와 달리 프롬프트에 나가지 않는다(파일 주석 참조).
      // 값이 없으면 **키 자체를 안 넣는다**(payload는 jsonb로 저장돼 undefined 키가 노이즈가 된다).
      ...(risk.reasonSummary?.reasons.length ? { reasonText: risk.reasonSummary.reasons.join("·") } : {}),
    });
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
  const attention = buildTodayActions(merged, { subjectLabel: input.subjectLabel }).map((item) =>
    YESTERDAY_RELABEL[item.key] ? { ...item, label: YESTERDAY_RELABEL[item.key] } : item,
  );
  const issueLabels = [
    ...(input.yesterdayRaw.sourceIssues ?? []),
    ...(input.todayRaw.sourceIssues ?? []),
  ]
    .map((issue) => issue.label.replace(/^오늘 /, ""))
    // 신호 수집 밖에서 실패한 영역(retention 등)도 같은 "확인 불가" 줄로 — 조용히 빠지면 원장은 '0'으로 읽는다.
    .concat(input.missingDomainLabels ?? []);
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
  for (const item of payload.attention) {
    add(item.count);
    // note에 실린 수치("최근 7일 13건", "발송 실패 8")도 프롬프트가 보는 근거다 — 화이트리스트에 포함.
    for (const token of (item.note ?? "").match(/\d+/g) ?? []) numbers.add(String(Number(token)));
    // 과목별 분해 수치도 프롬프트에 나가므로 인용 허용("영어 147"). 빠뜨리면 정상 보고가 탈락한다.
    for (const bucket of item.bySubject) add(bucket.count);
  }
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
    // 과목 분해 수치("수학 6 · 영어 2")도 프롬프트에 나간다 — 빠뜨리면 정상 보고가 탈락한다.
    for (const bucket of spotlight.bySubject ?? []) add(bucket.count);
    // 사전 통보 건수도 프롬프트에 나간다(사유 원문은 안 나간다 — absence-reasons.ts 주석).
    if (spotlight.preNotified !== undefined) add(spotlight.preNotified);
  }
  return numbers;
}

/**
 * 프롬프트가 인용해도 되는 **영문 토큰** 화이트리스트(소문자).
 *
 * 팀 보고 검증은 영문 3자 이상을 막는다(코드·키 이름 환각 차단). 그런데 신호 라벨 자체에 영문이
 * 들어가는 경우가 있다(`makeedu 동기화 이상`) — 그러면 프롬프트가 사실로 준 단어를 그대로 보고한
 * 정상 응답이 통째로 탈락한다(2026-07-31 실측: makeedu 신호가 뜬 날 = 검증 탈락일). 숫자 grounding과
 * 같은 원리로, **payload에 실제로 있는 영문만** 허용한다(없는 영문 = 여전히 차단).
 */
export function narrativeWordWhitelist(payload: DailyBriefingPayload): Set<string> {
  const words = new Set<string>();
  const harvest = (text: string | null | undefined) => {
    for (const token of (text ?? "").match(/[A-Za-z]{3,}/g) ?? []) words.add(token.toLowerCase());
  };
  for (const item of payload.attention) {
    harvest(item.label);
    harvest(item.note);
    harvest(item.detail);
    // 과목 라벨이 영문일 수 있다(학원이 "EIE" 같은 이름을 쓰면) — 사실로 준 이상 인용도 허용.
    for (const bucket of item.bySubject) harvest(bucket.label);
  }
  for (const spotlight of payload.spotlights) {
    harvest(spotlight.name);
    harvest(spotlight.action);
    for (const reason of spotlight.reasons) harvest(reason);
    // 과목 라벨이 영문일 수 있다(학원이 "EIE" 같은 이름을 쓰면) — 위 attention과 같은 이유로 인용 허용.
    for (const bucket of spotlight.bySubject ?? []) harvest(bucket.label);
  }
  for (const label of payload.sourceIssueLabels) harvest(label);
  return words;
}

/** 개인 이름 없이 라벨+수치+비개인 단서만 — 서술 재료. 프롬프트와 폴백 요약이 같은 사실 목록을 쓴다. */
export function digestFactLines(payload: DailyBriefingPayload): string[] {
  const lines: string[] = [];
  for (const item of payload.attention) {
    // 단위는 신호가 들고 온 것(명/개 반/건)을 쓴다 — 전부 "건"으로 찍어 30명을 30건으로 보고했었다.
    const count = item.count != null ? `${item.count}${item.unit ?? "건"}` : "상태 이상";
    // note(범위·내역)는 개인정보가 없어 프롬프트에 안전하다. 이걸 빼면 "지출 결재 대기 13건"처럼
    // 범위 없는 숫자만 남아 매니저가 잘못 판단한다. detail(이름 미리보기)은 여전히 넣지 않는다.
    // 과목 분해는 매니저가 "어느 과목부터"를 정하는 근거라 프롬프트에도 넣는다(개인정보 없음).
    const parts = [item.note, subjectBreakdownText(item.bySubject)].filter(Boolean).join(" / ");
    lines.push(`- ${item.label}: ${count}${parts ? ` (${parts})` : ""}`);
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
