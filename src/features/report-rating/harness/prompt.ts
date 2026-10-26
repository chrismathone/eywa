// 평점 프롬프트 — 기준 v4 + 체크리스트 설명(옛 check.mjs CHECK_PROMPT 원문) + JSON 모양 + 묶음 본문(순수).
// ⚠️ 옛 배치는 Anthropic 구조화 출력(json_schema)으로 모양을 강제했다. generateJSON은 그 칸이 없어 **같은 모양을 글로 지시**한다
//    (차이는 회귀 120건으로 확인 — 2026-10-26 크레딧 MVP `04-ratings/regression.csv`).
import { cardText } from "./card";
import { RUBRIC_V4 } from "./rubric";
import { codeSignals, signalsText } from "./signals";
import type { RatingReport, Signals } from "./types";

/** 저장 칸 `rubric`에 남는 이름 — 기준 · 코드 규칙 · 프롬프트 판이 바뀌면 올린다. */
export const RATING_RUBRIC = "v4-check7-app1";
/** 한 요청에 싣는 보고서 수(옛 배치와 같다 — 서로 비교하지 말라고 일러 둔다). */
export const RATING_BATCH_SIZE = 5;

export const CHECK_PROMPT = `아래 [채점 기준]을 배경으로, 알림장마다 **점수 대신 체크리스트**에 답하세요. 점수는 코드가 기준대로 계산합니다.
각 카드의 [코드 확인]은 코드가 이미 확정한 사실입니다 — 다시 판단하지 말고 그대로 믿으세요.

체크리스트(모두 학부모 입장에서, 그 카드의 글만 보고):
warm — 멘트·추세의 말투(아쉬운 사실을 전하는 문장의 말투는 여기서 보지 않는다)
 · evidence: 말투 근거 한 줄(멘트 표현 인용)
 · natural_voice: 담임이 직접 쓴 듯 자연스러운 말투인가(사무적·보고서 같으면 false)
 · warm_expression: 아이의 노력·성취·마음을 알아주는 따뜻한 표현이 있는가('수고 많았습니다', '기특했습니다' 등). 기록을 옮긴 칭찬('태도가 좋았습니다')만으로는 false
 · parent_lecture: 학부모에게 지시·훈수('가정에서 ~해 주세요', '복습이 필요합니다')가 두드러지는가. 짧고 정중한 부탁 한 문장은 false
 · scolding_parent: 학부모를 나무라는가
personal
 · own_sentences: 이 아이에게만 해당하는 구체적 관찰·상황 문장을 멘트에서 **그대로 인용**(없으면 빈 배열). '같은 반에서 가장 비슷한 다른 학생 멘트'에도 있는 문장, 기록 값(진도·점수·과제·태도)만 옮긴 문장, 일반론은 넣지 말 것
 · followup_today: 그 관찰에 맞춘 **오늘의** 반응·지도·변화가 있는가(앞으로의 계획만, 반 전체 진도는 false)
 · has_record_values: 멘트가 이 아이의 기록 값(진도·점수·과제·태도)을 담는가
 · generic_only: 멘트가 일반론·공지뿐인가
concern — 아쉬운 사실(칸에서 찾은 것, 또는 멘트가 보완할 점으로 적은 일)
 · ment_concern_quote: 멘트가 보완할 점·문제로 적은 문장 인용(지각·결석·미완료·교재 미지참·진도 지연·태도 지적·실수 반복·잊음·연산/습관 지적·재시험·밀린 문제). 오답 몇 개·오늘 안에 해결한 어려움은 아님. 없으면 ''
 · mentioned_in_ment: (칸의 아쉬운 사실이 있다면) 멘트가 그것을 다루는가
 · context: 이유·맥락(왜 그랬는지·어떤 상황)을 함께 적었는가
 · helps: 선생님이 어떻게 돕는지(보충·다시 풀기·풀이노트 등) 적었는가
 · home_request: '가정에서도 독려 부탁' 같은 부탁이 붙었는가
 · home_only_or_anxious: 해결을 가정에만 맡기거나 학부모를 불안하게 하는가
 · cover_with_praise: 아쉬운 사실을 덮는 듯 칭찬만 하는가
 · label_blame: 아이에게 꼬리표를 붙이거나 반복해 나무라는가('매번', '또 안 해 왔다', '게으르다'). 오늘 관찰을 담담히 적은 것('귀찮아하는 모습이었습니다')은 false
 · harsh_expression: 담담하긴 해도 학부모 마음에 걸릴 표현이 있는가
clarity
 · vague_item: 흐린 것 하나(범위 없는 과제 '프린트 문제'·'책 마무리', 낯선 약어·교재 이름, 같은 말 반복). 단원 번호+이름, 여러 교재 쪽수, 영상 숙제 있음, 다음 일정은 정상. 없으면 ''
 · verbose: 멘트가 장황해 핵심이 묻히는가
trust
 · contradictions: 같은 사실에 칸과 멘트가 **정반대 값**인 곳(수행률 50%인데 '빠짐없이'). 종합 평가 vs 부분 관찰, 칸에 없는 내용 추가는 아님. 인용으로, 없으면 빈 배열
 · speculations: 근거 없는 전망·추측('곧 오를 겁니다', '아마 ~인 듯'). 선생님의 전문적 판단('연습이 더 필요해 보입니다')은 아님. 없으면 빈 배열
 · other_child: 다른 아이 이름·내용이 섞였는가
 · score_mismatch: 점수를 칸과 다르게 옮겼는가
 · minor_diff: 아주 사소한 표현 차이 하나(없으면 '')
parent_feeling(30자 이내 학부모 말투) · suggestion(40자 이내, 없으면 '')`;

/** 구조화 출력 대신 글로 주는 모양(키 이름 · 순서 · 값의 형식이 옛 json_schema와 같다). */
const SHAPE = `답은 JSON 하나만:
{"results":[{"id":"r1","warm":{"evidence":"…","natural_voice":true,"warm_expression":false,"parent_lecture":false,"scolding_parent":false},"personal":{"own_sentences":["…"],"followup_today":false,"has_record_values":true,"generic_only":false},"concern":{"ment_concern_quote":"","mentioned_in_ment":false,"context":false,"helps":false,"home_request":false,"home_only_or_anxious":false,"cover_with_praise":false,"label_blame":false,"harsh_expression":false},"clarity":{"vague_item":"","verbose":false},"trust":{"contradictions":[],"speculations":[],"other_child":false,"score_mismatch":false,"minor_diff":""},"parent_feeling":"…","suggestion":"…"}]}
- 모든 키를 빠짐없이 쓴다(참·거짓은 true/false, 글은 문자열, 목록은 배열). results는 카드의 id 순서대로.`;

export const RATING_SYSTEM = `${RUBRIC_V4}\n\n${CHECK_PROMPT}\n\n${SHAPE}`;

/** 묶음 하나의 사용자 글 + 카드별 코드 신호(점수 계산에 그대로 다시 쓴다). */
export function buildRatingPrompt(batch: readonly RatingReport[]): { prompt: string; ids: string[]; signals: Signals[] } {
  const ids = batch.map((_, i) => `r${i + 1}`);
  const signals = batch.map((r) => codeSignals(r));
  const body = batch.map((r, i) => `${cardText(r, ids[i])}\n${signalsText(signals[i])}`).join("\n\n");
  return { ids, signals, prompt: `아래 알림장 ${batch.length}장 각각에 체크리스트로 답하세요(서로 비교하지 말 것). results에 id 순서대로 ${batch.length}개.\n\n${body}` };
}
