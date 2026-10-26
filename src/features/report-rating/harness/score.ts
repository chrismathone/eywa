// 체크리스트 + 코드 신호 → 항목 점수(기준 v4 단계 · 코드 규칙 7차 기본) — 옛 check.mjs `scoreCheck(c, sig, r, 6)`를 그대로 옮기고(level 6 = 옛 판 대조용) 7차를 더했다(순수).
// 모델이 인용한 문장은 코드가 다시 확인한다(멘트에 실제로 있는지 · 같은 반 친구 글과 겹치지 않는지 · 기록 문장이 아닌지).
import { clean } from "./card";
import { HELP_RE, HELP_RE4, dice, isObserveSentence, isRecordSentence, sentences } from "./signals";
import { RATING_ITEMS, type Checklist, type RatingReport, type Scored, type Signals } from "./types";

const squash = (s: unknown) => clean(s).replace(/\s+/g, "");
// '다른 아이 내용'에서 뺄 흔한 낱말 이름('하나도'·'다음'·'우리'…)
const COMMON_WORD_NAMES = new Set(["하나", "다음", "우리", "오늘", "수학", "과제", "시간", "정도", "한결", "가을", "여름", "보람", "나라", "하늘", "아름", "한별", "다인"]);
// 모델이 모순 칸에 넣은 '모순 아님' 문장 거르기
const NOT_CONTRA_RE = /(일치|모순 ?(이 )?없|어긋남 ?없|문제 ?없|해당 ?없|^없음|언급 ?(이 )?없|칭찬만|다루지 않|설명 ?(이 )?없)/;
const REPEAT_RE = /(반복|계속|자꾸|(^|[\s,.])또 |(^|[\s,.])늘 |항상|번번이|매일)/;
// 7차(2026-10-26 조정용 60건 Codex 대조): 돕는 표지에 '오답을 확인'·'노트 정리'를 더하고(모델도 돕는다고 볼 때만 — 부정문 오탐 방지),
// 오늘 과제 안내 문장('오늘 과제는 … 오답노트정리')과 가정에 맡기는 문장은 돕는 표지에서 뺀다('지난 과제는 …' 보고 문장은 남긴다).
const HELP_RE7 = /(오답(을|도)? ?(확인|정리|풀이|다시)|노트 ?정리(까지|를|도)? ?(확인|했|마쳤|마무리))/;
// '지난 과제는'·'지난주 과제는'·'지난번 숙제는'은 했던 일을 보고하는 문장이라 남긴다. 가정 문장은 맡기는 문형(…주세요·부탁)일 때만 뺀다
// ('집에서 못 풀어 온 문제를 남아서 함께 다시 풀었습니다'는 돕는 문장 — 재리뷰 2026-10-26).
const HOMEWORK_SENTENCE = /(오늘(의)? (과제|숙제)|(?<!지난\s?(주|번|시간)?\s?)(과제|숙제)는)/;
const HOME_SENTENCE = /(집에서|가정에서|댁에서).*(주세요|주시면|주시기|주십시오|부탁)/;
// 7차: 이 아이만의 상황(교재를 안 가져옴 등)도 관찰 문장이다.
const OBSERVE_RE7 = /(가지고 오지 않|가져오지 않|안 가져|놓고 와|빠뜨)/;
// 7차: 이 아이의 기록 값 표지(숫자·점수·태도·과제 수행·집중 등) — 하나도 없고 같은 반 글과 거의 같으면 '반 공지뿐'(개별성 1).
// 숫자 없는 기록 값('빠짐없이 해 왔고 수업에 집중')은 그 아이 값이라 기준 v4대로 3점을 지킨다.
const OWN_VALUE_RE = /(\d|맞혔|맞음|만점|태도|빠짐없이|다 해|덜 해|못 해|안 해|해 ?왔|해 ?옴|집중|성실|열심|잘 했|잘했)/;
// 7차: AI 작성 과정이 그대로 나간 문장(기준 v4 trust 3 · clarity 4 '내부 표현') — 2026-10-22 발송분 1건 실측("…이 메모에 없으므로 덧붙이지 않겠습니다").
// 수업 글에 흔한 '주어진 정보에서 조건을 찾는'·'자료에 없는 유형'은 잡지 않게 작성 문체로만 좁힌다.
const PROCESS_LEAK_RE = /(메모에 (없|적혀 있지 않|나와 있지 않)|덧붙이지 않겠|적지 않겠습니다|쓰지 않겠습니다)/;
// 사람 이름을 정규식에 넣을 때 — 괄호 등 특수문자가 있으면 정규식이 깨진다.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 코드 규칙 판 — 6 = 10-22 오프라인 배치(옛 평점 재현용) · 7 = 앱 기본(RATING_RUBRIC). */
export type RuleLevel = 6 | 7;

