// 코드가 확정하는 신호(모델에 사실로 준다) — 옛 check.mjs(6차) 그대로(순수). 정규식 하나를 바꾸면 평점이 바뀐다 — 버전을 올릴 것.
import { clean, concernCandidates } from "./card";
import type { RatingReport, Signals } from "./types";

const squash = (s: unknown) => clean(s).replace(/\s+/g, "");
const bigrams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; };
export const dice = (a0: unknown, b0: unknown): number => {
  const a = squash(a0), b = squash(b0);
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let i = 0;
  for (const [k, v] of A) i += Math.min(v, B.get(k) || 0);
  return (2 * i) / (a.length + b.length - 2);
};
export const sentences = (t: unknown): string[] => clean(t).split(/(?<=[.!?。])\s+|\n+|\s\/\s/).map((s) => s.trim()).filter((s) => s.length > 1);

// 2차: 기록 문장 / 관찰 문장
export const RECORD_RE = /(수업 태도|태도[는도가]|지난 과제|빠짐없이|일일테스트|확인테스트|문제 중|개를 맞|모두 맞|만점|오늘 과제|과제는|배웠|공부했|다뤘|알아보았|익혔|진도[는를]|학습했|풀었습니다|시험을 봤|평가를 봤)/;
export const OBSERVE_RE = /(어려워|헷갈|질문|물어|스스로|혼자|실수|집중|졸|늦|두고|잊|기억|이해[했하가를]|익숙|힘들|자신감|늘었|좋아졌|빨라|꼼꼼|귀찮|떠들|남아서|보충|다시|막힘|곧잘|해결|누락|빼놓|덜 |못 했|못했|안 해|미흡|부족|연습이|수고|기특|열심|노력|칭찬|대견|웃|즐거|재미|흥미|적극|발표|정리를 잘|빠르게)/;
// 3·4차: 선생님이 돕는다는 표지 · 멘트의 아쉬운 점 · 학습 추세의 아쉬운 흐름
export const HELP_RE = /(남아서|보충|다시 (설명|풀|짚|봐)|함께|같이|봐 ?주|도와|짚어|챙기|지도하|확인해 ?주|오답 (정리|풀이)|복습을 (잡|진행|하겠)|시간을 (더|잡)|일찍 등원|추가 수업|풀이노트)/;
export const HELP_RE4 = /(붙여서|옆에서|오답 ?노트|보강|1:1|일대일|다시 풀도록|다시 풀게|재시험을 (보|봤|치))/;
const CONCERN_MENT_RE = /(실수가 (잦|많)|자주 실수|누락|대충|덜 (해|되)|안 해 ?(왔|와|옴)|못 해 ?(왔|와)|결석|지각|늦게 (와|왔|등원)|안 가져|두고 와|미흡|부족(한|합)|못 풀|기억이 안|잊어버|진도가 (조금 |많이 )?늦|밀린|재시험|과정 ?없이|답만 써)/;
const RESOLVED_RE = /(해결했|해결하|풀었|맞혔|이해했|마무리했|마무리 하고|완료했)/;
const TREND_CONCERN_RE = /(들쑥날쑥|오가|오락가락|줄어|낮아|떨어|덜 해|못 해|미제출|하지 못)/;
export const isRecordSentence = (s: string) => RECORD_RE.test(s) && !OBSERVE_RE.test(s);
export const isObserveSentence = (s: string) => OBSERVE_RE.test(s);

// 6차: 쪽수 범위는 겹치면 같은 과제('22-39p' ↔ '30~39p') · 두 수 사이에 ~·- 가 있을 때만 범위
const pageRanges = (t: unknown): [number, number][] => [...clean(t).matchAll(/(\d{1,3})\s*[~\-]\s*(\d{1,3})\s*(?:p|쪽|페이지|P)|(?:[~\-]\s*)?(\d{1,3})\s*(?:p|쪽|페이지|P)/g)].map((m) => {
  const a = m[1] ? Number(m[1]) : Number(m[3]), b = m[2] ? Number(m[2]) : Number(m[3]);
  return [Math.min(a, b), Math.max(a, b)];
});
const rangesOverlap = (xs: [number, number][], ys: [number, number][]) => xs.some(([a, b]) => ys.some(([c, d]) => a <= d && c <= b));
const pageNums = (t: unknown) => [...clean(t).matchAll(/(\d{1,3})\s*(?:[~\-]\s*(\d{1,3}))?\s*(?:p|쪽|페이지|P)/g)].map((m) => `${m[1]}${m[2] ? "-" + m[2] : ""}`);

const AI_PHRASES = ["모습을 보였", "모습을 보이고", "흐름을 보이", "일관되게", "안정적", "전반적으로", "를 통해", "을 통해", "진행하였", "수행하며", "결과가 나왔"];
const LABEL_WORDS = ["매번", "맨날", "또 안", "또 못", "항상 안", "늘 안", "게으", "안 하려고", "하기 싫어"];
const INTERNAL = ["특이사항으로", "기록해 두", "기록해두", "입력해", "자동 생성", "AI"];

