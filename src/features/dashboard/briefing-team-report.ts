/**
 * "학원 매니저 팀" 보고 — 일일 브리핑의 LLM 출력 v2 (2026-07-16 원장 방향: aywa = 학원 매니저 팀).
 * 순수 함수만(서버·DB 무관, Vitest). 숫자·학생명·권장조치의 진실은 payload(결정론)이고,
 * LLM은 영역 매니저가 원장에게 보고하듯 "판단 + 오늘 할 일"을 서술한다.
 * 검증 탈락·생성 실패 시 buildFallbackTeamReport(결정론)로 안전하게 수렴한다.
 */
import type { DailyBriefingPayload } from "./briefing-digest";
import { digestFactLines, narrativeNumberWhitelist, narrativeWordWhitelist } from "./briefing-digest";
import { actionCountLabel, subjectBreakdownText } from "./today-actions";

/** 보고 영역(매니저) — LLM 출력 area는 반드시 이 중 하나(검증). */
export const TEAM_AREAS = ["수업", "학생", "상담", "수납", "운영"] as const;
export type TeamArea = (typeof TEAM_AREAS)[number];

export type TeamReport = {
  /** 한 줄 헤드라인 — 오늘 가장 먼저 볼 것(벨 알림 본문으로도 사용). */
  headline: string;
  managers: { area: TeamArea; report: string }[];
};

export function buildTeamPrompt(payload: DailyBriefingPayload): string {
  const spotlightLines = payload.spotlights.map((s) => {
    // 과목 분해가 있으면 이름 뒤 대괄호로("[수학 6 · 영어 2]") — 매니저가 "어느 과목부터"를 짚는 근거다.
    // 옛 payload엔 bySubject가 없다(?? []). 라벨·수치 모두 화이트리스트에 이미 들어 있어 인용해도 안 걸린다.
    const subjects = subjectBreakdownText(s.bySubject ?? []);
    // 🔴 `reasons`엔 애초에 **숫자만** 담겨 있다(사유 원문은 payload의 reasonText로 갈라 뒀다) —
    //    여기서 문자열을 되파싱해 걸러내는 방식은 한 글자만 달라져도 새므로 쓰지 않는다.
    return `- ${s.name}${subjects ? ` [${subjects}]` : ""}: ${s.reasons.join(", ")}${
      s.action ? ` → 권장 조치: ${s.action}` : ""
    }`;
  });
  return [
    "당신은 학원 원장을 보좌하는 매니저 팀(수업·학생·상담·수납·운영)입니다. 아래 결정론 수치 요약과 위험 학생 명단만 근거로, 각 영역 매니저가 아침 회의에서 원장에게 보고하듯 JSON으로만 답하세요.",
    "",
    "규칙(반드시 준수):",
    "- 각 매니저 보고는 1~3문장 한국어 존댓말. 사실 나열이 아니라 **판단**(왜 중요한지)과 **오늘 할 일 1가지 제안**을 담을 것.",
    "- 괄호·대괄호 안 과목별 수치가 있으면 **어느 과목이 문제인지 짚고** 그 과목부터 처리하도록 제안할 것.",
    "- '사전 통보 N'은 학부모가 미리 알린 결석이다. 그 수가 결석 회수와 같거나 대부분이면 위험 신호로 다루지 말 것.",
    "- 아래 요약·명단에 있는 숫자만 그대로 사용. 새 숫자·비율·합산·추정 금지.",
    spotlightLines.length > 0
      ? "- 학생 이름은 아래 위험 학생 명단에 있는 이름만 언급 가능. 명단 밖 이름 창작 금지."
      : "- 학생·직원 개인 이름을 언급하지 말 것(창작 금지).",
    "- 보고할 내용이 없는 영역은 생략(빈 보고 금지). 요약에 없는 영어 단어·코드·키 이름 금지(요약에 있는 이름은 그대로 써도 됨).",
    // ⚠️ 영역 중복은 실제로 나던 탈락 사유다(같은 영역을 2번 써서 managers가 6개 → 개수 검증 실패).
    `- area는 ${TEAM_AREAS.join("·")} 중 하나이며, **각 영역은 최대 한 번만** 등장(최대 ${TEAM_AREAS.length}개).`,
    "- 전체 응답은 900자 이내로 끝낼 것(길면 잘려서 폐기된다).",
    `- 출력 형식: {"headline": "오늘 가장 먼저 볼 것 한 줄", "managers": [{"area": "학생", "report": "..."}]}`,
    "",
    `[${payload.date} 아침 기준 운영 요약]`,
    ...digestFactLines(payload),
    ...(spotlightLines.length > 0
      ? ["", "[위험 학생 (대괄호=과목별 건수. 과목·사유·권장 조치 모두 시스템 산출)]", ...spotlightLines]
      : []),
  ].join("\n");
}

