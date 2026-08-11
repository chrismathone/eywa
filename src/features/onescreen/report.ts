/**
 * 선생님 원스크린 — 순수 계산 함수.
 * 프로토타입(parts.jsx/report.jsx)의 pct / studentStatus / isStudentDone /
 * buildReport(템플릿 보고서)를 이식 + 과목별 보고서(buildSubjectReport) 추가.
 * 라이브 AI 호출 없음 — 전부 결정적 템플릿.
 * CLAUDE.md 원칙: 계산 함수는 순수 함수로 분리 + Vitest 단위테스트.
 */
import type { CellState, OneScreenStudent, StudentStatus, TestScore } from "./types";
import { formatTestScore } from "./report-comment";
import { isNoneValue } from "./none-marker";
import { homeworkRateClause } from "./homework-rate";
import { attitudeClause } from "./attitude";
import { isSkipStatus, skipStatusOf } from "./progress-status";
import { PROGRESS_MODES, asProgressMode, progressPredicate } from "./progress-mode";
import { progressInline } from "./progress-range";

/**
 * 템플릿 문장 사이 구분자 — **줄바꿈**(원장 2026-07-30: "줄바꿈도 필요하면 적절히 반영").
 * 한 줄에 다 붙이면 학부모 화면에서 사실이 뭉쳐 읽힌다. 사실 한 덩이 = 한 줄.
 */
const LINE_BREAK = "\n";

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

/**
 * 테스트 한 조각 — **표기는 `formatTestScore` 단일 소스**(카드·AI 멘트와 같은 문자열).
 *
 * 🔴 2026-07-30 발송 감사에서 이 함수가 세 가지를 학부모에게 내보내고 있었다:
 *   ① `일일테스트(이전 진도)` — 괄호 안은 **강사에게 설명하려고 붙인 내부 라벨**이다. AI 멘트 쪽은
 *      07-23에 이 누출을 막았는데(프롬프트 "설명 자체를 옮겨 적지 말 것") 템플릿만 그대로였다.
 *   ② `17/25` 생분수 — 다른 표면은 전부 "25문제 중 17개"라 카드와 멘트가 서로 다른 표기를 썼다.
 *   ③ 증감 단위가 항상 `점` — 개수 척도에서도 "▼3점"이라 틀린 단위였다.
 */
function testClause(label: string, t: TestScore): string | null {
  if (t.score == null) return null;
  const d = delta(t.score, t.prevScore);
  const tail =
    d == null ? "" : d === 0 ? " (지난 회차와 동일)" : ` (지난 회차 대비 ${d > 0 ? "▲" : "▼"}${Math.abs(d)}개)`;
  return `${label}에서 ${formatTestScore(t.score, t.max)}${tail}`;
}

/**
 * 진도 문장 뒤에 붙는 공통부 — 입력된 사실만 담담히. **판단·조언은 넣지 않는다.**
 *
 * 🔴 예전엔 점수 평균만 보고 "틀린 문항 위주로 복습이 필요해 보입니다. 가정에서도 관심 부탁드립니다."
 *    같은 문장을 붙였다(2026-07-30 감사: 발송분 50건에 포함). **강사가 하지 않은 평가·조언이 강사
 *    이름으로 학부모에게 나가는 것**이고, AI 멘트 프롬프트가 금지한 바로 그 종류의 문장이다
 *    (전망·조언·격려 금지). 템플릿은 AI가 실패했을 때의 **사실 요약**이지 평가서가 아니다.
 */
function testAndClosingLines(st: OneScreenStudent): string[] {
  const lines: string[] = [];

  const tparts: string[] = [];
  const dPart = testClause("일일테스트", st.tests.daily);
  const cPart = testClause("확인테스트", st.tests.check);
  if (dPart) tparts.push(dPart);
  if (cPart) tparts.push(cPart);
  if (tparts.length) lines.push(tparts.join(", ") + ".");

  // 태도·과제를 독립 처리 — 빈 값(과제 미입력 "" / "—")은 문장에서 생략(무의미한 "과제는 — 상태입니다" 방지).
  // "없음"(과제가 없던 날, 원장 2026-07-23)도 문장에선 생략한다 — "과제는 없음 상태입니다"는 어색하고,
  //  없던 과제를 굳이 언급할 이유도 없다. 학부모 카드엔 '지난 과제: 없음'으로 그대로 보인다.
  const hasHomework = !!st.homework && st.homework !== "—" && !isNoneValue(st.homework);
  // 값이 퍼센트(90%)라 "지난 과제는 90%입니다"로는 무엇의 90%인지 모호하다 → homeworkRateClause 단일 소스.
  // 태도도 마찬가지 — 선택지가 "안좋음"이라 그대로 이으면 "태도는 안좋음입니다"가 된다(attitudeClause).
  const hwClause = hasHomework ? `지난 과제는 ${homeworkRateClause(st.homework)}` : null;
  if (st.attitude && hwClause) lines.push(`수업 태도는 ${attitudeClause(st.attitude, "join")}, ${hwClause}.`);
  else if (st.attitude) lines.push(`수업 태도는 ${attitudeClause(st.attitude)}.`);
  else if (hwClause) lines.push(`${hwClause}.`);

  return lines;
}