export function codeSignals(r: RatingReport): Signals {
  const ment = clean(r.notes);
  const ss = sentences(ment);
  const isRequest = (s: string) => /주세요|부탁|바랍니다/.test(s);
  // ⚠️ u 플래그 없이(옛 코드 그대로) — 이모지는 두 글자 단위로 맞는다. 바꾸면 끝이 이모지인 문장 판정이 달라질 수 있다.
  const hap = ss.filter((s) => /(니다|니까)[.!~😊\s]*$/.test(s) && !isRequest(s)).length;
  const yo = ss.filter((s) => /요[.!~😊\s]*$/.test(s) && !isRequest(s)).length;
  const ai = AI_PHRASES.filter((p) => ment.includes(p)).concat(ss.filter((s) => /^(또한|아울러)/.test(s)).map(() => "또한/아울러로 시작"));
  // 6차: 꼬리표 단어는 아이의 아쉬운 행동을 말하는 문장 안에서만
  const NEG_RE = /(안 ?해|안해|못 ?해|덜 ?해|대충|늦|까먹|잊|싫어|안 가져|두고|빼먹|미흡)/;
  const hasWord = (s: string, w: string) => (/^[또늘]/.test(w) ? new RegExp(`(^|[\\s,.])${w}`).test(s) : s.includes(w)); // '늘 안'이 '오늘 안'에 걸리지 않게
  const label = LABEL_WORDS.filter((w) => ss.some((s) => hasWord(s, w) && (/^(또 안|또 못|항상 안|늘 안|게으|안 하려고|하기 싫어)$/.test(w) || NEG_RE.test(s))));
  const internal = INTERNAL.filter((w) => ment.includes(w));
  const hw = clean(r.homework_today);
  const oneLineCopy = ss.length <= 1 && !!ment && [hw, clean(r.progress), clean(r.textbook)].some((v) => v && dice(v, ment) >= 0.7);
  const learned = !!(clean(r.progress) || clean(r.textbook) || ment.length > 20);
  const howDid = !!(clean(r.daily_test) || clean(r.check_test) || clean(r.exam_info) || clean(r.homework_score) || clean(r.attitude));
  const homework = !!(hw || /과제|숙제/.test(ment));
  const recordOnly = ss.length > 0 && ss.every((s) => !isObserveSentence(s)) && ss.some((s) => RECORD_RE.test(s));
  const vagueHw = hw && hw !== "없음" ? hw.split(/[,，\n/]|\s{2,}/).map((x) => x.trim()).filter((x) => x && !/\d/.test(x) && x !== "없음") : [];
  const hwSentence = ss.filter((s) => /오늘 과제|과제는/.test(s)).join(" ");
  const fieldPages = pageNums(hw), mentPages = pageNums(hwSentence);
  const fr = pageRanges(hw), mr = pageRanges(hwSentence);
  const pageMismatch = fieldPages.length && mentPages.length && fr.length && mr.length && !rangesOverlap(fr, mr) ? `칸 '${fieldPages.join(", ")}' ↔ 멘트 '${mentPages.join(", ")}'` : "";
  return {
    ment_empty: !ment, mixed_endings: hap > 0 && yo > 0, ai_phrases: ai, label_words: label, internal_words: internal,
    one_line_copy: oneLineCopy, card_learned: learned, card_how: howDid, card_homework: homework,
    concern_fields: concernCandidates(r),
    record_only: recordOnly, has_record: ss.some((s) => RECORD_RE.test(s)), has_observe: ss.some((s) => isObserveSentence(s)),
    short_line: ss.length <= 1 && ment.length > 0 && ment.length < 40,
    vague_homework: vagueHw, page_mismatch: pageMismatch, class_same: r.sim_class_same || 0,
    ment_concern_code: ss.find((s) => CONCERN_MENT_RE.test(s) && !RESOLVED_RE.test(s)) || "",
    trend_concern: TREND_CONCERN_RE.test(clean(r.trend_note)) ? clean(r.trend_note).slice(0, 60) : "",
  };
}

export function signalsText(s: Signals): string {
  const yes = (b: boolean) => (b ? "예" : "아니오");
  return [
    "[코드 확인 — 사실로 받아들일 것]",
    `멘트 비었음: ${yes(s.ment_empty)} · 칸 값 한 줄 옮김: ${yes(s.one_line_copy)} · 합니다체/해요체 섞임: ${yes(s.mixed_endings)}`,
    `AI 상투 표현: ${s.ai_phrases.length ? s.ai_phrases.join(", ") : "없음"} · 꼬리표 단어: ${s.label_words.length ? s.label_words.join(", ") : "없음"} · 내부 표현: ${s.internal_words.length ? s.internal_words.join(", ") : "없음"}`,
    `카드에 ⓐ배운 것 ${yes(s.card_learned)} · ⓑ어떻게 했는지 ${yes(s.card_how)} · ⓒ과제 ${yes(s.card_homework)}`,
    `칸에서 찾은 아쉬운 사실: ${s.concern_fields.length ? s.concern_fields.join(" · ") : "없음"}`,
    `멘트가 기록 나열뿐: ${yes(s.record_only)} · 한 줄짜리 짧은 멘트: ${yes(s.short_line)} · 쪽수 없는 과제: ${s.vague_homework?.length ? s.vague_homework.join(", ") : "없음"} · 과제 쪽수 칸↔멘트: ${s.page_mismatch || "맞음/해당 없음"}`,
    `거의 같은 글을 받은 같은 반 학생: ${s.class_same}명`,
  ].join("\n");
}
