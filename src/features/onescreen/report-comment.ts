/**
 * 선생님 원스크린 — AI 학부모 멘트 프롬프트(순수 함수).
 * edutrix aiActions(generateDailyNotice/P1·P2)의 환각방지 가드·few-shot을 이식해, eywa generateJSON
 * (Upstage Solar 기본, JSON mode)에 맞춰 `{comment}` 한 단락을 생성한다. 라이브 AI 호출 없음(빌더만).
 * 실 AI 호출은 server/actions.ts의 generateReportComment, 실패 시 report.ts buildSubjectReport로 폴백.
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import type { OneScreenStudent, TestScore, TestScoreMode } from "./types";
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";
import { isSkipStatus } from "./progress-status";

/**
 * 테스트 점수 → 사람이 읽는 문자열(순수, 0148a). **표시 단일 소스** — 학부모 카드(daily_test)와 AI 멘트(testLine)가
 * 이 함수를 공유해야 "카드는 개수인데 멘트는 점수" 불일치가 안 난다.
 *  · count 모드 = "20문제 중 18개"(현행)
 *  · score 모드 = "95점"(만점 100) / "45/50점"(만점≠100). mode 미지정 = count(기존 동작 보존).
 * ⚠️ 이건 **표시**만 담당한다 — exam_info(합본 "일일 95/100")는 별도로 항상 X/Y를 유지한다(추세·prevScore 불변식).
 */
export function formatTestScore(score: number, max: number, mode?: TestScoreMode): string {
  if (mode === "score") return max === 100 ? `${score}점` : `${score}/${max}점`;
  return `${max}문제 중 ${score}개`;
}

/**
 * 테스트 표기 모드 전환 시 상태 조정(순수, 0148a). **적대검수 2건 방어**:
 *  ① 점수↔개수 왕복에서 문항수 유실 방지 — 점수로 갈 때 개수 만점(문항수)을 `countMax`에 기억,
 *     개수로 돌아올 때 복원(없으면 현재값). 점수 모드 만점은 100 고정.
 *  ② 척도가 바뀌면(개수↔점수) `prevScore`를 버린다 — 척도 다른 직전 회차를 빼면 "▲77" 허위 증감이 난다.
 * 점수는 항상 새 만점에 재클램프.
 */
export function applyTestScoreMode(test: TestScore, mode: TestScoreMode): TestScore {
  const prevScore = (test.mode ?? "count") === mode ? test.prevScore : null;
  if (mode === "score") {
    const countMax = test.mode === "score" ? test.countMax : test.max;
    const score = test.score != null ? Math.min(test.score, 100) : test.score;
    return { ...test, mode, max: 100, score, prevScore, countMax };
  }
  const max = test.countMax ?? test.max;
  const score = test.score != null ? Math.min(test.score, max) : test.score;
  return { ...test, mode, max, score, prevScore };
}

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
  // 반 공통 서술(G6) — 강사가 반 단위로 1회 쓴 수업 맥락("2단원 심화, 대체로 이해도 좋았다").
  // 학생별 사실과 결합해 서로 다른 멘트로 분기되는 **생성 재료**(기록 아님 — 클라 sessionStorage).
  // 가드 문구가 fact 블록에 동봉되므로(모순 시 학생 사실 우선) DB 프롬프트 오버라이드와 무관하게 항상 동행.
  classContext?: string; // "" 또는 미지정 = 반 서술 없음(기존 동작과 동일)
};

/** 값을 라벨 **한 줄 안에** 가두는 정규화 — 내부 개행을 ", "로 접는다.
 *  fact 블록은 줄 단위 사실 계약이라, 여러 줄 값의 2번째 줄부터는 라벨도 가드도 없는 맨줄 개별 사실로
 *  위장 주입된다(리뷰 확정 major — textarea·다중 차시라 여러 줄 입력이 자연스러움).
 *  ⚠️ **진도가 실제로 여러 줄이다**(2026-07-22 실측: 차시를 줄바꿈으로 나열 —
 *  "원과 직선의 위치 관계\n원의 접선의 방정식(1)\n…"). 반 공통 서술만 접고 진도·특이사항은 안 접어
 *  프롬프트 계약이 새고 있었다. 나열 값이라 공백이 아니라 **", "로** 접는다(문장으로 읽히게). */
function flatten(s: string): string {
  return s
    .split(/\n+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .join(", ");
}

/** 점수 → 사람이 읽는 문장. 미입력이면 "". 직전 회차 있으면 증감(▲/▼) 부기. 표기는 모드(0148a) 공유 포맷. */
function testLine(score: number | null, max: number, prev: number | null, mode?: TestScoreMode): string {
  if (score == null) return "";
  let s = formatTestScore(score, max, mode);
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
    // ⚠️ AI 프롬프트 → 학부모 멘트로 그대로 흘러가는 값이라 **순수 과목 라벨**만 넣는다.
    //    `su.name`엔 반 이름이 붙을 수 있다(같은 과목 두 반 = "수학 · 고1 특강"). 보고서에 반 노출 금지.
    subject: su?.subjectLabel || su?.name || "",
    progress: su?.today ?? "",
    dailyTest: testLine(st.tests.daily.score, st.tests.daily.max, st.tests.daily.prevScore, st.tests.daily.mode),
    checkTest: testLine(st.tests.check.score, st.tests.check.max, st.tests.check.prevScore, st.tests.check.mode),
    attitude: st.attitude ?? "",
    homework: st.homework && st.homework !== "—" ? st.homework : "",
    homeworkToday: su?.homeworkToday ?? "",
    textbook: su?.textbook ?? "",
    specialNote: st.note ?? "",
  };
}

