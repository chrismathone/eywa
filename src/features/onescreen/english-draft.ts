/**
 * 영어 행 글의 **조립과 판정** — 순수 함수(Vitest로 잠금). 원스크린 클라이언트는 칸 값을 모아 넘기기만 한다.
 *
 * 판정 넷이 모두 여기 있다 — 화면 배지와 저장 직전 재조립이 같은 답을 내야 해서다(적대 재리뷰 2026-09-10).
 *   · `isUntouchedTemplateDraft` — 템플릿이 마지막으로 만든 글 **그대로**인가(저장·복사 직전 다시 조립해도 되는가)
 *   · `isTemplateStale` — 템플릿·칸 값이 마지막으로 채운 때와 달라졌는가('다시 채우기' 권유)
 *   · `isAiStale` — AI 인사말·코멘트가 지금 칸 값과 다른 사실로 쓰였는가(저장해도 안 사라지는 경고)
 *   · `isNameMissing` — AI가 쓴 글에 학생 이름이 없는가
 * 🔴 "손대지 않은 글"을 `draft === autoDraft`로 판정하지 말 것 — '이전 회차 가져오기'로 넣은 글도 같은 모양이라
 *    저장 직전 템플릿으로 다시 조립되며 가져온 글이 조용히 사라진다. 지문(`templateHash`)과만 비교한다.
 */
import { fillReportTemplate, templateTokens } from "@/features/report-templates/fill";
import {
  BUILTIN_ENGLISH_TEMPLATES,
  SHEET_TOKEN_KEYS,
  TEMPLATE_AI_TOKENS,
  TEMPLATE_DECORATION_TOKENS,
  type ReportTemplate,
} from "@/features/report-templates/defaults";
import {
  IMAGE_SLOT_KEYS,
  imageSlotMarker,
  usedImageSlots,
  type ImageSlotKey,
} from "@/features/report-templates/image-slots";
import { withoutAttachmentLines } from "@/features/report-templates/attachment-lines";
import { englishTemplateValues, englishTestText } from "@/features/report-templates/values";
import { mentionsStudentName } from "@/features/report-templates/name-mention";
import { englishFactsKey, textHash, type EnglishFacts } from "@/features/report-templates/provenance";
import { englishSheetValues } from "./english-sheet";
import { monthlyEvalMarker, type MonthlyEval } from "@/features/report-templates/monthly-eval";
import { progressWithMode } from "./progress-mode";

/** 한 행의 사실 — 이미 사람이 읽는 표기(buildReportFields 결과·행 평가값)를 그대로 받는다. */
export type EnglishRowFacts = {
  studentName: string;
  teacherName: string;
  progress: string;
  homeworkToday: string;
  dailyTest: string;
  checkTest: string;
  attitude: string;
  homework: string;
  note: string;
  /**
   * 그림 자리마다 그릴 인재원 자료가 있는가(2026-09-11) — `slotFactsFor`로 만든다. 없으면(옛 호출) 그림 칸은 빈 값.
   * 🔑 이것도 '사실'이다: 자료가 생기거나 사라지면 템플릿 글 그대로인 글은 저장 직전 다시 짜이고, 고친 글엔 칩이 선다.
   */
  slots?: Partial<Record<ImageSlotKey, boolean>>;
  /** 진도 칸의 복습·문제풀이(progress-mode.ts) — `{진도}` 아래에 그날 수업 성격 한 줄이 붙는다(원장 2026-10-26). */
  progressMode?: string | null;
  /** 그날 출결 문장(attendance-sentence.ts, 2026-10-26) — 항목 보고서의 '출결' 칸. 출결 기록이 없으면 "". */
  attendance?: string;
  /** 그 반의 Monthly Test 점수(2026-11-05, EiE 월간 보고서 — 로스터가 읽어 행에 싣는다). 없으면 `{월간평가}` 줄이 빠진다. */
  monthly?: MonthlyEval | null;
};

/**
 * 영어 자동작성 한 행의 결과 — 일괄 작성이 토스트를 **모아서** 알리게 상태로 돌려준다(행마다 띄우면 30개가 쌓인다).
 * `loading`·`ai_failed`·`edited`·`cancelled` = 글을 안 바꾼 행(따로 다시 눌러야 한다) · `template_fallback` = 기본 템플릿으로 채움.
 * (`cancelled` = 고친 글을 덮을지 물었는데 강사가 취소 — 일괄 작성은 글 있는 행을 건너뛰므로 묻지 않는다.)
 */
