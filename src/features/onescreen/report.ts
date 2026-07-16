/**
 * 선생님 원스크린 — 순수 계산 함수.
 * 프로토타입(parts.jsx/report.jsx)의 pct / studentStatus / isStudentDone /
 * buildReport(템플릿 보고서)를 이식 + 과목별 보고서(buildSubjectReport) 추가.
 * 라이브 AI 호출 없음 — 전부 결정적 템플릿.
 * CLAUDE.md 원칙: 계산 함수는 순수 함수로 분리 + Vitest 단위테스트.
 */
import type { CellState, OneScreenStudent, StudentStatus, TestScore } from "./types";

/** 정답 개수 → 백분율 (만점 0이면 0) */
export function pct(score: number, max: number): number {
  return max ? Math.round((score / max) * 100) : 0;
}

/** 이번 점수 − 직전 회차. 둘 중 하나라도 없으면 비교 불가(null). */
export function delta(score: number | null, prev: number | null): number | null {
  if (score == null || prev == null) return null;
  return score - prev;
}

/** 테스트 사용 여부(학원 설정) — 비활성 테스트는 '테'·'마감' 카운트에서 요구하지 않는다(둘 다 off면 카운트 0 고정 방지, #25). */
export type TestConfig = { dailyEnabled?: boolean; checkEnabled?: boolean };

/** 학생 행의 진/테/보 상태 셀 (보고서는 student-level reportSent 기준 — 클라이언트가 과목별로 재정의 가능) */
export function studentStatus(st: OneScreenStudent, cfg?: TestConfig): StudentStatus {
  const prog: CellState = st.progressConfirmed ? "ok" : "todo";

  const dailyOn = cfg?.dailyEnabled ?? true;
  const checkOn = cfg?.checkEnabled ?? true;
  const dailyReq = dailyOn && st.tests.daily.score == null; // 사용 중인데 미입력
  const checkReq = checkOn && st.tests.check.score == null;
  const anyEntered =
    (dailyOn && st.tests.daily.score != null) || (checkOn && st.tests.check.score != null);
  // 요구되는 테스트가 모두 입력=ok, 일부 입력=warn, 전무=todo. 둘 다 비활성이면 요구 0 → ok(항목 없음).
  const test: CellState = !dailyReq && !checkReq ? "ok" : anyEntered ? "warn" : "todo";

  const rep: CellState = st.reportSent ? "ok" : st.reportDraft.trim() ? "warn" : "todo";
  return { prog, test, rep };
}

/** 진도·테스트·보고서 모두 완료 */
export function isStudentDone(st: OneScreenStudent, cfg?: TestConfig): boolean {
  const s = studentStatus(st, cfg);
  return s.prog === "ok" && s.test === "ok" && s.rep === "ok";
}

function testClause(label: string, t: TestScore): string | null {
  if (t.score == null) return null;
  const d = delta(t.score, t.prevScore);
  let tail = "";
  if (d != null) {
    tail = d === 0 ? " (지난 회차와 동일)" : ` (지난 회차 대비 ${d > 0 ? "▲" : "▼"}${Math.abs(d)}점)`;
  }
  return `${label} ${t.score}/${t.max}${tail}`;
}

/** 진도 문장 뒤에 붙는 공통부 — 테스트 결과 + 태도·과제 + 평가 마무리. */
function testAndClosingLines(st: OneScreenStudent): string[] {
  const lines: string[] = [];

  const tparts: string[] = [];
  const dPart = testClause("일일테스트(이전 진도)", st.tests.daily);
  const cPart = testClause("확인테스트(오늘 진도)", st.tests.check);
  if (dPart) tparts.push(dPart);
  if (cPart) tparts.push(cPart);
  if (tparts.length) lines.push(tparts.join(", ") + " 결과를 받았습니다.");

  // 태도·과제를 독립 처리 — 빈 값(과제 미입력 "" / "—")은 문장에서 생략(무의미한 "과제는 — 상태입니다" 방지).
  const hasHomework = !!st.homework && st.homework !== "—";
  if (st.attitude && hasHomework)
    lines.push(`수업 태도는 '${st.attitude}', 과제는 ${st.homework} 상태입니다.`);
  else if (st.attitude) lines.push(`수업 태도는 '${st.attitude}'입니다.`);
  else if (hasHomework) lines.push(`과제는 ${st.homework} 상태입니다.`);

  const scored = [st.tests.daily, st.tests.check].filter(
    (t): t is TestScore & { score: number } => t.score != null,
  );
  if (scored.length) {
    const avg = scored.reduce((acc, t) => acc + pct(t.score, t.max), 0) / scored.length;
    if (avg >= 90)
      lines.push("전반적으로 안정적인 성취를 보이고 있습니다. 가정에서도 격려 부탁드립니다.");
    else if (avg >= 70)
      lines.push("꾸준히 잘 따라오고 있습니다. 오늘 배운 내용 가볍게 점검해 주시면 좋겠습니다.");
    else lines.push("틀린 문항 위주로 복습이 필요해 보입니다. 가정에서도 관심 부탁드립니다.");
  }
  return lines;
}

/** 오늘 진도·테스트·태도를 합친 학부모 보고서 초안 (전 과목 합본 — 학생 데일리 리포트용) */
export function buildReport(st: OneScreenStudent): string {
  const subj = st.subjects.map((s) => `${s.name} ${s.today}`).join(", ");
  return [`${st.name} 학생, 오늘 ${subj} 진도를 진행했습니다.`, ...testAndClosingLines(st)].join(" ");
}

/** 과목별 학부모 보고서 초안 — 해당 과목 진도만 언급(과목별로 따로 발송용). */
export function buildSubjectReport(st: OneScreenStudent, subjectIndex: number): string {
  const su = st.subjects[subjectIndex];
  if (!su) return buildReport(st);
  const lines = [
    `${st.name} 학생, 오늘 ${su.name} ${su.today} 진도를 진행했습니다.`,
    ...testAndClosingLines(st),
  ];
  // 오늘 과제(0096a) — AI 멘트 프롬프트의 마무리 규칙("오늘 과제는 ~입니다")과 폴백 템플릿 대칭 유지.
  if (su.homeworkToday?.trim()) lines.push(`오늘 과제는 ${su.homeworkToday.trim()}입니다.`);
  return lines.join(" ");
}