/**
 * 진도 사실 1줄 — 진도가 중단된 날(progress-status.ts)은 **라벨을 '오늘 수업'으로 바꾼다**. '진도' 라벨로 주면
 * 모델이 "월말평가 진도를 나갔습니다"처럼 나가지도 않은 진도를 문장에 만든다. 값(`수학 월말평가`)은
 * 그대로 둔다 — 값에 괄호 설명을 달면 모델이 통째로 베낀다(아래 ⚠️ 주석의 실측 사고와 같은 벡터).
 */
function progressFact(input: ReportCommentInput, label: string): string | null {
  const prog = [input.subject, flatten(input.progress)].filter(Boolean).join(" ");
  if (!prog) return null;
  return `${isSkipStatus(input.progress) ? "오늘 수업" : label}: ${prog}`;
}

/** 입력의 **채워진 사실만** 모은 [입력] 블록(빈 값은 침묵). 모드 A 프롬프트 {{facts}}에 주입. */
export function buildFactBlock(input: ReportCommentInput): string {
  const facts: string[] = [];
  const prog = progressFact(input, "오늘 진도");
  if (prog) facts.push(prog);
  // ⚠️ 라벨에 괄호 설명을 달지 말 것 — 모델이 값과 함께 **그대로 베껴** 학부모 문장에 넣는다
  // (2026-07-22 실측: "이전 진도 범위 일일테스트에서 10문제 중 5개를 맞혔으며" — 40건 중 8건 누출).
  // 두 테스트가 무엇을 다루는지는 프롬프트 [반드시] 절이 설명한다(데이터가 아니라 지침에).
  if (input.dailyTest) facts.push(`일일테스트: ${input.dailyTest}`);
  if (input.checkTest) facts.push(`확인테스트: ${input.checkTest}`);
  if (input.attitude) facts.push(`수업 태도: ${flatten(input.attitude)}`);
  if (input.homework) facts.push(`과제: ${flatten(input.homework)}`);
  if (input.homeworkToday) facts.push(`오늘 과제: ${flatten(input.homeworkToday)}`); // 마무리 문장 재료(0096a)
  if (input.specialNote) facts.push(`특이사항: ${flatten(input.specialNote)}`);
  // 반 공통 서술(G6) — 참고 맥락으로 동봉. 가드("모순 시 위 학생 정보 우선")를 데이터에 실어
  // 프롬프트 템플릿(DB 오버라이드 가능)과 무관하게 항상 적용. 결석·진도미입력 행은 호출 전 구조 제외됨.
  // ⚠️ **개별 사실이 1개+ 있을 때만**(facts 앵커) — 반 서술 단독으로 문단이 살아나면 학생 개인 멘트가
  // 반 맥락만으로 지어지는 환각 벡터(서버 hasFacts 게이트와 이중 방어, 순수함수 단독 사용도 안전하게).
  const ctx = input.classContext ? flatten(input.classContext) : "";
  if (facts.length && ctx)
    facts.push(`반 공통 수업 맥락(참고용 — 위 학생 개별 정보와 다르면 학생 정보를 우선하세요): ${ctx}`);
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
  if (input.textbook) facts.push(`교재: ${flatten(input.textbook)}`);
  const prog = progressFact(input, "진도");
  if (prog) facts.push(prog);
  const hw = flatten(input.homeworkToday || input.homework);
  if (hw) facts.push(`과제: ${hw}`);
  // 반 공통 서술(G6)은 수업 내용 문단(P1)에만 — P2(태도·특이사항)에 새면 "항목 섞지 마세요" 규칙 위반.
  // ⚠️ 개별 P1 사실(교재·진도·과제)이 있을 때만 동봉 — 없으면 P1은 원래대로 null(문단 생략).
  // 반 서술 단독 P1은 "이 학생의 수업 내용"을 반 맥락만으로 지어내는 환각 벡터(태도만 입력된 케이스 등).
  const ctx = input.classContext ? flatten(input.classContext) : "";
  if (facts.length && ctx)
    facts.push(`반 공통 수업 맥락(참고용 — 위 학생 개별 정보와 다르면 학생 정보를 우선하세요): ${ctx}`);
  return facts.length ? facts.join("\n") : null;
}

/** P2 사실(태도·특이사항). 전부 비면 null(문단 생략). */
export function buildP2FactBlock(input: ReportCommentInput): string | null {
  const facts: string[] = [];
  if (input.attitude) facts.push(`태도: ${flatten(input.attitude)}`);
  if (input.specialNote) facts.push(`특이사항: ${flatten(input.specialNote)}`);
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