export type EnglishGenStatus = "ok" | "template_fallback" | "loading" | "ai_failed" | "edited" | "cancelled";

/** 행 보고서 중 이 판정이 읽는 칸(SubjectReport의 부분집합). */
export type EnglishRowReport = {
  draft?: string;
  nextTest?: string;
  aiIntro?: string;
  aiComment?: string;
  templateHash?: string;
  aiFactsHash?: string;
  /** 지금 글을 짤 때 쓴 칸 값의 지문(templateFactsKey) — 템플릿과 무관하게 "글이 옛 값을 담고 있나"를 판정한다. */
  composedFactsHash?: string;
  /** 강사가 '그대로 내보낸다'고 확인한 시점의 값(outputAckKey) — 확인 창만 이것을 본다(지문·칩은 그대로). */
  outputAck?: string;
  /** 작성 중 수정으로 글에 못 넣고 받아 둔 AI 글(화면 메모리 전용) — 있으면 '다시 채우기'로 풀린다. */
  pendingAi?: { intro: string; comment: string };
};

export function findTemplateIn(
  list: readonly ReportTemplate[],
  templateId: string | undefined,
  builtin: ReportTemplate,
): ReportTemplate | null {
  if (!templateId || templateId === builtin.id) return builtin;
  // 기본 템플릿은 목록을 못 받아도(표 없음·조회 실패) 언제나 찾는다 — 코드가 주는 것이라 사라질 수 없다.
  return BUILTIN_ENGLISH_TEMPLATES.find((tp) => tp.id === templateId) ?? list.find((tp) => tp.id === templateId) ?? null;
}

/** 템플릿에 AI 칸(인사말·코멘트)이 하나라도 있는가 — 없으면 AI를 부르지 않는다. */
export function templateNeedsAi(template: ReportTemplate): boolean {
  return templateTokens(template.body).some((k) => (TEMPLATE_AI_TOKENS as readonly string[]).includes(k));
}

export function composeEnglishDraft(
  template: ReportTemplate,
  facts: EnglishRowFacts,
  parts: Pick<EnglishRowReport, "nextTest" | "aiIntro" | "aiComment">,
): string {
  const values = englishTemplateValues({
    studentName: facts.studentName,
    teacherName: facts.teacherName,
    progress: progressWithMode(facts.progress, facts.progressMode),
    homeworkToday: facts.homeworkToday,
    tests: { daily: facts.dailyTest, check: facts.checkTest },
    nextTest: parts.nextTest ?? "",
    aiIntro: parts.aiIntro ?? "",
    aiComment: parts.aiComment ?? "",
    slots: facts.slots,
    // 항목 보고서 칸(2026-10-26) — 수학 새 보고서와 같은 문장(english-sheet.ts). 이 칸을 안 쓰는 템플릿엔 영향 없다.
    sheet: englishSheetValues(facts),
    monthly: facts.monthly ?? null,
  });
  // 줄바꿈은 LF 하나로 — AI 문장에 CR이 섞이면 첨부 줄을 넣고 뺄 때 글이 한 글자 달라져 지문이 영영 안 맞는다(적대 리뷰 2026-09-11).
  return fillReportTemplate(template.body, values, { decorationTokens: TEMPLATE_DECORATION_TOKENS }).text.replace(
    /\r\n?/g,
    "\n",
  );
}

/**
 * 템플릿 글의 **지문** — 첨부 자리 줄(`[첨부: …]`)을 뺀 글로 센다(강사가 넣은 줄이든 옛 템플릿이 품은 줄이든 같은 규칙).
 * 🔴 지문을 **쓰는** 곳(onescreen-client 재조립 셋)과 **비교하는** 곳(`isUntouchedTemplateDraft`·`isTemplateStale`)이 이 함수 하나를
 *    쓴다 — 한쪽만 첨부 줄을 빼면 그 행은 영영 '고친 글'이 된다(적대 리뷰 2026-09-11). 첨부 줄이 없는 글이면 예전 지문과 같다.
 */
export function templateHashOf(text: string): string {
  return textHash(withoutAttachmentLines(text));
}

