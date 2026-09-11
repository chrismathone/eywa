import { describe, expect, it } from "vitest";
import {
  BUILTIN_ENGLISH_JJ_TEMPLATE,
  BUILTIN_ENGLISH_TEMPLATE,
  type ReportTemplate,
} from "@/features/report-templates/defaults";
import { textHash } from "@/features/report-templates/provenance";
import {
  aiFactsHashOf,
  canRecompose,
  composeEnglishDraft,
  needsAiFirst,
  pendingNeedsAi,
  findTemplateIn,
  isAiStale,
  isNameMissing,
  isTemplateStale,
  isTextOutdated,
  factTokensOf,
  outputAckKey,
  refreshFactsKey,
  templateFactsKey,
  isUntouchedTemplateDraft,
  slotFactsFor,
  templateImageSlots,
  templateNeedsAi,
  type EnglishRowFacts,
} from "./english-draft";

const FACTS: EnglishRowFacts = {
  studentName: "김민준",
  teacherName: "이수진",
  progress: "Unit 3 Reading",
  homeworkToday: "WB p.30",
  dailyTest: "20문제 중 18개 맞음",
  checkTest: "",
  attitude: "적극적",
  homework: "90%",
  note: "",
};
const AI = { aiIntro: "민준이는 오늘 집중을 잘했어요.", aiComment: "민준이가 단어를 꾸준히 외우고 있어요." };
const NO_AI: ReportTemplate = { id: "u1", name: "짧게", body: "{학생} 진도: {진도}\n테스트: {테스트}", builtIn: false };

function filled(template: ReportTemplate, facts = FACTS, parts = AI) {
  const draft = composeEnglishDraft(template, facts, parts);
  return { ...parts, draft, templateHash: textHash(draft) };
}

describe("isUntouchedTemplateDraft", () => {
  it("템플릿이 만든 글 그대로면 true, 한 글자라도 고치면 false", () => {
    const rep = filled(BUILTIN_ENGLISH_TEMPLATE);
    expect(isUntouchedTemplateDraft(rep)).toBe(true);
    expect(isUntouchedTemplateDraft({ ...rep, draft: rep.draft + " 감사합니다" })).toBe(false);
  });
  it("🔴 가져온 글·옛 글(지문 없음)은 템플릿 글이 아니다 — draft===autoDraft여도", () => {
    expect(isUntouchedTemplateDraft({ draft: "어제 글", templateHash: undefined })).toBe(false);
  });
});

describe("isTemplateStale", () => {
  it("점수를 고치면 stale, 그대로면 아님", () => {
    const rep = filled(BUILTIN_ENGLISH_TEMPLATE);
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, rep)).toBe(false);
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, { ...FACTS, dailyTest: "20문제 중 15개 맞음" }, rep)).toBe(true);
  });
  it("글을 손봤어도 칸이 그대로면 stale 아님", () => {
    const rep = filled(BUILTIN_ENGLISH_TEMPLATE);
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, { ...rep, draft: "고친 글" })).toBe(false);
  });
  it("채운 적이 없으면 false", () => {
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, { draft: "직접 쓴 글" })).toBe(false);
  });
});

describe("isAiStale", () => {
  const rep = { ...filled(BUILTIN_ENGLISH_TEMPLATE), aiFactsHash: aiFactsHashOf(FACTS, "") };
  it("AI를 쓴 뒤 점수가 바뀌면 경고", () => {
    expect(isAiStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, rep)).toBe(false);
    expect(isAiStale(BUILTIN_ENGLISH_TEMPLATE, { ...FACTS, dailyTest: "20문제 중 15개 맞음" }, rep)).toBe(true);
  });
  it("강사가 AI 문장을 직접 고쳐 썼으면(글에 그 문장이 없으면) 경고하지 않는다", () => {
    const changed = { ...FACTS, dailyTest: "20문제 중 15개 맞음" };
    expect(isAiStale(BUILTIN_ENGLISH_TEMPLATE, changed, { ...rep, draft: "직접 다시 쓴 글" })).toBe(false);
  });
  it("다음 시간 테스트를 바꿔도 경고", () => {
    expect(isAiStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, { ...rep, nextTest: "단어 81~90" })).toBe(true);
  });
  it("AI 칸이 없는 템플릿·AI 글이 없으면 경고하지 않는다", () => {
    expect(isAiStale(NO_AI, { ...FACTS, dailyTest: "x" }, rep)).toBe(false);
    expect(isAiStale(BUILTIN_ENGLISH_TEMPLATE, { ...FACTS, dailyTest: "x" }, { ...rep, aiIntro: "", aiComment: "" })).toBe(false);
  });
});

