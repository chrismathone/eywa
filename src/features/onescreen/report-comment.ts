/**
 * 선생님 원스크린 — AI 학부모 멘트 프롬프트(순수 함수).
 * edutrix aiActions(generateDailyNotice/P1·P2)의 환각방지 가드·few-shot을 이식해, aywa generateJSON
 * (Upstage Solar 기본, JSON mode)에 맞춰 `{comment}` 한 단락을 생성한다. 라이브 AI 호출 없음(빌더만).
 * 실 AI 호출은 server/actions.ts의 generateReportComment, 실패 시 report.ts buildSubjectReport로 폴백.
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import type { OneScreenStudent } from "./types";
import { normalizeHomeworkPages } from "./homework-pages";
import { homeworkFactValue } from "./homework-rate";
import { resolveRowFields } from "./row-fields";
import { splitNoticeFromNote } from "./class-notice";
import { withTeacherNoteFidelity } from "./teacher-note-fidelity";

const EMPTY_NOTICES: ReadonlyMap<string, string> = new Map();
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";
import { isSkipStatus } from "./progress-status";
import { asProgressMode, progressFactLabel } from "./progress-mode";
import { progressForMent } from "./progress-range";
import { homeworkDueText } from "@/features/video-homework/due";

const PLAIN_COMMENT_STYLE = "\n\n[말투 보완]\n기존 선생님의 말투와 문장 구성을 유지하세요. 기록에 없는 칭찬·다짐·전망을 덧붙이지 말고, '성장이 기대됩니다', '꾸준한 노력으로', '한 걸음 더 나아갔습니다' 같은 상투적인 마무리는 피하세요.";
const VIDEO_COMMENT_GUIDANCE = "\n\n[영상 과제]\n제출 사실만으로 성실함이나 이해도를 평가하지 마세요. 영상 제출 여부는 별도로 확인해 붙이므로, 입력에 없는 지난 영상 숙제의 제출·미제출 문장을 만들지 마세요.";
const commentStyle = (input: ReportCommentInput) => PLAIN_COMMENT_STYLE + (input.videoHomework === true ? VIDEO_COMMENT_GUIDANCE : "");

/**
 * 테스트 점수 → 사람이 읽는 문자열(순수). **표시 단일 소스** — 학부모 카드(daily_test)·AI 멘트(testLine)·
 * 폴백 템플릿이 이 함수를 공유해야 표면마다 다른 표기가 나가지 않는다.
 *
 * 🔴 끝의 **"맞음"은 뺄 수 없다**(원장 2026-08-11: "10개 중 10개로 보내지 말고 마지막에 '맞음'을 추가해서
 *    확실하게"). "10문제 중 10개"는 학부모가 *무엇이* 10개인지(맞은 건지 푼 건지 틀린 건지) 되짚어야 읽힌다.
 * 🔴 표기는 **개수 하나뿐**이다 — '점수(100점 만점)' 모드는 제거됐다(types.ts TestScore 주석).
 * ⚠️ 이건 **표시**만 담당한다 — exam_info(합본 "일일 18/20")는 별도로 항상 X/Y를 유지한다(추세·prevScore 불변식).
 */
export function formatTestScore(score: number, max: number): string {
  return `${max}문제 중 ${score}개 맞음`;
}