/** AI에 넘기는 사실(지문 재료) — 생성할 때와 확인할 때 **같은 함수**로 만든다. */
export function aiFactsOf(facts: EnglishRowFacts, nextTest: string): EnglishFacts {
  return {
    // 복습·문제풀이를 골랐으면 그 한 줄까지(템플릿 글과 같은 값) — AI 코멘트가 "진도를 나갔다"고 거꾸로 쓰지 않게.
    progress: progressWithMode(facts.progress, facts.progressMode),
    testText: englishTestText({ daily: facts.dailyTest, check: facts.checkTest }),
    homeworkToday: facts.homeworkToday,
    nextTest,
    attitude: facts.attitude,
    homework: facts.homework,
    specialNote: facts.note,
  };
}

export function aiFactsHashOf(facts: EnglishRowFacts, nextTest: string): string {
  return englishFactsKey(aiFactsOf(facts, nextTest));
}

/**
 * 템플릿 칸 중 '사실'(사람이 읽는 칸 값) 칸 — 이 값들이 바뀌면 글이 옛 값을 담게 된다. 순서 고정.
 * 🔑 그림 칸(2026-09-11)도 사실이다 — 인재원 자료가 생기거나 사라지면 그 줄이 글에 들고 나야 한다. **뒤에 붙인다**:
 *    칸 목록이 없는 옛 형식 지문은 앞 여섯 칸으로 셌으므로(LEGACY) 그 뜻을 바꾸지 않는다.
 */
const LEGACY_FACT_TOKENS = ["학생", "작성자", "진도", "테스트", "숙제", "다음테스트"] as const;
// 항목 칸(2026-10-26)도 사실이다 — 점수·태도·출결이 바뀌면 그 문장이 바뀐다. 역시 **뒤에** 붙인다(앞 칸들의 뜻 불변).
// 단어백분위·학습배지(2026-10-26)도 맨 뒤 — 이 칸을 안 쓰는 템플릿의 지문은 그대로다(쓰는 칸만 센다).
// 월간평가(2026-11-05)도 맨 뒤 — 성적을 고치면 그 줄이 바뀌니 사실이다(이 칸을 안 쓰는 템플릿의 지문은 그대로).
const FACT_TOKENS = [...LEGACY_FACT_TOKENS, "시험결과지", "학습분석지", ...SHEET_TOKEN_KEYS, "단어백분위", "학습배지", "월간평가"] as const;
export type FactToken = (typeof FACT_TOKENS)[number];

function factValue(token: FactToken, facts: EnglishRowFacts, nextTest: string): string {
  switch (token) {
    case "학생":
      return facts.studentName;
    case "작성자":
      return facts.teacherName;
    case "진도":
      // 글에 들어간 값 그대로(성격 한 줄 포함) — 알약을 바꾸면 '칸이 바뀜'으로 읽혀야 한다.
      return progressWithMode(facts.progress, facts.progressMode);
    case "테스트":
      return englishTestText({ daily: facts.dailyTest, check: facts.checkTest });
    case "숙제":
      return facts.homeworkToday;
    case "다음테스트":
      return nextTest;
    case "시험결과지":
    case "학습분석지":
    case "단어백분위":
    case "학습배지":
      return facts.slots?.[token] ? imageSlotMarker(token) : "";
    case "월간평가":
      return facts.monthly ? monthlyEvalMarker(facts.monthly) : "";
    default:
      return englishSheetValues(facts)[token];
  }
}

/** 이 템플릿이 실제로 쓰는 사실 칸(고정 순서). */
export function factTokensOf(template: ReportTemplate): FactToken[] {
  const used = new Set<string>(templateTokens(template.body));
  return FACT_TOKENS.filter((k) => used.has(k));
}

/**
 * 이 템플릿이 특이사항을 **원문 그대로**(`{한마디}` — 사랑의 한마디) 싣는가. 그러면 AI에는 특이사항을 주지 않는다 —
 * 주면 AI 코멘트가 같은 말을 한 번 더 써서 한 글에 두 번 나간다(수학 새 보고서와 같은 규칙: 한마디는 AI에 안 준다).
 */
export function templateCarriesNote(template: ReportTemplate): boolean {
  return factTokensOf(template).includes("한마디");
}

/**
 * 월간 점수 칸(`{월간평가}`)을 쓰는 템플릿인데 이 행에 Monthly Test 점수가 없는가 — 그러면 점수 줄 없이 코멘트만 들어가
 * 자동작성이 "아무 반응 없음"처럼 보인다(원장 2026-11-05 제보). 화면이 까닭을 알린다.
 */
