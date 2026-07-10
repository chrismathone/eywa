/**
 * 선생님 원스크린 — AI 학부모 멘트 프롬프트(순수 함수).
 * edutrix aiActions(generateDailyNotice/P1·P2)의 환각방지 가드·few-shot을 이식해, eywa generateJSON
 * (Upstage Solar 기본, JSON mode)에 맞춰 `{comment}` 한 단락을 생성한다. 라이브 AI 호출 없음(빌더만).
 * 실 AI 호출은 server/actions.ts의 generateReportComment, 실패 시 report.ts buildSubjectReport로 폴백.
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import type { OneScreenStudent } from "./types";
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";

export type ReportCommentInput = {
  studentName: string;
  subject: string;
  progress: string; // 오늘 진도(subject.today)
  dailyTest: string; // "20문제 중 18개 (지난 회차 대비 ▲2)" | ""
  checkTest: string;
  attitude: string; // "" = 미입력
  homework: string; // 지난 과제 수행 상태(완료/일부 미흡/미제출). "" = 미입력/—
  homeworkToday: string; // 오늘 내준 과제(숙제 내용) — 0096a. 멘트 마무리 "오늘 과제는 ~입니다" 재료. "" = 미입력
  textbook: string; // 교재명 — 공지 모드 B의 P1(수업 내용)에 사용. "" = 미입력
  specialNote: string; // 특이사항(강사 메모) — 0093a. 모드 A는 종합, B는 P2에 사용. "" = 미입력
};

/** 점수 → 사람이 읽는 문장. 미입력이면 "". 직전 회차 있으면 증감(▲/▼) 부기. */
function testLine(score: number | null, max: number, prev: number | null): string {
  if (score == null) return "";
  let s = `${max}문제 중 ${score}개`;
  if (prev != null) {
    const d = score - prev;
    s += d === 0 ? " (지난 회차와 동일)" : ` (지난 회차 대비 ${d > 0 ? "▲" : "▼"}${Math.abs(d)})`;
  }
  return s;
}

/** onescreen 학생 + 과목 인덱스 → 멘트 입력. 빈 값은 빈 문자열(프롬프트가 침묵하도록). */
export function buildReportCommentInput(st: OneScreenStudent, subjectIndex: number): ReportCommentInput {
  const su = st.subjects[subjectIndex];
  return {
    studentName: st.name,
    subject: su?.name ?? "",
    progress: su?.today ?? "",
    dailyTest: testLine(st.tests.daily.score, st.tests.daily.max, st.tests.daily.prevScore),
    checkTest: testLine(st.tests.check.score, st.tests.check.max, st.tests.check.prevScore),
    attitude: st.attitude ?? "",
    homework: st.homework && st.homework !== "—" ? st.homework : "",
    homeworkToday: su?.homeworkToday ?? "",
    textbook: su?.textbook ?? "",
    specialNote: st.note ?? "",
  };
}

/** 입력의 **채워진 사실만** 모은 [입력] 블록(빈 값은 침묵). 모드 A 프롬프트 {{facts}}에 주입. */
export function buildFactBlock(input: ReportCommentInput): string {
  const facts: string[] = [];
  const prog = [input.subject, input.progress].filter(Boolean).join(" ");
  if (prog) facts.push(`오늘 진도: ${prog}`);
  if (input.dailyTest) facts.push(`일일테스트(이전 진도 범위): ${input.dailyTest}`);
  if (input.checkTest) facts.push(`확인테스트(오늘 진도 범위): ${input.checkTest}`);
  if (input.attitude) facts.push(`수업 태도: ${input.attitude}`);
  if (input.homework) facts.push(`과제: ${input.homework}`);
  if (input.homeworkToday) facts.push(`오늘 과제: ${input.homeworkToday}`); // 마무리 문장 재료(0096a)
  if (input.specialNote) facts.push(`특이사항: ${input.specialNote}`);
  return facts.length ? facts.join("\n") : "(입력된 정보 없음)";
}

/**
 * 멘트 프롬프트 — 기본 템플릿(DEFAULT_PROMPTS.comment)에 채워진 사실만 주입. Upstage JSON mode용 {comment} 계약.
 * template 인자를 주면(원장 DB 오버라이드) 그것을 대신 사용 — 프로덕션은 활성값이 기본을 덮음.
 */
/** 멘트 본문(출력 계약 없음) — 통합 호출 섹션용. template=원장 오버라이드. */
export function commentBody(input: ReportCommentInput, template?: string | null): string {
  return interpolate(template || DEFAULT_PROMPTS.comment, { facts: buildFactBlock(input) });
}

/** 멘트 단일 프롬프트(본문 + {comment} 출력 계약) — 미리보기·개별 테스트용. */
export function buildReportCommentPrompt(input: ReportCommentInput, template?: string | null): string {
  return assembleSingle(commentBody(input, template), "comment");
}

// ── 공지 모드 B(2문단 분리) — P1(수업 내용) + P2(태도·특이사항) ──

/** P1 사실(교재·진도·과제). 전부 비면 null(문단 생략).
 *  과제 = **오늘 과제(숙제 내용, 0096a) 우선** — P1 템플릿의 "오늘 과제는 ~입니다" 마무리와 정합.
 *  미입력이면 기존처럼 수행 상태(homework)로 폴백(구 동작 보존). */
export function buildP1FactBlock(input: ReportCommentInput): string | null {
  const facts: string[] = [];
  if (input.textbook) facts.push(`교재: ${input.textbook}`);
  const prog = [input.subject, input.progress].filter(Boolean).join(" ");
  if (prog) facts.push(`진도: ${prog}`);
  const hw = input.homeworkToday || input.homework;
  if (hw) facts.push(`과제: ${hw}`);
  return facts.length ? facts.join("\n") : null;
}

/** P2 사실(태도·특이사항). 전부 비면 null(문단 생략). */
export function buildP2FactBlock(input: ReportCommentInput): string | null {
  const facts: string[] = [];
  if (input.attitude) facts.push(`태도: ${input.attitude}`);
  if (input.specialNote) facts.push(`특이사항: ${input.specialNote}`);
  return facts.length ? facts.join("\n") : null;
}

/** 모드 B P1 본문(출력 계약 없음) — 통합 호출 섹션용. 사실 없으면 null(문단 생략). */
export function commentP1Body(input: ReportCommentInput, template?: string | null): string | null {
  const p1facts = buildP1FactBlock(input);
  if (!p1facts) return null;
  return interpolate(template || DEFAULT_PROMPTS.comment_p1, { p1facts });
}

/** 모드 B P2 본문(출력 계약 없음). 사실 없으면 null. */
export function commentP2Body(input: ReportCommentInput, template?: string | null): string | null {
  const p2facts = buildP2FactBlock(input);
  if (!p2facts) return null;
  return interpolate(template || DEFAULT_PROMPTS.comment_p2, { p2facts });
}

/** 모드 B P1 단일 프롬프트(본문 + {comment} 계약) — 미리보기·개별 테스트용. 사실 없으면 null. */
export function buildCommentP1Prompt(input: ReportCommentInput, template?: string | null): string | null {
  const body = commentP1Body(input, template);
  return body ? assembleSingle(body, "comment_p1") : null;
}

/** 모드 B P2 단일 프롬프트. 사실 없으면 null. */
export function buildCommentP2Prompt(input: ReportCommentInput, template?: string | null): string | null {
  const body = commentP2Body(input, template);
  return body ? assembleSingle(body, "comment_p2") : null;
}