const REPORT_MAX = 400;

/**
 * 팀 보고 후검증 — 영역·숫자 grounding·명단 밖 인명 차단은 프롬프트+렌더 분리로 보완.
 *
 * 가드는 "환각을 막는 것"이지 "형식 실수로 하루치 보고를 버리는 것"이 아니다. 그래서:
 * - **영역 중복은 병합**(같은 영역 2줄 → 한 줄). 예전엔 즉시 탈락이라 실제로 폴백이 떴다.
 * - **영문은 payload에 있는 단어만 허용**(narrativeWordWhitelist) — 근거 없는 영문은 그대로 차단.
 */
export function validateTeamReport(
  report: unknown,
  payload: DailyBriefingPayload,
): { ok: true; value: TeamReport } | { ok: false; reason: string } {
  if (!report || typeof report !== "object") return { ok: false, reason: "형식 아님" };
  const r = report as { headline?: unknown; managers?: unknown };
  const headline = typeof r.headline === "string" ? r.headline.trim() : "";
  if (headline.length < 5 || headline.length > 120) return { ok: false, reason: "헤드라인 길이" };
  if (!Array.isArray(r.managers) || r.managers.length === 0) {
    return { ok: false, reason: "매니저 보고 개수" };
  }
  const allowed = narrativeNumberWhitelist(payload);
  const allowedWords = narrativeWordWhitelist(payload);
  /** payload에 없는 영문 토큰이 있으면 그 토큰을 돌려준다(환각 코드·키 이름 차단). */
  const ungroundedWord = (text: string): string | null =>
    (text.match(/[A-Za-z]{3,}/g) ?? []).find((token) => !allowedWords.has(token.toLowerCase())) ?? null;
  const ungroundedNumber = (text: string): string | null =>
    (text.match(/\d+/g) ?? []).find((token) => !allowed.has(String(Number(token))) && !allowed.has(token)) ?? null;

  const headlineWord = ungroundedWord(headline);
  if (headlineWord) return { ok: false, reason: `근거 없는 영문 ${headlineWord}` };
  const headlineNumber = ungroundedNumber(headline);
  if (headlineNumber) return { ok: false, reason: `근거 없는 숫자 ${headlineNumber}` };

  // 영역별로 모아서 병합 — 순서는 첫 등장 순서를 유지한다.
  const textsByArea = new Map<TeamArea, string[]>();
  for (const entry of r.managers) {
    const m = entry as { area?: unknown; report?: unknown };
    const area = typeof m.area === "string" ? m.area.trim() : "";
    const text = typeof m.report === "string" ? m.report.trim() : "";
    if (!(TEAM_AREAS as readonly string[]).includes(area)) {
      return { ok: false, reason: `알 수 없는 영역 ${area || "(없음)"}` };
    }
    if (text.length < 10 || text.length > REPORT_MAX) return { ok: false, reason: `${area} 보고 길이` };
    const word = ungroundedWord(text);
    if (word) return { ok: false, reason: `근거 없는 영문 ${word}` };
    const number = ungroundedNumber(text);
    if (number) return { ok: false, reason: `근거 없는 숫자 ${number}` };
    textsByArea.set(area as TeamArea, [...(textsByArea.get(area as TeamArea) ?? []), text]);
  }
  const managers: TeamReport["managers"] = [...textsByArea].map(([area, texts]) => {
    const merged = texts.join(" ");
    // 병합본이 한도를 넘으면 첫 보고만 — 모델이 지어낸 게 아니라 형식만 어긋난 것이므로 버리지 않는다.
    return { area, report: merged.length <= REPORT_MAX ? merged : texts[0]! };
  });
  return { ok: true, value: { headline, managers } };
}