export function monthlyScoresMissing(template: ReportTemplate, facts: EnglishRowFacts): boolean {
  return factTokensOf(template).includes("월간평가") && !facts.monthly;
}

/** 이 템플릿이 쓰는 그림 칸(고정 순서) — 있으면 자동작성·다시 채우기가 인재원 자료를 **먼저** 받는다. */
export function templateImageSlots(template: ReportTemplate): ImageSlotKey[] {
  const used = new Set<string>(templateTokens(template.body));
  return IMAGE_SLOT_KEYS.filter((k) => used.has(k));
}

/**
 * 그림 자리 사실 — 인재원 자료를 **알면** 그 가용성, **모르면**(아직 안 받음·받다 실패) 기준 글에 그 줄이 있었는지 그대로.
 * 🔴 모를 때 "없음"으로 치면 저장·복사 직전 재조립이 그림 줄을 **조용히 지운다**(자료가 오기 전에 저장을 누른 행 ·
 *    카드를 한 번도 안 연 표 행 · 새로 고친 뒤의 행). 그래서 모를 땐 판정을 **중립**으로 둔다 — 재조립도 칩도
 *    자료가 도착하기 전엔 움직이지 않는다.
 * 🔑 기준 글 = 자동작성이 마지막으로 넣은 글(autoDraft) → 없으면 지금 글. 강사가 그 줄을 지운 글이라도 기준이
 *    자동 글이라 '칸이 바뀜'이 거짓으로 서지 않는다.
 */
export function slotFactsFor(
  known: Readonly<Partial<Record<ImageSlotKey, boolean>>> | null,
  baselineText: string,
): Record<ImageSlotKey, boolean> {
  if (known) return Object.fromEntries(IMAGE_SLOT_KEYS.map((k) => [k, !!known[k]])) as Record<ImageSlotKey, boolean>;
  const had = new Set(usedImageSlots(baselineText));
  return Object.fromEntries(IMAGE_SLOT_KEYS.map((k) => [k, had.has(k)])) as Record<ImageSlotKey, boolean>;
}

/**
 * 템플릿 글에 **실제로 들어간** 칸 값만의 지문 — "이 글이 어느 칸 값으로 짜였나". 형식은 `칸,칸:해시`라 템플릿을 못 찾아도
 * (삭제) 같은 칸들로 다시 셀 수 있다. 🔑 템플릿에 없는 칸(예: `{다음테스트}`가 없는 템플릿의 다음 시간 테스트)이 바뀐 것은
 * 글과 무관하므로 세지 않는다(세면 풀 수 없는 경고가 매번 떠 OK만 누르게 된다, 적대 재리뷰 2026-09-10).
 */
export function templateFactsKey(
  facts: EnglishRowFacts,
  nextTest: string,
  tokens: readonly FactToken[] = LEGACY_FACT_TOKENS,
): string {
  const norm = (v: string) => (v ?? "").replace(/\s+/g, " ").trim();
  return `${tokens.join(",")}:${textHash(tokens.map((k) => norm(factValue(k, facts, nextTest))).join("␞"))}`;
}

/** 저장된 지문이 센 칸들(형식이 다르면 모든 칸). */
function tokensOfKey(key: string): FactToken[] {
  const i = key.indexOf(":");
  // 옛 형식(칸 목록 없음)은 그림 칸이 생기기 전 여섯 칸으로 셌다 — 뜻을 바꾸면 옛 글이 전부 '옛 값'이 된다.
  if (i < 0) return [...LEGACY_FACT_TOKENS];
  const listed = new Set(key.slice(0, i).split(",").filter(Boolean));
  return FACT_TOKENS.filter((k) => listed.has(k));
}

/**
 * 저장된 지문과 **같은 칸들·같은 형식**으로 지금 값을 다시 센 지문 — 같으면 글이 지금 값을 담고 있다. 지문이 없으면 undefined.
 * 옛 형식(칸 목록 없이 해시만)이면 해시 부분만 돌려준다(안 그러면 영영 '옛 값'으로 읽힌다).
 */
