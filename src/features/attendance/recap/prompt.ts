/**
 * 출결 요약의 **AI 정리**(선택) — 프롬프트 조립 + 후검증 가드. 순수 함수(Vitest).
 *
 * 원장 2026-08-19: *"팩트만을 가지고 요약해서 정리할 수 있는 요약탭"* + AI 사용 승인 + *"내용도 금토 구분해서 정리하고"*.
 *
 * 🔴 **숫자·명단의 진실은 언제나 `digest.ts`(결정론)** 다. 여기서 LLM이 하는 일은 그 사실을 원장이 읽는
 *    순서로 **다시 배열하는 것**뿐이고, 화면은 AI 문장 아래에 결정론 표를 그대로 붙여 둔다.
 *    그래서 AI가 실패해도(키 없음·검증 탈락) 요약 탭은 손실 없이 그대로 쓴다.
 * 🔑 후검증은 일일 브리핑(`briefing-team-report.ts`)과 같은 규약이다 — **근거 없는 숫자·영문 토큰이
 *    한 개라도 있으면 통째로 폐기**한다. 요약이 하나 없는 것보다 틀린 숫자 하나가 훨씬 비싸다.
 * 🔴 범위가 여러 날이면 **날짜를 반드시 밝히게** 한다("언제 빠졌나"가 사라지면 전화할 때 할 말이 없다).
 */

import { formatKoreanDate } from "@/lib/date-kst";
import { ABSENCE_REASON_LABEL } from "@/features/attendance/absence-reason";
import { stripProxyMemo } from "@/features/attendance/proxy-memo";
import {
  handlersLabel,
  RECAP_STATUS_LABEL,
  REPEAT_ABSENCE_MIN,
  slotsLabel,
  type RecapEvent,
} from "./digest";
import type { RangeRecap, RecapDay } from "./range";

/** 명단을 프롬프트에 실을 때의 상한 — 넘으면 "앞 N건"으로 **총계를 함께** 밝힌다(#89). */
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
    `담당 ${handlersLabel(e.teacherNames) || "미지정"}`,
  ];
  if (e.recentAbsences && e.recentAbsences >= REPEAT_ABSENCE_MIN) {
    // 사전 통보가 섞여 있으면 함께 적는다 — "4회"만 보면 반복 결석 위험으로 읽히지만 그중 둘이
    // 여행이면 뜻이 다르다(화면의 칩과 같은 규약).
    bits.push(
      e.recentPlanned && e.recentPlanned > 0
        ? `최근 14일 결석 ${e.recentAbsences}회(사전 통보 ${e.recentPlanned}회)`
        : `최근 14일 결석 ${e.recentAbsences}회`,
    );
  }
  // `대신 입력` 줄은 사유가 아니다(빗금 칸 입력 메모, 원장 2026-09-14) — AI가 결석 사유로 읽지 않게 뺀다.
  const memo = stripProxyMemo(e.note);
  if (memo) bits.push(`사유메모 "${memo}"`);
  // 사유 분류 — 미리 알려진 결석과 연락이 안 된 결석을 문장에서 갈라 쓰게 하는 근거(2026-08-20).
  if (e.reasonKind !== "unknown") bits.push(`사유 분류 ${ABSENCE_REASON_LABEL[e.reasonKind]}`);
  bits.push(e.settled ? "데스크 조치 완료" : e.urgent ? "조치 미완료(긴급)" : "조치 미완료(사유 확인됨)");
  return `- ${bits.join(" · ")}`;
}

function capped<T>(list: readonly T[], label: string): { header: string; rows: readonly T[] } {
  return {
    header: `${label} ${list.length}건${list.length > LIST_CAP ? ` 중 앞 ${LIST_CAP}건` : ""}`,
    rows: list.slice(0, LIST_CAP),
  };
}

/**
 * 미조치 결석 한 줄 — **전체 · 긴급 · 사유 확인**을 함께 적는다.
 * ⚠️ `absentPending`의 뜻은 종전 그대로(미조치 전체)다. 새 숫자를 프롬프트·화면에 넣을 땐 반드시 이
 *    `recapFactLines` 경유여야 후검증 화이트리스트가 함께 따라온다([[#89]]).
 */
function pendingLine(t: RangeRecap["totals"]): string {
  const head = `- 조치가 끝나지 않은 결석·공결 ${t.absentPending}건`;
  if (t.absentPending === 0) return head;
  return `${head} (연락이 안 된 긴급 ${t.absentUrgent}건 · 사유가 확인된 건 ${t.absentNotified}건)`;
}

function dayLines(day: RecapDay, subjectLabel: LabelOf): string[] {
  const t = day.totals;
  const lines = [`[${formatKoreanDate(day.date)}]`];
  if (day.holiday) {
    lines.push(`- 휴원일(${day.holiday}) — 수업 없음`);
    return lines;
  }
  if (t.slots === 0) {
    lines.push("- 수업 없음");
    return lines;
  }
  lines.push(
    `- 수업 ${t.classes}개 반 ${t.slots}교시 · 출결 입력 ${t.cells}칸 중 ${t.recorded}칸${t.inputRate != null ? ` (${t.inputRate}%)` : ""}`,
    `- 출석 ${t.present}건 · 결석 ${t.absent}건 · 공결 ${t.excused}건 · 지각 ${t.late}건 · 조퇴 ${t.earlyLeave}건 · 보강 ${t.makeup}건`,
  );
  if (day.absences.length > 0) {
    const { header, rows } = capped(day.absences, "결석·공결");
    lines.push(header, ...rows.map((e) => eventLine(e, subjectLabel)));
  }
  if (day.others.length > 0) {
    const { header, rows } = capped(day.others, "지각·조퇴·보강");
    lines.push(header, ...rows.map((e) => eventLine(e, subjectLabel)));
  }
  if (day.unmarked.length > 0) {
    const { header, rows } = capped(day.unmarked, "출석부 미입력 반");
    lines.push(
      header,
      ...rows.map(
        (c) =>
          `- ${c.className}[${subjectLabel(c.subject) || "과목 없음"}] ${slotsLabel(c.slots)} · 담당 ${handlersLabel(c.teacherNames) || "미지정"} · 학생 ${c.expected}명`,
      ),
    );
  }
  return lines;
}