/** 오늘 진도·테스트·태도를 합친 학부모 보고서 초안 (전 과목 합본 — 학생 데일리 리포트용) */
export function buildReport(st: OneScreenStudent): string {
  // ⚠️ 학부모에게 나가는 문장이라 **순수 과목 라벨**을 쓴다 — `name`엔 반 이름이 붙을 수 있고
  //    (같은 과목 두 반일 때 "수학 · 고1 특강"), 보고서에 반은 노출하지 않는 것이 원장 확정 규칙이다.
  // 진도가 중단된 날(progress-status.ts — 월말평가·모의고사·내신대비·시험대비)은 나간 차시가 없으므로
  // "~ 진도를 진행했습니다"를 쓰면 거짓이 된다 — 과목을 진도/특수상태 두 무리로 갈라 각각 제 문장을 쓴다
  // (수학은 시험, 영어는 정상 수업인 날 대비). 상태 라벨은 과목마다 다를 수 있어 과목별로 붙인다.
  const labelOf = (s: OneScreenStudent["subjects"][number]) => s.subjectLabel || s.name;
  const progressed = st.subjects.filter((s) => !isSkipStatus(s.today));
  const exams = st.subjects.filter((s) => isSkipStatus(s.today));
  // 진도는 **물결 축약**(progress-range.ts) — 9차시를 다 나열하면 학부모 문장이 목록이 된다(원장 2026-08-05).
  const listOf = (subs: typeof progressed) =>
    subs.map((s) => `${labelOf(s)} ${progressInline(s.today)}`).join(", ");
  // 수업 성격(복습·문제풀이)이 과목마다 다를 수 있어(수학은 복습, 영어는 새 진도) **성격별로 묶어** 절을 만든다.
  // 한 절로 뭉뚱그리면 복습한 과목까지 "진도를 진행했다"가 되어 거짓이 된다(이 축을 만든 이유 그 자체).
  const clauses: string[] = [];
  for (const m of [null, ...PROGRESS_MODES] as const) {
    const group = progressed.filter((s) => (asProgressMode(s.progressMode) ?? null) === m);
    if (group.length) clauses.push(`${listOf(group)} ${progressPredicate(m)}`);
  }
  const examText = exams.map((s) => `${labelOf(s)} ${skipStatusOf(s.today)}`).join(", ");
  if (exams.length) clauses.push(`${examText}를 진행했`);
  // ⚠️ 학생 호칭('○○ 학생,')을 쓰지 않는다 — AI 멘트 프롬프트가 금지한 것과 같은 규칙(수신인은 학부모).
  const head = clauses.length ? `오늘은 ${clauses.join("고, ")}습니다.` : "";
  return [head, ...testAndClosingLines(st)].filter(Boolean).join(LINE_BREAK);
}

/** 과목별 학부모 보고서 초안 — 해당 과목 진도만 언급(과목별로 따로 발송용). */
export function buildSubjectReport(st: OneScreenStudent, subjectIndex: number): string {
  const su = st.subjects[subjectIndex];
  if (!su) return buildReport(st);
  const label = su.subjectLabel || su.name;
  const lines = [
    // 학부모 문장 — 반 이름이 섞이지 않는 subjectLabel(위 buildReport와 같은 이유).
    // 진도가 중단된 날은 차시가 없어 "진도를 진행했습니다"가 거짓 — 전용 문장으로 간다.
    isSkipStatus(su.today)
      ? `오늘은 ${label} ${skipStatusOf(su.today)}를 진행했습니다.`
      : // 성격(복습·문제풀이)이 붙으면 술어가 바뀐다 — "진도를 진행했" ↔ "복습을 진행했".
        `오늘은 ${label} ${progressInline(su.today)} ${progressPredicate(asProgressMode(su.progressMode))}습니다.`,
    ...testAndClosingLines(st),
  ];
  // 오늘 과제(0096a) — AI 멘트 프롬프트의 마무리 규칙("오늘 과제는 ~입니다")과 폴백 템플릿 대칭 유지.
  // 오늘 과제 — "없음"이면 "오늘 과제는 없음입니다"가 되지 않게 전용 문장으로(원장 2026-07-23).
  if (isNoneValue(su.homeworkToday)) lines.push("오늘은 따로 내드린 과제가 없습니다.");
  else if (su.homeworkToday?.trim()) lines.push(`오늘 과제는 ${flatten(su.homeworkToday)}입니다.`);
  return lines.join(LINE_BREAK);
}
