/**
 * 선생님 원스크린 — 순수 계산 함수.
 * 프로토타입(parts.jsx/report.jsx)의 pct / studentStatus / isStudentDone /
 * buildReport(템플릿 보고서)를 이식 + 과목별 보고서(buildSubjectReport) 추가.
 * 라이브 AI 호출 없음 — 전부 결정적 템플릿.
 * CLAUDE.md 원칙: 계산 함수는 순수 함수로 분리 + Vitest 단위테스트.
 */
import type { CellState, OneScreenStudent, StudentStatus, TestScore } from "./types";
import { isNoneValue } from "./none-marker";
import { MONTHLY_EXAM_LABEL, isMonthlyExam } from "./monthly-exam";

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

/** 여러 줄 값(차시 나열 등)을 **한 문장 안에** 넣기 위한 정규화 — 개행을 ", "로 접는다.
 *  ⚠️ 이 템플릿은 강사가 초안을 안 쓰면 **학부모에게 그대로 나간다**(buildSaveInputFor 폴백).
 *  진도가 여러 줄인 게 실사용 기본형이라(2026-07-22 실측: 이성우 반 전원) 접지 않으면
 *  "오늘 수학 원과 직선의 위치 관계\n원의 접선의 방정식(1)\n… 진도를 진행했습니다."처럼
 *  **한 문장이 3줄로 쪼개진 채** 발송된다. report-comment.ts flatten과 같은 규약. */
function flatten(s: string): string {
  return s
    .split(/\n+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .join(", ");
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
  // "없음"(과제가 없던 날, 원장 2026-07-23)도 문장에선 생략한다 — "과제는 없음 상태입니다"는 어색하고,
  //  없던 과제를 굳이 언급할 이유도 없다. 학부모 카드엔 '지난 과제: 없음'으로 그대로 보인다.
  const hasHomework = !!st.homework && st.homework !== "—" && !isNoneValue(st.homework);
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
  // ⚠️ 학부모에게 나가는 문장이라 **순수 과목 라벨**을 쓴다 — `name`엔 반 이름이 붙을 수 있고
  //    (같은 과목 두 반일 때 "수학 · 고1 특강"), 보고서에 반은 노출하지 않는 것이 원장 확정 규칙이다.
  // 월말평가일(monthly-exam.ts)은 나간 차시가 없으므로 "~ 진도를 진행했습니다"를 쓰면 거짓이 된다 —
  // 과목을 진도/월말평가 두 무리로 갈라 각각 제 문장을 쓴다(수학은 월말평가, 영어는 정상 수업인 날 대비).
  const labelOf = (s: OneScreenStudent["subjects"][number]) => s.subjectLabel || s.name;
  const progressed = st.subjects.filter((s) => !isMonthlyExam(s.today));
  const exams = st.subjects.filter((s) => isMonthlyExam(s.today));
  const progText = progressed.map((s) => `${labelOf(s)} ${flatten(s.today)}`).join(", ");
  const examText = exams.map(labelOf).join(", ");
  const head = exams.length
    ? progressed.length
      ? `${st.name} 학생, 오늘 ${progText} 진도를 진행했고, ${examText} ${MONTHLY_EXAM_LABEL}를 진행했습니다.`
      : `${st.name} 학생, 오늘 ${examText} ${MONTHLY_EXAM_LABEL}를 진행했습니다.`
    : `${st.name} 학생, 오늘 ${progText} 진도를 진행했습니다.`;
  return [head, ...testAndClosingLines(st)].join(" ");
}

/** 과목별 학부모 보고서 초안 — 해당 과목 진도만 언급(과목별로 따로 발송용). */
export function buildSubjectReport(st: OneScreenStudent, subjectIndex: number): string {
  const su = st.subjects[subjectIndex];
  if (!su) return buildReport(st);
  const label = su.subjectLabel || su.name;
  const lines = [
    // 학부모 문장 — 반 이름이 섞이지 않는 subjectLabel(위 buildReport와 같은 이유).
    // 월말평가일은 차시가 없어 "진도를 진행했습니다"가 거짓 — 전용 문장으로 간다.
    isMonthlyExam(su.today)
      ? `${st.name} 학생, 오늘 ${label} ${MONTHLY_EXAM_LABEL}를 진행했습니다.`
      : `${st.name} 학생, 오늘 ${label} ${flatten(su.today)} 진도를 진행했습니다.`,
    ...testAndClosingLines(st),
  ];
  // 오늘 과제(0096a) — AI 멘트 프롬프트의 마무리 규칙("오늘 과제는 ~입니다")과 폴백 템플릿 대칭 유지.
  // 오늘 과제 — "없음"이면 "오늘 과제는 없음입니다"가 되지 않게 전용 문장으로(원장 2026-07-23).
  if (isNoneValue(su.homeworkToday)) lines.push("오늘은 따로 내드린 과제가 없습니다.");
  else if (su.homeworkToday?.trim()) lines.push(`오늘 과제는 ${flatten(su.homeworkToday)}입니다.`);
  return lines.join(" ");
}