export function refreshFactsKey(rep: EnglishRowReport | undefined, facts: EnglishRowFacts): string | undefined {
  if (!rep?.composedFactsHash) return undefined;
  const key = templateFactsKey(facts, rep.nextTest ?? "", tokensOfKey(rep.composedFactsHash));
  return rep.composedFactsHash.includes(":") ? key : key.slice(key.indexOf(":") + 1);
}

/**
 * 강사가 '그대로 보낼/저장할/복사할까요?'에 **예**라고 답한 시점의 값 — 이 값이 그대로인 동안만 같은 확인을 되풀이하지 않는다.
 * 🔴 지문(composedFactsHash·aiFactsHash)을 갈아 끼우지 않는다 — 갈아 끼웠더니 AI 글이 어느 값으로 쓰였는지가 지워져
 *    칩이 영영 사라지고, 다시 채우기로 옛 코멘트가 든 글이 경고 없이 새로 짜였다(적대 재리뷰 2026-09-10).
 */
export function outputAckKey(rep: EnglishRowReport | undefined, facts: EnglishRowFacts): string {
  return `${refreshFactsKey(rep, facts) ?? ""}|${aiFactsHashOf(facts, rep?.nextTest ?? "")}`;
}

/**
 * 글이 **옛 칸 값**을 담고 있는데 저장·복사가 자동으로 못 맞추는가 — 발송·저장·복사·링크 전에 물을 조건.
 * 템플릿이 없어졌거나(삭제·목록 실패), AI 칸 템플릿인데 AI 글이 없거나, 강사가 글을 고친 뒤 칸을 바꾼 경우다.
 * 🔴 판정은 템플릿과 무관한 지문(composedFactsHash)으로 한다 — 못 찾은 템플릿으로 다시 짜 비교하면 판정 자체가
 *    안 서서, 옛 점수가 경고 없이 저장·복사됐다(적대 재리뷰 2026-09-10). 지문이 없으면(옛 세션) 판정하지 않는다.
 */
export function isTextOutdated(
  template: ReportTemplate | null,
  facts: EnglishRowFacts,
  rep: EnglishRowReport | undefined,
): boolean {
  if (!rep?.composedFactsHash || !rep.draft?.trim()) return false;
  if (refreshFactsKey(rep, facts) === rep.composedFactsHash) return false;
  return !(template && canRecompose(template, rep));
}

/**
 * 템플릿이 마지막으로 만든 글 **그대로**인가 — 이것만 저장·복사 직전에 다시 조립해도 된다.
 * 🔑 강사가 넣은 첨부 자리 줄(`[첨부: …]`)은 빼고 본다 — 템플릿 글의 일부가 아니고, 다시 짤 때 따라온다
 *    (`carryAttachmentLines`). 넣었다고 '고친 글'이 되면 그 뒤 점수를 고칠 때마다 다시 채우기가 필요하고, 다시 채우면
 *    자리가 날아갔다(2026-09-11).
 */
export function isUntouchedTemplateDraft(rep: EnglishRowReport | undefined): boolean {
  const draft = rep?.draft ?? "";
  return !!withoutAttachmentLines(draft).trim() && !!rep?.templateHash && templateHashOf(draft) === rep.templateHash;
}

/**
 * 저장·복사·미리보기 직전에 **다시 조립해도 되는가** — 템플릿 글 그대로이고, AI 칸이 있는 템플릿이면 AI 글도 있어야 한다.
 * 🔴 AI 칸이 있는 템플릿으로 바꿨는데(또는 쓰던 템플릿에 {코멘트}를 새로 넣었는데) AI 글이 없으면 다시 짜지 않는다 —
 *    짜면 코멘트 문단이 통째로 빠진 사실 줄만의 글이 '멘트 있음'으로 저장·복사된다(적대 재리뷰 2026-09-10).
 */
export function canRecompose(template: ReportTemplate, rep: EnglishRowReport | undefined): boolean {
  if (!isUntouchedTemplateDraft(rep)) return false;
  return !(templateNeedsAi(template) && !hasAiText(rep));
}

/**
 * 템플릿 글인데 AI 글이 아직 없다 — 해법이 '다시 채우기'가 아니라 '자동작성'인 상태(칩을 따로 띄운다).
 * 대기칸(작성 중 수정으로 받아 둔 AI 글)이 있으면 다시 채우기로 풀리므로 해당하지 않는다. 손으로 쓴 글(지문 없음)도 아니다.
 */