describe("isNameMissing", () => {
  it("AI 글이 있고 이름이 없으면 경고", () => {
    const parts = { aiIntro: "오늘 집중을 잘했어요.", aiComment: "단어를 꾸준히 외워요." };
    const noName: ReportTemplate = { ...BUILTIN_ENGLISH_TEMPLATE, id: "u2", body: "{인사말}\n{코멘트}" };
    expect(isNameMissing(noName, filled(noName, FACTS, parts), FACTS.studentName)).toBe(true);
    expect(isNameMissing(noName, filled(noName), FACTS.studentName)).toBe(false);
  });
  it("AI 문장을 전부 고쳐 썼으면 이름 경고도 거둔다", () => {
    const parts = { aiIntro: "오늘 집중을 잘했어요.", aiComment: "단어를 꾸준히 외워요." };
    const noName: ReportTemplate = { ...BUILTIN_ENGLISH_TEMPLATE, id: "u2", body: "{인사말}\n{코멘트}" };
    const rep = { ...filled(noName, FACTS, parts), draft: "직접 다시 쓴 글" };
    expect(isNameMissing(noName, rep, FACTS.studentName)).toBe(false);
  });
  it("AI 칸 없는 템플릿이면 이름이 없어도 경고하지 않는다", () => {
    const body: ReportTemplate = { ...NO_AI, body: "진도: {진도}" };
    expect(isNameMissing(body, filled(body), FACTS.studentName)).toBe(false);
  });
});

describe("canRecompose · needsAiFirst", () => {
  const noAiParts = { aiIntro: "", aiComment: "" };
  it("🔴 AI 칸 템플릿인데 AI 글이 없으면 다시 짜지 않고 '자동작성' 상태가 된다 — 칸이 바뀐 표시는 숨기지 않는다", () => {
    const rep = filled(NO_AI, FACTS, noAiParts);
    expect(canRecompose(NO_AI, rep)).toBe(true);
    expect(canRecompose(BUILTIN_ENGLISH_TEMPLATE, rep)).toBe(false);
    expect(needsAiFirst(BUILTIN_ENGLISH_TEMPLATE, rep)).toBe(true);
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, FACTS, rep)).toBe(true);
  });
  it("🔴 고른 템플릿은 대기로 둔다 — 글의 템플릿으로는 지금 점수로 다시 짤 수 있어 옛 점수가 안 나간다", () => {
    const rep = filled(NO_AI, FACTS, noAiParts);
    expect(pendingNeedsAi(BUILTIN_ENGLISH_TEMPLATE, rep)).toBe(true);
    expect(pendingNeedsAi(null, rep)).toBe(false);
    expect(pendingNeedsAi(NO_AI, rep)).toBe(false);
    const changed = { ...FACTS, dailyTest: "20문제 중 15개 맞음" };
    expect(canRecompose(NO_AI, rep)).toBe(true);
    expect(composeEnglishDraft(NO_AI, changed, rep)).toContain("15개");
  });
  it("대기칸이 있으면 다시 채우기로 풀리므로 '자동작성' 상태가 아니다", () => {
    const rep = { ...filled(NO_AI, FACTS, noAiParts), pendingAi: { intro: "a", comment: "b" } };
    expect(needsAiFirst(BUILTIN_ENGLISH_TEMPLATE, rep)).toBe(false);
  });
  it("손으로 쓴 글(지문 없음)엔 띄우지 않는다", () => {
    expect(needsAiFirst(BUILTIN_ENGLISH_TEMPLATE, { draft: "직접 쓴 글" })).toBe(false);
  });
});

