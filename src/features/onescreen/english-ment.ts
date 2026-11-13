/**
 * 영어 수업보고서 **AI 멘트**(인사말 + 코멘트) — 프롬프트 조립·응답 해석. 순수 함수(Vitest로 잠금).
 *
 * 영어 템플릿 모드(사용자 2026-09-10)의 `{인사말}`·`{코멘트}` 칸을 채운다. 수학 멘트(`generateReportComment`)와
 * **따로** 둔 이유:
 *  · 수학 기본 프롬프트는 학생 호칭을 **금지**하고 사실 블록에 이름을 아예 싣지 않는다(prompt-defaults.ts).
 *    영어는 반대로 *"AI가 자동 생성 시 학생의 이름을 최소 1번 언급"* 이 규칙이다 — 같은 프롬프트를 고치면 수학이 바뀐다.
 *  · 출력 칸이 둘(intro·comment)이다 — 템플릿의 인사 문단과 코멘트 문단에 따로 들어간다.
 *
 * 🔴 이름은 프롬프트로 부탁하는 것만으로 "항상"이 성립하지 않는다 — 서버 액션이 생성 뒤
 *    `mentionsStudentName`으로 확인하고 한 번 다시 만든다(english-ment-actions.ts).
 * ⚠️ 사실 원칙(FACT_GUARD)은 generateJSON이 자동으로 앞에 붙인다 — 여기서는 이 멘트 고유의 금지만 적는다.
 */
import { hasBatchim } from "@/lib/text/josa";
import { givenNameOf, studentNameVariants } from "@/features/report-templates/name-mention";
import { stripMentLeaks } from "./ment-leak";

export type EnglishMentInput = {
  /** aywa 표시 이름(동명이인 접미 가능, 예 "박서연C"). */
  studentName: string;
  englishName?: string | null;
  /** 오늘 진도(여러 줄, ECS에서 온 영역 라벨 포함 가능). */
  progress: string;
  /** 오늘 숙제. */
  homeworkToday: string;
  /** 오늘 테스트(이미 사람이 읽는 문자열). */
  testText: string;
  /** 다음 시간 테스트 안내. */
  nextTest: string;
  /** 태도(한글 라벨) — 비면 "". */
  attitude: string;
  /** 과제 수행(한글 라벨) — 비면 "". */
  homework: string;
  /** 특이사항(강사 메모). */
  specialNote: string;
  /** 반 공통 메모(선택). */
  classContext?: string;
  /**
   * **반 전체 안내**(class-notice.ts가 판별 — 같은 반 특이사항이 글자까지 같으면 공지다). 개인 관찰로 넘기면
   * 반 전체 글이 서로 복사본이 된다(2026-08-13 수학 실측과 같은 함정) — 따로 라벨을 붙여 넘긴다.
   */
  classNotice?: string;
};

export type EnglishMentResult =
  | { ok: true; intro: string; comment: string; nameMissing: boolean }
  | { ok: false; error: string };

/** 사실 한 칸의 상한 — 프롬프트 비대·토큰 남용 방지(반 공통 메모는 수학과 같은 300자). */
const FACT_MAX = 600;
const CLASS_CONTEXT_MAX = 300;

/** 여러 줄 값을 한 줄로 — 줄바꿈으로 사실 블록의 라벨을 흉내 내 **다른 사실로 위장**하는 것을 막는다. */
function oneLine(v: string | null | undefined, max = FACT_MAX): string {
  return (v ?? "")
    .split(/\s*\n+\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, max)
    .trim();
}

/** 입력 정리 — 앞뒤 공백, 줄바꿈 접기, 길이 상한. 서버 액션이 AI에 보내기 전에 한 번 통과시킨다. */
export function sanitizeEnglishMentInput(input: EnglishMentInput): EnglishMentInput {
  return {
    studentName: (input.studentName ?? "").trim(),
    englishName: (input.englishName ?? "").trim() || null,
    progress: oneLine(input.progress),
    homeworkToday: oneLine(input.homeworkToday),
    testText: oneLine(input.testText),
    nextTest: oneLine(input.nextTest),
    attitude: oneLine(input.attitude),
    homework: oneLine(input.homework),
    specialNote: oneLine(input.specialNote),
    classContext: oneLine(input.classContext, CLASS_CONTEXT_MAX),
    classNotice: oneLine(input.classNotice, CLASS_CONTEXT_MAX),
  };
}

/**
 * 학생 사실이 하나라도 있는가. 반 공통 메모는 **세지 않는다** — 반 맥락만으로 개별 학생 멘트를 쓰면
 * 학생 사실 0개의 지어낸 글이 된다(수학 generateReportComment와 같은 규칙).
 */
export function hasEnglishMentFacts(input: EnglishMentInput): boolean {
  return [input.progress, input.testText, input.homeworkToday, input.nextTest, input.attitude, input.homework, input.specialNote].some(
    (v) => !!(v ?? "").trim(),
  );
}

/**
 * 글에서 부를 이름 — 성을 뗀 이름(두 글자 이상일 때), 아니면 성+이름. 동명이인 접미는 뗀다.
 * 판정은 name-mention.ts `givenNameOf` 한 곳이다 — 부르는 이름과 확인하는 이름이 갈리면 재시도가 헛돈다.
 */
export function englishMentCallName(studentName: string): string {
  return givenNameOf(studentName) ?? studentNameVariants(studentName)[0] ?? "";
}

