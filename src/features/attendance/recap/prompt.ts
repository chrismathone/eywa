/**
 * 어제 출결 요약의 **AI 정리**(선택) — 프롬프트 조립 + 후검증 가드. 순수 함수(Vitest).
 *
 * 원장 2026-08-19: *"팩트만을 가지고 요약해서 정리할 수 있는 요약탭"* + *"필요하면 deepseek api 사용해서 정리할것"*.
 *
 * 🔴 **숫자·명단의 진실은 언제나 `digest.ts`(결정론)** 다. 여기서 LLM이 하는 일은 그 사실을 원장이 읽는
 *    순서로 **다시 배열하는 것**뿐이고, 화면은 AI 문장 아래에 결정론 표를 그대로 붙여 둔다.
 *    그래서 AI가 실패해도(키 없음·검증 탈락) 요약 탭은 손실 없이 그대로 쓴다.
 * 🔑 후검증은 일일 브리핑(`briefing-team-report.ts`)과 같은 규약이다 — **근거 없는 숫자·영문 토큰이
 *    한 개라도 있으면 통째로 폐기**한다. 요약이 하나 없는 것보다 틀린 숫자 하나가 훨씬 비싸다.
 */

import { RECAP_STATUS_LABEL, slotsLabel, type DayRecap, type RecapEvent } from "./digest";

/** 명단을 프롬프트에 실을 때의 상한 — 넘으면 "외 N명"으로 **총계를 함께** 밝힌다(#89). */
const LIST_CAP = 12;

export type RecapBrief = {
  /** 한 줄 헤드라인 — 관리자가 가장 먼저 볼 것. */
  headline: string;
  /** 항목 2~5개(각 한 문장). */
  points: string[];
};

type LabelOf = (subjectKey: string) => string;

function eventLine(e: RecapEvent, subjectLabel: LabelOf): string {
  const bits = [
    `${e.studentName}(${e.schoolGrade ?? "학년 미상"})`,
    `${e.className}[${subjectLabel(e.subject) || "과목 없음"}] ${slotsLabel(e.slots)}`,
    RECAP_STATUS_LABEL[e.status],
    `담당 ${e.teacherName}`,
  ];
  if (e.recentAbsences && e.recentAbsences >= 2) bits.push(`최근 14일 결석 ${e.recentAbsences}회`);
  if (e.note) bits.push(`사유메모 "${e.note}"`);
  bits.push(e.settled ? "데스크 조치 완료" : "조치 미완료");
  return `- ${bits.join(" · ")}`;
}

/**
 * 결정론 사실 줄 — 프롬프트 재료이자 **숫자 화이트리스트의 출처**.
 * ⚠️ 여기 없는 숫자는 검증에서 전부 탈락하므로, 새 사실을 프롬프트에 넣으려면 반드시 이 함수를 거칠 것.
 */
export function recapFactLines(recap: DayRecap, subjectLabel: LabelOf = (k) => k): string[] {
  const t = recap.totals;
  const lines: string[] = [
    `- 수업: ${t.classes}개 반 ${t.slots}교시`,
    `- 출결 입력: ${t.cells}칸 중 ${t.recorded}칸${t.inputRate != null ? ` (${t.inputRate}%)` : ""}`,
    `- 출석 ${t.present}건 · 결석 ${t.absent}건 · 공결 ${t.excused}건 · 지각 ${t.late}건 · 조퇴 ${t.earlyLeave}건 · 보강 ${t.makeup}건 (건 = 학생 1명이 한 반에서 그 상태였던 하루)`,
    `- 출석부가 통째로 비어 있는 반: ${t.unmarkedClasses}개 (학생 ${t.unmarkedStudents}명)`,
    `- 조치가 끝나지 않은 결석·공결: ${t.absentPending}건`,
  ];

  if (recap.absences.length > 0) {
    lines.push(`[결석·공결 ${recap.absences.length}건${recap.absences.length > LIST_CAP ? ` 중 앞 ${LIST_CAP}건` : ""}]`);
    lines.push(...recap.absences.slice(0, LIST_CAP).map((e) => eventLine(e, subjectLabel)));
  }
  if (recap.others.length > 0) {
    lines.push(`[지각·조퇴·보강 ${recap.others.length}건${recap.others.length > LIST_CAP ? ` 중 앞 ${LIST_CAP}건` : ""}]`);
    lines.push(...recap.others.slice(0, LIST_CAP).map((e) => eventLine(e, subjectLabel)));
  }
  if (recap.unmarked.length > 0) {
    lines.push(`[출석부 미입력 반 ${recap.unmarked.length}개${recap.unmarked.length > LIST_CAP ? ` 중 앞 ${LIST_CAP}개` : ""}]`);
    lines.push(
      ...recap.unmarked
        .slice(0, LIST_CAP)
        .map(
          (c) =>
            `- ${c.className}[${subjectLabel(c.subject) || "과목 없음"}] ${slotsLabel(c.slots)} · 담당 ${c.teacherName} · 학생 ${c.expected}명`,
        ),
    );
  }
  const behind = recap.teachers.filter((t2) => t2.cells > 0 && t2.recorded < t2.cells).slice(0, LIST_CAP);
  if (behind.length > 0) {
    lines.push("[강사별 입력]");
    lines.push(
      ...behind.map((t2) => `- ${t2.teacherName}: ${t2.cells}칸 중 ${t2.recorded}칸 입력 · 미입력 반 ${t2.unmarkedClasses}개`),
    );
  }
  return lines;
}