export function needsAiFirst(template: ReportTemplate, rep: EnglishRowReport | undefined): boolean {
  if (!rep?.templateHash || !rep.draft?.trim() || rep.pendingAi) return false;
  return templateNeedsAi(template) && !hasAiText(rep);
}

/** 템플릿·칸 값이 마지막으로 채운 때와 달라졌는가(글을 고쳤든 안 고쳤든). 채운 적이 없으면 false. */
export function isTemplateStale(
  template: ReportTemplate,
  facts: EnglishRowFacts,
  rep: EnglishRowReport | undefined,
): boolean {
  if (!rep?.templateHash || !rep.draft?.trim()) return false;
  // 🔴 'AI 글 없음' 상태여도 숨기지 않는다 — 숨겼더니 그사이 고친 점수가 경고 없이 옛 값으로 저장·복사됐다(적대 재리뷰).
  return templateHashOf(composeEnglishDraft(template, facts, rep)) !== rep.templateHash;
}

/**
 * 강사가 **고른** 템플릿(아직 글에 못 쓴 대기 선택)이 AI 글을 기다리는가 — 해법은 자동작성.
 * 🔴 글의 템플릿(templateId)은 AI 글이 생길 때까지 바꾸지 않는다: 바꾸면 글·지문은 옛 템플릿인데 판정은 새 템플릿으로
 *    해서 칸이 바뀐 걸 못 알아보고 옛 점수가 나갔다(적대 재리뷰 2026-09-10). 그래서 고른 것은 대기로만 둔다.
 */
export function pendingNeedsAi(pending: ReportTemplate | null, rep: EnglishRowReport | undefined): boolean {
  return !!pending && templateNeedsAi(pending) && !hasAiText(rep) && !rep?.pendingAi;
}

function hasAiText(rep: EnglishRowReport | undefined): boolean {
  return !!(rep?.aiIntro?.trim() || rep?.aiComment?.trim());
}

/** 저장된 AI 문장이 지금 글에 **그대로** 들어 있는가 — 강사가 고쳐 썼으면 그 문장은 더는 AI 것이 아니다. */
function aiTextInDraft(rep: EnglishRowReport): boolean {
  const draft = rep.draft ?? "";
  return [rep.aiIntro, rep.aiComment].some((s) => !!s?.trim() && draft.includes(s.trim()));
}

/**
 * AI 인사말·코멘트가 지금 칸 값과 **다른 사실**로 쓰였는가. 저장 직전 재조립은 사실 줄만 새로 쓰고 AI 글은
 * 그대로 두므로, 점수를 고친 뒤엔 "18개 맞음" 줄과 "15개로 아쉬웠어요" 코멘트가 한 글에 같이 나간다.
 * 🔴 저장·다시 채우기로는 안 풀린다 — 자동작성을 다시 눌러야 풀린다(그래서 경고가 저장 뒤에도 남는다).
 * 🔑 강사가 AI 문장을 직접 고쳐 썼으면(글에 그 문장이 더는 없으면) 경고하지 않는다 — 그 글은 강사의 것이다
 *    (안 그러면 손으로 맞춘 뒤에도 경고가 영영 남는다, 적대 재리뷰 2026-09-10).
 */
export function isAiStale(
  template: ReportTemplate,
  facts: EnglishRowFacts,
  rep: EnglishRowReport | undefined,
): boolean {
  if (!rep?.aiFactsHash || !hasAiText(rep) || !templateNeedsAi(template)) return false;
  if (!aiTextInDraft(rep)) return false;
  return aiFactsHashOf(facts, rep.nextTest ?? "") !== rep.aiFactsHash;
}

/** 학생 이름 경고 — AI가 쓴 글이 들어 있을 때만(AI 칸이 없는 템플릿이면 이름은 템플릿을 고른 사람의 몫). */
export function isNameMissing(
  template: ReportTemplate,
  rep: EnglishRowReport | undefined,
  studentName: string,
): boolean {
  const draft = rep?.draft?.trim();
  // AI 문장을 전부 고쳐 썼으면(글에 AI 문장이 더는 없으면) 그 글은 강사의 것이다 — 'AI 옛 값'과 같은 기준.
  if (!rep || !draft || !templateNeedsAi(template) || !hasAiText(rep) || !aiTextInDraft(rep)) return false;
  return !mentionsStudentName(draft, studentName);
}