export function scoreCheck(c0: Checklist, sig: Signals, r: RatingReport, level: RuleLevel = 7): Scored {
  let c = c0;
  const ment = clean(r.notes);
  const mentSs = sentences(ment);
  const inMent = (q: string) => !!q && (ment.includes(q.trim()) || mentSs.some((s) => dice(s, q) >= 0.8));
  const classSs = sentences(r.sim_class_text);
  const classSq = squash(r.sim_class_text);
  const shared = (q: string) => classSs.some((s) => dice(s, q) >= 0.8) || (squash(q).length >= 6 && classSq.includes(squash(q)));
  const given = clean(r.student).replace(/[A-Z]$/, "").slice(-2); // 부르는 이름(성 뺀 두 글자)
  const own = (c.personal.own_sentences || []).filter((q) => inMent(q) && !shared(q) && !isRecordSentence(q)
    && (isObserveSentence(q) || (level >= 7 && OBSERVE_RE7.test(q)) || (given.length === 2 && q.includes(given))));
  const classNoticeOnly = level >= 7 && sig.class_same > 0 && (r.sim_class ?? 0) >= 0.9 && !OWN_VALUE_RE.test(ment);
  const out = {} as Scored;

  // warmth
  let w: number;
  if (sig.ment_empty) w = 2;
  else if (c.warm.scolding_parent) w = 1;
  else if (sig.one_line_copy || c.warm.parent_lecture || sig.short_line) w = 2;
  else if (sig.record_only) w = 3;
  else if (sig.ai_phrases.length >= 2 || !c.warm.natural_voice) w = 3;
  else w = c.warm.warm_expression ? 5 : 4;
  if (sig.mixed_endings && w === 5) w = 4;
  out.warmth = { score: w, note: c.warm.evidence };

  // personal
  let p: number;
  if (sig.ment_empty) p = 1;
  else if (own.length && c.personal.followup_today) p = 5;
  else if (own.length) p = 4;
  else if (classNoticeOnly) p = 1; // 7차: 같은 반에 같은 글 + 이 아이 값 없음 = 반 공지뿐
  else if (sig.has_record && !sig.one_line_copy) p = 3;
  else if (sig.class_same > 0) p = 1;
  else if (sig.one_line_copy || !c.personal.generic_only) p = 2;
  else p = 1;
  out.personal = { score: p, note: own.length ? `이 아이만의 문장: ${own[0].slice(0, 40)}` : `검증된 개별 문장 없음(모델 인용 ${(c.personal.own_sentences || []).length}개)` };

  // concern
  const mc = clean(c.concern.ment_concern_quote);
  const codeConcern = sig.ment_concern_code || sig.trend_concern || "";
  const applicable = sig.concern_fields.length > 0 || (!!mc && inMent(mc)) || !!codeConcern;
  let k = 0;
  if (applicable) {
    const cc = { ...c.concern };
    if (sig.ment_concern_code) cc.mentioned_in_ment = true; // 멘트가 직접 아쉬운 점을 적었다
    // 7차: 과제 안내 문장은 빼고 본다(반 전체에 같은 '오답노트정리' 과제가 돕는 말로 잡히지 않게).
    const helpText = level >= 7 ? mentSs.filter((s) => !HOMEWORK_SENTENCE.test(s) && !HOME_SENTENCE.test(s)).join(" ") : ment;
    const helps = HELP_RE4.test(helpText) || (cc.helps && HELP_RE.test(helpText)) || (level >= 7 && cc.helps && HELP_RE7.test(helpText));
    const cover = cc.cover_with_praise && !(cc.mentioned_in_ment && helps);
    cc.helps = helps;
    // 최저점(꼬리표·반복 비난)은 코드가 반복 표지를 확인할 때만 — 모델의 label_blame은 과하게 켜진다
    const repeatBlame = sig.label_words.length > 0 || (cc.label_blame && REPEAT_RE.test(ment));
    if (cc.label_blame && !repeatBlame) cc.harsh_expression = true; // 걸리는 표현이면 한 단계만 낮춘다
    const softened = cc.home_only_or_anxious && !cover && (cc.helps || cc.context); // 도움·맥락이 함께면 '가정에만 맡김'이 아니다
    if (repeatBlame) k = 1;
    else if ((cc.home_only_or_anxious && !softened) || cover) k = 2;
    else if (!cc.mentioned_in_ment) k = 3;
    else if (cc.helps) k = cc.home_request || softened ? 4 : 5;
    else if (cc.context) k = softened ? 3 : 4;
    else k = 3;
    if (cc.harsh_expression && k > 2) k -= 1; // 걸리는 표현으로는 2점 아래로 내리지 않는다
  }
  out.concern = { score: k, note: applicable ? (sig.concern_fields[0] || mc || codeConcern).slice(0, 40) : "해당 없음" };

  // clarity
  const missing = 3 - [sig.card_learned, sig.card_how, sig.card_homework].filter(Boolean).length;
  const leak = level >= 7 ? (mentSs.find((s) => PROCESS_LEAK_RE.test(s)) ?? "") : "";
  const vague = clean(c.clarity.vague_item) || sig.internal_words.length || sig.vague_homework?.length || leak;
  let cl = missing === 0 ? (vague ? 4 : 5) : missing === 1 ? 3 : missing === 2 ? 2 : 1;
  if (c.clarity.verbose && ment.length > 250 && cl > 4) cl = 4;
  out.clarity = { score: cl, note: clean(c.clarity.vague_item) || (leak ? `작성 과정 문장: ${leak.slice(0, 30)}` : "") || (missing ? `빠진 요소 ${missing}개` : "배운 것·결과·과제 모두 분명") };

  // trust
  const contra = (c.trust.contradictions || []).filter((x) => clean(x) && !NOT_CONTRA_RE.test(clean(x)));
  if (sig.page_mismatch) contra.push(`과제 쪽수 ${sig.page_mismatch}`);
  const spec = (c.trust.speculations || []).filter((x) => clean(x));
  // '다른 아이 내용'은 코드가 판정 — 같은 날 같은 반 친구 이름(성 뺀 두 글자)이 멘트에 실제로 나올 때만
  const otherChild = (r.classmate_names || []).map((n) => clean(n).replace(/[A-Z]$/, "").slice(-2))
    .some((g) => g.length === 2 && g !== given && !COMMON_WORD_NAMES.has(g) && new RegExp(`${escapeRe(g)}(이|가|는|도|의|랑|와|한테|에게|[\\s,.])`).test(ment));
  c = { ...c, trust: { ...c.trust, other_child: otherChild } };
  let t: number;
  if (otherChild || contra.length >= 2) t = 1;
  else if (contra.length === 1 || spec.length >= 2) t = 2;
  else if (spec.length === 1 || c.trust.score_mismatch || leak) t = 3; // 7차: 작성 과정이 그대로 나감 = 3(기준 v4)
  else if (clean(c.trust.minor_diff)) t = 4;
  else t = 5;
  out.trust = { score: t, note: contra[0] || spec[0] || (leak ? `작성 과정 문장이 그대로 나감: ${leak.slice(0, 30)}` : "") || clean(c.trust.minor_diff) || "칸과 멘트 일치" };

  const claim = out.concern.score === 1 || c.warm.scolding_parent || c.trust.other_child || t <= 2;
  out.claim_risk = claim;
  // 7차: 사유를 실제 걸린 것으로(옛 판은 다른 아이 이름·짐작 여럿도 '칸과 멘트 어긋남: (빈칸)'이었다).
  const trustWhy = level >= 7
    ? (otherChild ? "다른 아이 이름·내용이 섞임" : contra.length ? `칸과 멘트 어긋남: ${contra[0].slice(0, 30)}` : `근거 없는 짐작: ${(spec[0] ?? "").slice(0, 30)}`)
    : `칸과 멘트 어긋남: ${(contra[0] || spec[0] || "").slice(0, 30)}`;
  out.claim_reason = claim ? (out.concern.score === 1 ? "아이에게 꼬리표·반복 비난" : t <= 2 ? trustWhy : "학부모를 나무라는 말") : "";
  out.parent_feeling = c.parent_feeling;
  out.suggestion = c.suggestion;
  return out;
}

/** 종합 평점 = 판단한 항목(1~5) 평균, 소수 첫째 자리. 보류(0)는 뺀다. */
export function points(res: Scored): number | null {
  const s = RATING_ITEMS.map((k) => res[k]?.score).filter((x): x is number => typeof x === "number" && x >= 1 && x <= 5);
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null;
}