describe("isTextOutdated — 글이 옛 칸 값을 담고 있는데 자동으로 못 맞추는가", () => {
  const withKey = (tpl: ReportTemplate, parts = AI) => ({
    ...filled(tpl, FACTS, parts),
    composedFactsHash: templateFactsKey(FACTS, ""),
  });
  const changed = { ...FACTS, dailyTest: "20문제 중 15개 맞음" };
  it("🔴 템플릿을 못 찾으면(삭제·목록 실패) 칸이 바뀐 글은 경고 대상", () => {
    expect(isTextOutdated(null, changed, withKey(NO_AI))).toBe(true);
    expect(isTextOutdated(null, FACTS, withKey(NO_AI))).toBe(false);
  });
  it("템플릿이 있고 다시 짤 수 있으면 저장이 맞추므로 경고하지 않는다", () => {
    expect(isTextOutdated(NO_AI, changed, withKey(NO_AI))).toBe(false);
  });
  it("🔴 AI 칸 템플릿인데 AI 글이 없으면(다시 못 짬) 경고 대상", () => {
    const rep = withKey(NO_AI, { aiIntro: "", aiComment: "" });
    expect(isTextOutdated(BUILTIN_ENGLISH_TEMPLATE, changed, rep)).toBe(true);
  });
  it("고친 글도 칸이 바뀌면 경고 대상 · 지문이 없으면(옛 세션) 판정하지 않는다", () => {
    expect(isTextOutdated(NO_AI, changed, { ...withKey(NO_AI), draft: "고친 글" })).toBe(true);
    expect(isTextOutdated(NO_AI, changed, { draft: "옛 글" })).toBe(false);
  });
  it("🔑 템플릿에 없는 칸이 바뀐 것은 세지 않는다 — 템플릿을 못 찾아도 같은 칸들로 센다", () => {
    const rep = {
      ...filled(NO_AI),
      draft: "고친 글",
      composedFactsHash: templateFactsKey(FACTS, "", factTokensOf(NO_AI)),
    };
    // NO_AI엔 {다음테스트}·{숙제}가 없다 — 그 값이 바뀌어도 이 글은 옛 값을 담고 있지 않다.
    expect(isTextOutdated(null, FACTS, { ...rep, nextTest: "단어 81~90" })).toBe(false);
    expect(isTextOutdated(null, { ...FACTS, homeworkToday: "WB p.40" }, rep)).toBe(false);
    expect(isTextOutdated(null, changed, rep)).toBe(true);
  });
  it("🔴 '그대로 내보낸다' 확인은 지문을 바꾸지 않고 따로 적는다 — 칩은 남고, 값이 또 바뀌면 다시 묻는다", () => {
    const rep = { ...withKey(NO_AI), draft: "고친 글" };
    const acked = { ...rep, outputAck: outputAckKey(rep, changed) };
    expect(isTextOutdated(NO_AI, changed, acked)).toBe(true); // 칩(판정)은 그대로
    expect(acked.outputAck).toBe(outputAckKey(acked, changed)); // 같은 값이면 확인을 되풀이하지 않는다
    expect(acked.outputAck).not.toBe(outputAckKey(acked, { ...changed, dailyTest: "20문제 중 10개 맞음" }));
    expect(refreshFactsKey({ draft: "옛 글" }, changed)).toBeUndefined();
  });
  it("옛 형식 지문(칸 목록 없음)도 해시로 비교한다", () => {
    const hashOnly = templateFactsKey(FACTS, "").split(":")[1];
    const old = { ...filled(NO_AI), draft: "고친 글", composedFactsHash: hashOnly };
    expect(isTextOutdated(null, FACTS, old)).toBe(false);
    expect(isTextOutdated(null, changed, old)).toBe(true);
  });
});

describe("templateNeedsAi · findTemplateIn", () => {
  it("AI 칸 유무", () => {
    expect(templateNeedsAi(BUILTIN_ENGLISH_TEMPLATE)).toBe(true);
    expect(templateNeedsAi(NO_AI)).toBe(false);
  });
  it("지워진 템플릿은 null, 비었거나 기본 id면 기본", () => {
    expect(findTemplateIn([NO_AI], "gone", BUILTIN_ENGLISH_TEMPLATE)).toBeNull();
    expect(findTemplateIn([NO_AI], undefined, BUILTIN_ENGLISH_TEMPLATE)).toBe(BUILTIN_ENGLISH_TEMPLATE);
    expect(findTemplateIn([NO_AI], "u1", BUILTIN_ENGLISH_TEMPLATE)).toBe(NO_AI);
  });
  it("🔑 기본 템플릿은 목록을 못 받아도 찾는다(코드가 주는 것 — 사라질 수 없다)", () => {
    expect(findTemplateIn([], BUILTIN_ENGLISH_JJ_TEMPLATE.id, BUILTIN_ENGLISH_TEMPLATE)).toBe(BUILTIN_ENGLISH_JJ_TEMPLATE);
  });
});