export function buildRecapPrompt(recap: DayRecap, subjectLabel: LabelOf = (k) => k): string {
  return [
    "당신은 학원 원장·데스크를 보좌하는 운영 매니저입니다. 아래는 어제 하루 출결의 **결정론 집계 결과**입니다.",
    "이 자료에 적힌 사실만 근거로, 관리자가 오늘 아침에 30초 안에 읽을 요약을 JSON으로만 답하세요.",
    "",
    "규칙(반드시 준수):",
    "- 한국어 존댓말. headline은 한 줄(60자 이내), points는 2~5개이며 각 1~2문장.",
    "- **자료에 있는 숫자만 그대로 사용**. 새 숫자·비율·합산·평균·추정 금지(자료에 없는 숫자는 폐기 사유).",
    "- 학생·강사 이름은 **자료에 등장한 이름만** 언급. 명단 밖 이름 창작 금지.",
    "- 자료에 없는 영어 단어·코드·키 이름 금지.",
    "- 사실 나열로 끝내지 말고 **먼저 처리할 것**(조치 미완료 결석, 반복 결석, 미입력 출석부)을 앞에 둘 것.",
    "- 원인·심경·학생 사정을 추측하지 말 것. 사유메모가 있으면 그 문구를 근거로만 쓸 것.",
    "- 특이사항이 없으면 그 사실을 그대로 쓸 것(없는 문제를 만들지 말 것).",
    `- 출력 형식: {"headline": "...", "points": ["...", "..."]}`,
    "",
    `[${recap.date} 출결 집계]`,
    ...recapFactLines(recap, subjectLabel),
  ].join("\n");
}

/** 자료에 등장한 숫자 — 검증 화이트리스트(날짜의 연·월·일도 포함된다). */
export function recapNumberWhitelist(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    for (const token of line.match(/\d+/g) ?? []) {
      out.add(token);
      out.add(String(Number(token)));
    }
  }
  return out;
}

/** 자료에 등장한 영문 토큰(소문자) — 그 밖의 영문은 환각으로 본다. */
export function recapWordWhitelist(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    for (const token of line.match(/[A-Za-z]{2,}/g) ?? []) out.add(token.toLowerCase());
  }
  return out;
}

const HEADLINE_MAX = 120;
const POINT_MAX = 260;

/**
 * 후검증 — 통과분만 저장한다. 실패 사유는 한글로 돌려 화면이 "요약만 실패"를 정직하게 표시한다.
 * ⚠️ 가드를 느슨하게 고치지 말 것: 여기서 막는 것은 문장 품질이 아니라 **없는 숫자·없는 이름**이다.
 */
export function validateRecapBrief(
  value: unknown,
  recap: DayRecap,
  subjectLabel: LabelOf = (k) => k,
): { ok: true; value: RecapBrief } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "형식 아님" };
  const v = value as { headline?: unknown; points?: unknown };
  const headline = typeof v.headline === "string" ? v.headline.trim() : "";
  if (headline.length < 5 || headline.length > HEADLINE_MAX) return { ok: false, reason: "헤드라인 길이" };
  const rawPoints = Array.isArray(v.points) ? v.points : [];
  const points = rawPoints.map((p) => (typeof p === "string" ? p.trim() : "")).filter((p) => p.length > 0);
  if (points.length === 0 || points.length > 6) return { ok: false, reason: "항목 개수" };
  if (points.some((p) => p.length < 5 || p.length > POINT_MAX)) return { ok: false, reason: "항목 길이" };

  const lines = [recap.date, ...recapFactLines(recap, subjectLabel)];
  const numbers = recapNumberWhitelist(lines);
  const words = recapWordWhitelist(lines);
  for (const text of [headline, ...points]) {
    const badWord = (text.match(/[A-Za-z]{2,}/g) ?? []).find((t) => !words.has(t.toLowerCase()));
    if (badWord) return { ok: false, reason: `근거 없는 영문 ${badWord}` };
    const badNumber = (text.match(/\d+/g) ?? []).find((t) => !numbers.has(t) && !numbers.has(String(Number(t))));
    if (badNumber) return { ok: false, reason: `근거 없는 숫자 ${badNumber}` };
  }
  return { ok: true, value: { headline, points } };
}