/**
 * 신호(menuKey) → 매니저 영역. 폴백 보고의 묶음 축(옛 브리핑 카드 '바로 가기' 칩 `briefing-links.ts`는 2026-11-10 화면과 함께 삭제).
 */
export const AREA_BY_MENU: Readonly<Record<string, TeamArea>> = {
  attendance: "수업",
  lesson_reports: "수업",
  timetable: "수업",
  classes: "수업",
  students: "학생",
  // 신규생 관리 — 학생 기록이 아니라 **들어온 뒤 챙기는 절차**라 학생 영역에 둔다(상담·수납과 축이 다르다).
  newcomers: "학생",
  consultations: "상담",
  enrollment: "상담",
  meetings: "상담",
  billing: "수납",
  staff: "운영",
  owner: "운영",
};

/** LLM 실패·검증 탈락 시 결정론 팀 보고 — 신호를 영역별로 묶어 같은 카드 구조로 렌더. */
export function buildFallbackTeamReport(payload: DailyBriefingPayload): TeamReport {
  const byArea = new Map<TeamArea, string[]>();
  const put = (area: TeamArea, line: string) => {
    byArea.set(area, [...(byArea.get(area) ?? []), line]);
  };
  for (const item of payload.attention) {
    const area = AREA_BY_MENU[item.menuKey] ?? "운영";
    // 단위는 신호가 들고 온 것(명/개 반/건), 범위·내역(note)은 괄호로 함께 — 예전엔 둘 다 버려서
    // "지출 결재 대기 13건"(실은 최근 7일분)·"makeedu 동기화 이상"(어느 도메인인지 없음)이 됐다.
    // 과목 분해가 있으면 그게 가장 행동에 가까운 정보다("영어 147 · 수학 39" = 영어부터 손대라).
    const parts = [subjectBreakdownText(item.bySubject), item.note].filter(Boolean).join(", ");
    put(area, `${actionCountLabel(item)}${parts ? `(${parts})` : ""}`);
  }
  if (payload.spotlights.length > 0) {
    put("학생", `살펴볼 학생 ${payload.spotlights.length}명: ${payload.spotlights.map((s) => s.name).join("·")}`);
  }
  const followUpTotal = payload.followUps.overdue + payload.followUps.dueSoon;
  if (followUpTotal > 0) {
    put("상담", `후속조치 기한 지남 ${payload.followUps.overdue}건 · 오늘·임박 ${payload.followUps.dueSoon}건`);
  }
  if (payload.today.pendingLeaveApprovals > 0) put("운영", `휴가 승인 대기 ${payload.today.pendingLeaveApprovals}건`);
  // 조회 실패로 빠진 영역은 "없음"이 아니라 "확인 못 함"이다 — 요약에도 남긴다.
  if (payload.sourceIssueLabels.length > 0) {
    put("운영", `${payload.sourceIssueLabels.join("·")}는 확인하지 못했습니다`);
  }

  const managers = [...byArea.entries()].map(([area, lines]) => ({
    area,
    report: `${lines.join(" · ")} 확인해 주세요.`,
  }));
  const first = payload.attention[0];
  const headline =
    managers.length === 0
      ? "어제 마감 기준 조치할 운영 신호가 없습니다."
      : first
        ? `${actionCountLabel(first)}부터 확인해 주세요.`
        : "오늘 확인할 운영 신호가 있습니다.";
  return { headline, managers };
}