describe("그림 칸(인재원 시험 결과지·학습 분석지, 2026-09-11)", () => {
  const JJ = BUILTIN_ENGLISH_JJ_TEMPLATE;
  const withSlots = (slots: EnglishRowFacts["slots"]): EnglishRowFacts => ({ ...FACTS, slots });
  const none = withSlots({ 시험결과지: false, 학습분석지: false });
  const exam = withSlots({ 시험결과지: true, 학습분석지: false });

  it("자료가 있으면 자리 줄이 글에 남고, 없으면 빠진다", () => {
    expect(composeEnglishDraft(JJ, exam, AI)).toContain("[시험결과지]");
    expect(composeEnglishDraft(JJ, exam, AI)).not.toContain("[학습분석지]");
    expect(composeEnglishDraft(JJ, none, AI)).not.toContain("[");
  });

  it("🔑 자료가 생기면 템플릿 글은 stale — 손대지 않은 글은 저장이 다시 짜고, 고친 글은 확인을 묻는다", () => {
    const rep = { ...filled(JJ, none), composedFactsHash: templateFactsKey(none, "", factTokensOf(JJ)) };
    expect(factTokensOf(JJ)).toEqual(expect.arrayContaining(["시험결과지", "학습분석지"]));
    expect(isTemplateStale(JJ, exam, rep)).toBe(true);
    expect(canRecompose(JJ, rep)).toBe(true);
    expect(isTextOutdated(JJ, exam, rep)).toBe(false); // 저장 직전 재조립이 맞춘다
    expect(isTextOutdated(JJ, exam, { ...rep, draft: "고친 글" })).toBe(true); // 고친 글은 못 맞춘다 → 묻는다
    expect(isTextOutdated(JJ, none, { ...rep, draft: "고친 글" })).toBe(false); // 자료 그대로면 묻지 않는다
  });

  it("그림 칸이 없는 템플릿은 그림 자료가 바뀌어도 흔들리지 않는다(지문 모양 그대로)", () => {
    expect(factTokensOf(BUILTIN_ENGLISH_TEMPLATE)).not.toContain("시험결과지");
    const rep = {
      ...filled(BUILTIN_ENGLISH_TEMPLATE),
      composedFactsHash: templateFactsKey(FACTS, "", factTokensOf(BUILTIN_ENGLISH_TEMPLATE)),
    };
    const all = withSlots({ 시험결과지: true, 학습분석지: true });
    expect(isTemplateStale(BUILTIN_ENGLISH_TEMPLATE, all, rep)).toBe(false);
    expect(isTextOutdated(BUILTIN_ENGLISH_TEMPLATE, all, { ...rep, draft: "고친 글" })).toBe(false);
  });

  it("🔴 slotFactsFor — 모르면 기준 글 그대로(중립): 자료가 오기 전의 재조립이 그림 줄을 지우지 않는다", () => {
    const text = composeEnglishDraft(JJ, withSlots({ 시험결과지: true, 학습분석지: true }), AI);
    const neutral = slotFactsFor(null, text);
    expect(neutral).toEqual({ 시험결과지: true, 학습분석지: true });
    expect(composeEnglishDraft(JJ, withSlots(neutral), AI)).toBe(text);
    expect(slotFactsFor(null, "그림 없는 글")).toEqual({ 시험결과지: false, 학습분석지: false });
    // 알면 아는 대로(기준 글과 달라도).
    expect(slotFactsFor({ 시험결과지: false, 학습분석지: true }, text)).toEqual({ 시험결과지: false, 학습분석지: true });
  });

  it("templateImageSlots — 그림 칸 템플릿만 인재원 자료를 먼저 받는다", () => {
    expect(templateImageSlots(JJ)).toEqual(["시험결과지", "학습분석지"]);
    expect(templateImageSlots(BUILTIN_ENGLISH_TEMPLATE)).toEqual([]);
  });
});