/**
 * 결정론 사실 줄 — 프롬프트 재료이자 **숫자 화이트리스트의 출처**.
 * ⚠️ 여기 없는 숫자는 검증에서 전부 탈락하므로, 새 사실을 프롬프트에 넣으려면 반드시 이 함수를 거칠 것.
 */
export function recapFactLines(range: RangeRecap, subjectLabel: LabelOf = (k) => k): string[] {
  const t = range.totals;
  const multi = range.days.length > 1;
  const lines: string[] = [];

  if (multi) {
    lines.push(
      "[종합]",
      `- 기간 ${formatKoreanDate(range.from)} ~ ${formatKoreanDate(range.to)} (${range.days.length}일)`,
      `- 수업 ${t.slots}교시 · 출결 입력 ${t.cells}칸 중 ${t.recorded}칸${t.inputRate != null ? ` (${t.inputRate}%)` : ""}`,
      `- 출석 ${t.present}건 · 결석 ${t.absent}건 · 공결 ${t.excused}건 · 지각 ${t.late}건 · 조퇴 ${t.earlyLeave}건 · 보강 ${t.makeup}건`,
      `- 출석부가 통째로 비어 있는 반 ${t.unmarkedClasses}개 (학생 ${t.unmarkedStudents}명)`,
      pendingLine(t),
      "(건 = 학생 1명이 한 반에서 그 상태였던 하루. 같은 학생이 이틀 빠지면 2건)",
    );
  }

  for (const day of range.days) lines.push(...dayLines(day, subjectLabel));

  if (!multi) {
    lines.push(
      `- 출석부가 통째로 비어 있는 반 ${t.unmarkedClasses}개 (학생 ${t.unmarkedStudents}명)`,
      pendingLine(t),
    );
  }

  const behind = range.teachers.filter((x) => x.cells > 0 && x.recorded < x.cells).slice(0, LIST_CAP);
  if (behind.length > 0) {
    lines.push("[강사별 입력(기간 합계)]");
    lines.push(
      ...behind.map(
        (x) => `- ${x.teacherName}: ${x.cells}칸 중 ${x.recorded}칸 입력 · 미입력 반 ${x.unmarkedClasses}개`,
      ),
    );
  }
  return lines;
}

export function buildRecapPrompt(range: RangeRecap, subjectLabel: LabelOf = (k) => k): string {
  const multi = range.days.length > 1;
  return [
    "당신은 학원 원장·데스크를 보좌하는 운영 매니저입니다. 아래는 지난 수업일 출결의 **결정론 집계 결과**입니다.",
    "이 자료에 적힌 사실만 근거로, 관리자가 오늘 아침에 30초 안에 읽을 요약을 JSON으로만 답하세요.",
    "",
    "규칙(반드시 준수):",
    "- 한국어 존댓말. headline은 한 줄(60자 이내), points는 2~5개이며 각 1~2문장.",
    "- **자료에 있는 숫자만 그대로 사용**. 새 숫자·비율·합산·평균·추정 금지(자료에 없는 숫자는 폐기 사유).",
    "- 학생·강사 이름은 **자료에 등장한 이름만** 언급. 명단 밖 이름 창작 금지.",
    "- 자료에 없는 영어 단어·코드·키 이름 금지.",
    multi
      ? "- 기간이 여러 날입니다. **어느 날 일인지 반드시 밝히고**(예: 금요일/토요일), 날짜를 뭉뚱그리지 말 것."
      : "- 하루치 자료입니다. 없는 날짜를 만들지 말 것.",
    "- 사실 나열로 끝내지 말고 **먼저 처리할 것**(조치 미완료 결석, 반복 결석, 미입력 출석부)을 앞에 둘 것.",
    "- **여행·휴가·캠프처럼 미리 알려진 결석은 긴급으로 다루지 말고, 연락이 안 된 결석과 구분해 쓸 것.**",
    "- 원인·심경·학생 사정을 추측하지 말 것. 사유메모가 있으면 그 문구를 근거로만 쓸 것.",
    "- 특이사항이 없으면 그 사실을 그대로 쓸 것(없는 문제를 만들지 말 것).",
    `- 출력 형식: {"headline": "...", "points": ["...", "..."]}`,
    "",
    "[출결 집계]",
    ...recapFactLines(range, subjectLabel),
  ].join("\n");
}

/** 자료에 등장한 숫자 — 검증 화이트리스트. */
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
  range: RangeRecap,
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

  // 날짜 자체도 근거다 — 요일·월일 표기의 숫자가 화이트리스트에 들어가야 "금요일 15일"이 통과한다.
  const lines = [range.from, range.to, ...range.days.map((d) => d.date), ...recapFactLines(range, subjectLabel)];
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
