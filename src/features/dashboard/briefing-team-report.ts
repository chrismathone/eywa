/**
 * "학원 매니저 팀" 보고 — 일일 브리핑의 LLM 출력 v2 (2026-07-16 원장 방향: eywa = 학원 매니저 팀).
 * 순수 함수만(서버·DB 무관, Vitest). 숫자·학생명·권장조치의 진실은 payload(결정론)이고,
 * LLM은 영역 매니저가 원장에게 보고하듯 "판단 + 오늘 할 일"을 서술한다.
 * 검증 탈락·생성 실패 시 buildFallbackTeamReport(결정론)로 안전하게 수렴한다.
 */
import type { DailyBriefingPayload } from "./briefing-digest";
import { digestFactLines, narrativeNumberWhitelist } from "./briefing-digest";

/** 보고 영역(매니저) — LLM 출력 area는 반드시 이 중 하나(검증). */
export const TEAM_AREAS = ["수업", "학생", "상담", "수납", "운영"] as const;
export type TeamArea = (typeof TEAM_AREAS)[number];

export type TeamReport = {
  /** 한 줄 헤드라인 — 오늘 가장 먼저 볼 것(벨 알림 본문으로도 사용). */
  headline: string;
  managers: { area: TeamArea; report: string }[];
};

export function buildTeamPrompt(payload: DailyBriefingPayload): string {
  const spotlightLines = payload.spotlights.map(
    (s) => `- ${s.name}: ${s.reasons.join(", ")}${s.action ? ` → 권장 조치: ${s.action}` : ""}`,
  );
  return [
    "당신은 학원 원장을 보좌하는 매니저 팀(수업·학생·상담·수납·운영)입니다. 아래 결정론 수치 요약과 위험 학생 명단만 근거로, 각 영역 매니저가 아침 회의에서 원장에게 보고하듯 JSON으로만 답하세요.",
    "",
    "규칙(반드시 준수):",
    "- 각 매니저 보고는 1~3문장 한국어 존댓말. 사실 나열이 아니라 **판단**(왜 중요한지)과 **오늘 할 일 1가지 제안**을 담을 것.",
    "- 아래 요약·명단에 있는 숫자만 그대로 사용. 새 숫자·비율·합산·추정 금지.",
    spotlightLines.length > 0
      ? "- 학생 이름은 아래 위험 학생 명단에 있는 이름만 언급 가능. 명단 밖 이름 창작 금지."
      : "- 학생·직원 개인 이름을 언급하지 말 것(창작 금지).",
    "- 보고할 내용이 없는 영역은 생략(빈 보고 금지). 영어 단어·코드·키 이름 금지.",
    `- area는 ${TEAM_AREAS.join("·")} 중 하나.`,
    `- 출력 형식: {"headline": "오늘 가장 먼저 볼 것 한 줄", "managers": [{"area": "학생", "report": "..."}]}`,
    "",
    `[${payload.date} 아침 기준 운영 요약]`,
    ...digestFactLines(payload),
    ...(spotlightLines.length > 0 ? ["", "[위험 학생 (사유·권장 조치는 시스템 산출)]", ...spotlightLines] : []),
  ].join("\n");
}

/** 팀 보고 후검증 — 영역·숫자 grounding·명단 밖 인명 차단은 프롬프트+렌더 분리로 보완. */
export function validateTeamReport(
  report: unknown,
  payload: DailyBriefingPayload,
): { ok: true; value: TeamReport } | { ok: false; reason: string } {
  if (!report || typeof report !== "object") return { ok: false, reason: "형식 아님" };
  const r = report as { headline?: unknown; managers?: unknown };
  const headline = typeof r.headline === "string" ? r.headline.trim() : "";
  if (headline.length < 5 || headline.length > 120) return { ok: false, reason: "헤드라인 길이" };
  if (!Array.isArray(r.managers) || r.managers.length === 0 || r.managers.length > TEAM_AREAS.length) {
    return { ok: false, reason: "매니저 보고 개수" };
  }
  const allowed = narrativeNumberWhitelist(payload);
  const managers: TeamReport["managers"] = [];
  const seenAreas = new Set<string>();
  for (const entry of r.managers) {
    const m = entry as { area?: unknown; report?: unknown };
    const area = typeof m.area === "string" ? m.area.trim() : "";
    const text = typeof m.report === "string" ? m.report.trim() : "";
    if (!(TEAM_AREAS as readonly string[]).includes(area)) return { ok: false, reason: `알 수 없는 영역 ${area || "(없음)"}` };
    if (seenAreas.has(area)) return { ok: false, reason: `영역 중복 ${area}` };
    seenAreas.add(area);
    if (text.length < 10 || text.length > 400) return { ok: false, reason: `${area} 보고 길이` };
    if (/[A-Za-z]{3,}/.test(text) || /[A-Za-z]{3,}/.test(headline)) return { ok: false, reason: "영문 토큰 포함" };
    for (const token of text.match(/\d+/g) ?? []) {
      const normalized = String(Number(token));
      if (!allowed.has(normalized) && !allowed.has(token)) return { ok: false, reason: `근거 없는 숫자 ${token}` };
    }
    managers.push({ area: area as TeamArea, report: text });
  }
  for (const token of headline.match(/\d+/g) ?? []) {
    const normalized = String(Number(token));
    if (!allowed.has(normalized) && !allowed.has(token)) return { ok: false, reason: `근거 없는 숫자 ${token}` };
  }
  return { ok: true, value: { headline, managers } };
}

/** LLM 실패·검증 탈락 시 결정론 팀 보고 — 신호를 영역별로 묶어 같은 카드 구조로 렌더. */
export function buildFallbackTeamReport(payload: DailyBriefingPayload): TeamReport {
  const byArea = new Map<TeamArea, string[]>();
  const put = (area: TeamArea, line: string) => {
    byArea.set(area, [...(byArea.get(area) ?? []), line]);
  };
  const AREA_BY_MENU: Record<string, TeamArea> = {
    attendance: "수업",
    lesson_reports: "수업",
    timetable: "수업",
    classes: "수업",
    students: "학생",
    consultations: "상담",
    enrollment: "상담",
    meetings: "상담",
    billing: "수납",
    staff: "운영",
    owner: "운영",
  };
  for (const item of payload.attention) {
    const area = AREA_BY_MENU[item.menuKey] ?? "운영";
    put(area, item.count != null ? `${item.label} ${item.count}건` : item.label);
  }
  if (payload.spotlights.length > 0) {
    put("학생", `살펴볼 학생 ${payload.spotlights.length}명: ${payload.spotlights.map((s) => s.name).join("·")}`);
  }
  const followUpTotal = payload.followUps.overdue + payload.followUps.dueSoon;
  if (followUpTotal > 0) {
    put("상담", `후속조치 기한 지남 ${payload.followUps.overdue}건 · 오늘·임박 ${payload.followUps.dueSoon}건`);
  }
  if (payload.today.pendingLeaveApprovals > 0) put("운영", `휴가 승인 대기 ${payload.today.pendingLeaveApprovals}건`);

  const managers = [...byArea.entries()].map(([area, lines]) => ({
    area,
    report: `${lines.join(" · ")} 확인해 주세요.`,
  }));
  const first = payload.attention[0];
  const headline =
    managers.length === 0
      ? "어제 마감 기준 조치할 운영 신호가 없습니다."
      : first
        ? `${first.label}${first.count != null ? ` ${first.count}건` : ""}부터 확인해 주세요.`
        : "오늘 확인할 운영 신호가 있습니다.";
  return { headline, managers };
}