export type ReportCommentInput = {
  studentName: string;
  subject: string;
  progress: string; // 오늘 진도(subject.today)
  /**
   * 오늘 수업 성격(복습·문제풀이) — 없으면 평소대로 '진도'(progress-mode.ts).
   * 🔴 값이 아니라 **라벨**을 바꾸는 데 쓴다: "오늘 복습: 수학 다항식의 곱셈".
   *    값에 "(복습)"을 달면 모델이 괄호째 베껴 학부모 문장에 넣는다(2026-07-22 실측 누출과 같은 벡터).
   */
  progressMode?: string | null;
  dailyTest: string; // "20문제 중 18개 (지난 회차 대비 ▲2)" | ""
  checkTest: string;
  attitude: string; // "" = 미입력
  homework: string; // 지난 과제 수행률("90%"). "" = 미입력/—. 옛 기록은 "완료"·"미제출"도 온다.
  homeworkToday: string; // 오늘 내준 과제(숙제 내용) — 0096a. 멘트 마무리 "오늘 과제는 ~입니다" 재료. "" = 미입력
  videoHomework?: boolean;
  /**
   * 영상 숙제를 언제까지 내나(원장 2026-10-15 — 학생이 숙제일을 내는 날로 헷갈렸다) — "10/22 (목)까지" · "다음 수업 10/15 (목)까지"
   * (video-homework/due.ts `homeworkDueText`). 영상 과제가 있을 때만. 없으면 마감을 말하지 않는다(종전대로).
   */
  videoHomeworkDue?: string;
  textbook: string; // 교재명 — 공지 모드 B의 P1(수업 내용)에 사용. "" = 미입력
  specialNote: string; // 특이사항(강사 메모) — 0093a. 모드 A는 종합, B는 P2에 사용. "" = 미입력
  // 반 공통 서술(G6) — 강사가 반 단위로 1회 쓴 수업 맥락("2단원 심화, 대체로 이해도 좋았다").
  // 학생별 사실과 결합해 서로 다른 멘트로 분기되는 **생성 재료**(기록 아님 — 클라 sessionStorage).
  // 가드 문구가 fact 블록에 동봉되므로(모순 시 학생 사실 우선) DB 프롬프트 오버라이드와 무관하게 항상 동행.
  classContext?: string; // "" 또는 미지정 = 반 서술 없음(기존 동작과 동일)
  /**
   * **반 전체 안내** — 그 반 학생 모두에게 같은 내용으로 나가는 공지(class-notice.ts가 판별).
   * 🔴 `specialNote`와 **동시에 채우지 않는다**. 같은 문장이 '안내'와 '이 아이의 특이사항'으로 두 번 들어가면
   *    모델이 그걸 개인 사실로 한 번 더 쓴다 — 중복이 곧 AI 티다(2026-08-13 실측: 한 반 6명 멘트가 거의 동일).
   */
  classNotice?: string;
  /** 소단원별 이해도(10점 만점) — 수학 보고서 시범(math-report-pilot.ts)에서만 채운다. 뺀 소단원·점수 없는 소단원은 이미 빠져 있다. */
  understanding?: { title: string; score: number }[];
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

/** 점수 → 사람이 읽는 문장. 미입력이면 "". 직전 회차 있으면 증감(▲/▼) 부기. 표기는 공유 포맷. AI 멘트 탭 미리보기도 이 함수(ment-preview-input.ts). */
export function testLine(score: number | null, max: number, prev: number | null): string {
  if (score == null) return "";
  let s = formatTestScore(score, max);
  if (prev != null) {
    const d = score - prev;
    s += d === 0 ? " (지난 회차와 동일)" : ` (지난 회차 대비 ${d > 0 ? "▲" : "▼"}${Math.abs(d)})`;
  }
  return s;
}

/**
 * 영상 숙제 마감을 사실 한 줄에 붙인다 — ". 영상 제출 마감: 10/22 (목)까지. 마감 날짜는 바꾸지 말고 그대로 쓰세요". 학생이 숙제일을 내는 날로
 * 헷갈려 숙제 없이 올린 일이 있어(원장 2026-10-15) 날짜를 바꾸거나 빼지 말라고 함께 적는다. ⚠️ 지시를 값 옆 괄호에 넣지 말 것 — 모델이 괄호째
 * 학부모 문장에 베낀다(아래 '라벨에 괄호 설명' 주석과 같은 까닭). 값은 화면이 만든 문구라 한 줄 · 길이 제한으로만 받는다.
 */
function dueClause(input: ReportCommentInput): string {
  const due = input.videoHomeworkDue ? flatten(input.videoHomeworkDue).slice(0, 40) : "";
  return due ? `. 영상 제출 마감: ${due}. 마감 날짜는 바꾸지 말고 그대로 쓰세요` : "";
}

/** onescreen 학생 + 과목 인덱스 → 멘트 입력. 빈 값은 빈 문자열(프롬프트가 침묵하도록). */
export function buildReportCommentInput(
  st: OneScreenStudent,
  subjectIndex: number,
  /**
   * 반별 **반 전체 안내**(class-notice.ts `detectClassNotices`). 넘기지 않으면 종전대로 전부 특이사항 취급.
   * 🔑 같은 반 학생들의 특이사항이 전부 똑같으면 그건 개인 관찰일 수 없다 — 공지를 특이사항으로 주면
   *    모델이 6명분 관찰을 지어내 멘트가 서로 복사본처럼 된다(2026-08-13 실측).
   */
  classNotices?: ReadonlyMap<string, string>,
  /** 보고서 날짜(수업일) — 영상 숙제 마감 문구의 기준(7일 = 이 날 + 7일). 안 주면 마감을 싣지 않는다. */
  reportDate?: string,
): ReportCommentInput {
  const su = st.subjects[subjectIndex];
  // 🔴 평가값은 **그 행의 값**이다(row-fields.ts) — 학생 값을 그대로 쓰면 보강 행 멘트에 정규 수업의
  //    태도·점수가 실려 나간다(원장 2026-08-13: 보강은 따로 발송되는 다른 보고서다).
  //    저장(report-fields.ts)·화면과 같은 해석을 쓴다 = 셋이 서로 다른 말을 하지 않는다.
  const ev = resolveRowFields(st, su);
  const { classNotice, specialNote } = splitNoticeFromNote(ev.note, su?.classId, classNotices ?? EMPTY_NOTICES);
  return {
    studentName: st.name,
    // ⚠️ AI 프롬프트 → 학부모 멘트로 그대로 흘러가는 값이라 **순수 과목 라벨**만 넣는다.
    //    `su.name`엔 반 이름이 붙을 수 있다(같은 과목 두 반 = "수학 · 고1 특강"). 보고서에 반 노출 금지.
    subject: su?.subjectLabel || su?.name || "",
    progress: su?.today ?? "",
    progressMode: su?.progressMode ?? null,
    dailyTest: testLine(ev.tests.daily.score, ev.tests.daily.max, ev.tests.daily.prevScore),
    checkTest: testLine(ev.tests.check.score, ev.tests.check.max, ev.tests.check.prevScore),
    attitude: ev.attitude ?? "",
    homework: ev.homework && ev.homework !== "—" ? ev.homework : "",
    // 쪽수 후보정 — 저장(report-fields)과 **같은 값**이 AI에 가야 멘트가 "~131까지"로 나가고 카드는 "~131p"가
    // 되는 어긋남이 안 생긴다. 순수·멱등이라 이미 단위가 붙은 값은 그대로 지나간다(homework-pages.ts).
    homeworkToday: normalizeHomeworkPages(su?.homeworkToday ?? ""),
    ...(typeof su?.videoHomework === "boolean" ? { videoHomework: su.videoHomework } : {}),
    // 마감 — 저장(서버)이 정하는 값과 같은 규칙(due.ts). '다음 수업'인데 아직 저장 전이라 날짜를 모르면 "다음 수업 전까지".
    ...(su?.videoHomework === true && reportDate
      ? { videoHomeworkDue: homeworkDueText(reportDate, su.videoHomeworkDue === "next" ? su.videoHomeworkDueDate : null, su.videoHomeworkDue === "next") }
      : {}),
    textbook: su?.textbook ?? "",
    specialNote,
    classNotice,
  };
}

/**
 * 진도 사실 1줄 — 진도가 중단된 날(progress-status.ts)은 **라벨을 '오늘 수업'으로 바꾼다**. '진도' 라벨로 주면
 * 모델이 "월말평가 진도를 나갔습니다"처럼 나가지도 않은 진도를 문장에 만든다. 값(`수학 월말평가`)은
 * 그대로 둔다 — 값에 괄호 설명을 달면 모델이 통째로 베낀다(아래 ⚠️ 주석의 실측 사고와 같은 벡터).
 */
function progressFact(input: ReportCommentInput, label: string): string | null {
  // 다중 차시는 **물결 축약**(progress-range.ts)으로 넘긴다 — 9차시를 그대로 주면 모델이 다 나열해
  // 학부모 본문이 목록이 된다(원장 2026-08-05: "진도를 전부 적으면 그것이야말로 스팸").
  // 접기는 사실 보존적(같은 중단원 연속만)이라 grounding이 안 깨지고, 카드 진도와 **같은 표기**가 된다.
  // 단원 번호(2-4-3)는 떼고 넘긴다 — Haiku 5.5가 번호째 학부모 글에 옮긴다(progressForMent, 2026-10-16).
  // 과목 라벨("수학")도 붙이지 않는다 — 5.5는 "수학 도수분포다각형과 상대도수를 배웠습니다"처럼 그대로 옮겼다(4.5는 알아서 뺐다).
  //   알림장이 이미 그 과목의 글이라 학부모에게 새 정보가 아니다(2026-10-16 운영 조건 시험 10건 중 8건).
  const prog = progressForMent(input.progress);
  if (!prog) return null;
  // 진도 중단일 > 수업 성격(복습·문제풀이) > 평소 '진도' 순으로 라벨이 정해진다.
  // (중단일엔 성격이 붙을 수 없다 — 나간 차시가 없으니 그 차시의 복습도 성립하지 않는다.)
  const head = isSkipStatus(input.progress)
    ? "오늘 수업"
    : progressFactLabel(label, asProgressMode(input.progressMode));
  return `${head}: ${prog}`;
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
  // 🔴 `0%`(하나도 해오지 못함)와 `미제출`(안 냄)은 **말로 갈라서** 준다 — 숫자만 주면 모델이 뒤바꿔 쓴다
  //    (2026-08-28 실측). 판정·표기는 homework-rate.ts 단일 소스(폴백 템플릿 homeworkRateClause와 같은 뜻).
  if (input.homework) facts.push(`과제: ${homeworkFactValue(flatten(input.homework))}`);
  if (input.homeworkToday) facts.push(`오늘 과제: ${flatten(input.homeworkToday)}`); // 마무리 문장 재료(0096a)
  if (input.videoHomework === true) facts.push(`오늘 영상 과제: 있음${dueClause(input)}. 오늘 과제 안내에 짧게 포함하되 이미 영상 과제를 언급했다면 반복하지 마세요. 지난 숙제의 제출 여부를 뜻하지 않습니다.`);
  if (input.specialNote) facts.push(`특이사항: ${flatten(input.specialNote)}`);
  // 소단원별 이해도(수학 보고서 시범) — 값은 '10점 만점에 N점'으로 풀어 쓴다(괄호 설명은 모델이 베낀다, 위 ⚠️).
  if (input.understanding?.length)
    facts.push(`소단원별 이해도: ${input.understanding.map((u) => `${flatten(u.title)} 10점 만점에 ${u.score}점`).join(", ")}`);
  // 반 전체 안내 — 라벨에 **취급법까지** 적는다(프롬프트 본문은 원장이 편집 가능해 사라질 수 있다).
  if (input.classNotice)
    facts.push(
      `반 전체 안내(이 반 학생 모두에게 같은 내용으로 나가는 공지 — 그대로 한 번만 전하고, 이것으로 이 아이의 모습·태도·성취를 지어내지 마세요): ${flatten(input.classNotice)}`,
    );
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
  return withTeacherNoteFidelity(interpolate(template || DEFAULT_PROMPTS.comment, { facts: buildFactBlock(input) }), input) + commentStyle(input);
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
  // ⚠️ 여기 '과제'는 **오늘 내준 숙제**다(P1 템플릿의 "오늘 과제는 ~입니다" 재료). 그래서 모드 A의
  //    `homeworkFactValue`(지난 과제 수행률을 말로 가르는 것)를 여기에 붙이면 안 된다 — 오늘 과제 자리에
  //    "하나도 해오지 못함"이 들어가 뜻이 뒤집힌다. (수행률 폴백 자체가 의미상 어색하나 모드 B는 현재 미사용.)
  const hw = flatten(input.homeworkToday || input.homework);
  if (hw) facts.push(`과제: ${hw}`);
  if (input.videoHomework === true) facts.push(`오늘 영상 과제: 있음${dueClause(input)}. 오늘 과제 안내에 한 번만 짧게 포함하세요. 지난 숙제의 제출 여부는 추측하지 마세요.`);
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
  // 반 전체 안내 — 라벨에 **취급법까지** 적는다(프롬프트 본문은 원장이 편집 가능해 사라질 수 있다).
  if (input.classNotice)
    facts.push(
      `반 전체 안내(이 반 학생 모두에게 같은 내용으로 나가는 공지 — 그대로 한 번만 전하고, 이것으로 이 아이의 모습·태도·성취를 지어내지 마세요): ${flatten(input.classNotice)}`,
    );
  return facts.length ? facts.join("\n") : null;
}

/** 모드 B P1 본문(출력 계약 없음) — 통합 호출 섹션용. 사실 없으면 null(문단 생략). */
export function commentP1Body(input: ReportCommentInput, template?: string | null): string | null {
  const p1facts = buildP1FactBlock(input);
  if (!p1facts) return null;
  return interpolate(template || DEFAULT_PROMPTS.comment_p1, { p1facts }) + commentStyle(input);
}

/** 모드 B P2 본문(출력 계약 없음). 사실 없으면 null. */
export function commentP2Body(input: ReportCommentInput, template?: string | null): string | null {
  const p2facts = buildP2FactBlock(input);
  if (!p2facts) return null;
  return withTeacherNoteFidelity(interpolate(template || DEFAULT_PROMPTS.comment_p2, { p2facts }), input) + commentStyle(input);
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