/** "서연이는"·"지우는" — 받침에 맞춘 호칭 예시(모델이 "서연는"처럼 쓰지 않게 정답을 보여 준다). */
function callExamples(name: string): string {
  if (!name) return "";
  return hasBatchim(name) === false ? `"${name}는", "${name}가"` : `"${name}이는", "${name}이가"`;
}

export function buildEnglishMentPrompt(input: EnglishMentInput, opts: { remindName?: boolean; prevHint?: string } = {}): string {
  const s = sanitizeEnglishMentInput(input);
  const callName = englishMentCallName(s.studentName);
  const facts: string[] = [];
  const push = (label: string, value: string | undefined) => {
    if (value) facts.push(`- ${label}: ${value}`);
  };
  push("오늘 진도", s.progress);
  push("오늘 테스트", s.testText);
  push("오늘 숙제", s.homeworkToday);
  push("다음 시간 테스트", s.nextTest);
  push("수업 태도", s.attitude);
  push("과제 수행", s.homework);
  push("선생님 메모(특이사항)", s.specialNote);
  push("반 공통 메모(참고용 — 이 학생 개인의 일로 옮겨 쓰지 말 것)", s.classContext);
  push("반 전체 안내(모든 학생 공통 — 이 학생 개인의 일로 쓰지 말 것)", s.classNotice);
  // 🔴 태도·메모가 없으면 인사 문단을 비우게 한다 — '분위기·참여 모습'을 요구하면 모델이 지어낸다
  //    (영어 행은 진도·숙제만 있는 날이 흔하다, 적대 리뷰 2026-09-10). 빈 인사 문단은 템플릿에서 줄째 빠진다.
  const hasObservation = !!(s.attitude || s.specialNote);

  const lines = [
    "너는 영어 학원 선생님을 대신해 학부모님께 보내는 오늘의 수업 보고 문장을 쓴다.",
    "아래 [오늘 사실]에 적힌 것만 근거로 쓴다. 적히지 않은 활동·점수·태도·감정·일화는 지어내지 않는다.",
    "",
    "[학생]",
    `부를 이름: ${callName}`,
    "",
    "[오늘 사실]",
    ...facts,
    "",
    '[쓸 것] JSON 객체 하나로만 답한다: {"intro": "...", "comment": "..."}',
    hasObservation
      ? "- intro: 오늘 수업 태도·선생님 메모에 적힌 모습을 1~2문장으로. 적힌 것만 쓴다."
      : '- intro: 수업 태도·선생님 메모가 없으므로 빈 문자열("")로 둔다. 분위기·참여 모습을 지어내지 않는다.',
    "- comment: 오늘 배운 내용·테스트·숙제·다음 시간 테스트를 바탕으로 한 피드백 3~5문장. 마지막 문장은 가정에서의 격려나 지도를 정중히 부탁하는 말로 끝낸다.",
    `- 학생 이름 "${callName}"을(를) intro와 comment를 합쳐 최소 1번, 많아야 3번 자연스럽게 부른다(예: ${callExamples(callName)}).`,
    "- 학부모님께 드리는 존댓말(~습니다·~했습니다)로 따뜻하고 정중하게 쓴다.",
    '- 인사말("안녕하세요")·끝인사·서명은 쓰지 않는다(앞뒤 문구는 따로 붙는다).',
    "- 마크다운·글머리표·이모지·굵게 표시를 쓰지 않는다.",
    "- 사실에 없는 숫자·백분율·점수를 새로 만들지 않는다. 사실에 적힌 표기(교재명·단원·범위)는 철자 그대로 옮긴다.",
    "- [오늘 사실]에 없는 항목은 언급하지 않는다(\"정보 없음\" 같은 말도 쓰지 않는다).",
  ];
  // 직전 보고서 표현(사실 아님) — 매번 같은 말이 나가지 않게(원장 2026-10-26). 서버가 항목 보고서일 때만 넘긴다.
  if (opts.prevHint?.trim()) lines.push("", opts.prevHint.trim());
  if (opts.remindName) {
    lines.push("", `⚠️ 직전 답에 학생 이름 "${callName}"이(가) 빠졌습니다. 이번에는 반드시 한 번 이상 넣으세요.`);
  }
  return lines.join("\n");
}

/** 한 칸 정리 — 앞뒤 공백, 줄머리 글머리표, 마크다운 굵게, 3줄 이상 빈 줄. */
function cleanField(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    // 줄바꿈은 LF 하나로 — CR이 섞인 AI 글이 세션에 남으면 템플릿 지문 비교가 흔들린다(english-draft.ts, 적대 재리뷰 2026-09-11).
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*|__/g, "")
    .replace(/^[ \t]*(?:[-*•·]|\d+[.)])[ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** AI 응답 해석 — 모양이 틀리거나 두 칸 다 비면 null. */
export function parseEnglishMent(data: unknown): { intro: string; comment: string } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  // 혼잣말·지시 되받기·찌꺼기 문장은 뺀다(원장 2026-11-12, `ment-leak.ts`) — 코멘트가 다 빠지면 아래에서 실패로.
  const intro = stripMentLeaks(cleanField(rec.intro)).text;
  const comment = stripMentLeaks(cleanField(rec.comment)).text;
  // 🔴 코멘트가 없으면 실패로 본다 — 인사말만 온 결과를 받으면 코멘트 문단이 빠진 글이 '다 썼다'로 통과한다
  //    (인사말은 태도·메모가 없으면 일부러 비우는 칸이라 없어도 되지만, 코멘트는 글의 본문이다. 적대 재리뷰 2026-09-10).
  if (!comment) return null;
  return { intro, comment };
}
