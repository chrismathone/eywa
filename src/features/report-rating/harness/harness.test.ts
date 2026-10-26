import { describe, expect, it } from "vitest";
import { assembleRatingReports, type SentReport } from "./assemble";
import { cardText, concernCandidates } from "./card";
import { piiHits } from "./pii";
import { buildRatingPrompt, RATING_RUBRIC } from "./prompt";
import { checklistsOf, ratingInputHash, ratingRow } from "./rows";
import { points, scoreCheck } from "./score";
import { codeSignals } from "./signals";
import type { Checklist, RatingReport } from "./types";

/**
 * 평점 하네스(옛 오프라인 배치를 앱으로 옮긴 것) — 합성 예시. 옛 코드와의 전수 일치(5,419건 카드·신호 · 5,256건 점수)는
 * 2026-10-26 크레딧 MVP의 `scripts/_oneoff/ai-credit-mvp/ratings/parity.ts`로 확인했다(운영 자료라 여기엔 두지 않는다).
 */
const base: RatingReport = {
  id: "r-1", d: "2026-10-22", subject: "math", makeup: false, student: "김하늘", school: "침산중", grade: "중2",
  textbook: "개념원리 중2-2", progress: "2-4-3 비례식", homework_today: "개념원리 30~39p", daily_test: "10문제 중 9개 맞음", check_test: null, exam_info: null,
  homework_score: "100%", attitude: "좋음", notes: "하늘이가 비례식 활용에서 처음엔 헷갈려했지만 다시 풀어 보더니 혼자 맞혔습니다. 오늘 과제는 30~39p입니다.",
  trend_note: null, video_homework: null,
};
const check = (over: Partial<Checklist> = {}): Checklist => ({
  warm: { evidence: "다시 풀어 보더니", natural_voice: true, warm_expression: false, parent_lecture: false, scolding_parent: false },
  personal: { own_sentences: ["하늘이가 비례식 활용에서 처음엔 헷갈려했지만 다시 풀어 보더니 혼자 맞혔습니다."], followup_today: true, has_record_values: true, generic_only: false },
  concern: { ment_concern_quote: "", mentioned_in_ment: false, context: false, helps: false, home_request: false, home_only_or_anxious: false, cover_with_praise: false, label_blame: false, harsh_expression: false },
  clarity: { vague_item: "", verbose: false },
  trust: { contradictions: [], speculations: [], other_child: false, score_mismatch: false, minor_diff: "" },
  parent_feeling: "잘 봐 주시네요", suggestion: "", ...over,
});

describe("카드 · 코드 신호", () => {
  it("칸에서 찾은 아쉬운 사실 — 수행률 80% 미만 · 정답률 70% 미만 · 태도 '보통' 이하", () => {
    expect(concernCandidates({ ...base, homework_score: "60%", daily_test: "10문제 중 5개 맞음", attitude: "보통" }))
      .toEqual(["지난 과제 수행률 60%", "테스트 10문제 중 5개 맞음(정답률 50%)", "수업 태도 '보통'"]);
    expect(concernCandidates(base)).toEqual([]);
  });
  it("카드는 학부모가 보는 칸과 [참고]를 가른다 · 비교 재료가 없으면 '없음'", () => {
    const t = cardText(base, "r1");
    expect(t).toContain("[알림장 칸]");
    expect(t).toContain("직전 알림장: 없음(이 과목 첫 발송)");
    expect(t).toContain("같은 반 같은 날 다른 학생 알림장: 없음");
  });
  it("합니다체·해요체 섞임 · 과제 쪽수 칸↔멘트 어긋남을 코드가 잡는다", () => {
    const s = codeSignals({ ...base, notes: "오늘 잘했습니다. 내일도 화이팅해요. 오늘 과제는 50~60p입니다." });
    expect(s.mixed_endings).toBe(true);
    expect(s.page_mismatch).toContain("30-39");
  });
});

describe("점수(코드 규칙 6차)", () => {
  it("관찰 + 오늘의 반응이 있으면 개별성 5 · 칸과 멘트가 맞으면 믿음 5", () => {
    const s = scoreCheck(check(), codeSignals(base), base);
    expect(s.personal.score).toBe(5);
    expect(s.trust.score).toBe(5);
    expect(s.concern.score).toBe(0); // 해당 없음
    expect(points(s)).toBeGreaterThanOrEqual(4);
  });
  it("멘트가 비면 따뜻함 2 · 개별성 1", () => {
    const r = { ...base, notes: "" };
    const s = scoreCheck(check({ personal: { own_sentences: [], followup_today: false, has_record_values: false, generic_only: true } }), codeSignals(r), r);
    expect(s.warmth.score).toBe(2);
    expect(s.personal.score).toBe(1);
  });
  it("모델이 인용한 문장이 멘트에 없으면 이 아이만의 문장으로 치지 않는다", () => {
    const s = scoreCheck(check({ personal: { own_sentences: ["지어낸 관찰 문장입니다"], followup_today: true, has_record_values: true, generic_only: false } }), codeSignals(base), base);
    expect(s.personal.score).toBe(3);
  });
  it("'다른 아이' 판정은 같은 반 친구 이름이 멘트에 실제로 나올 때만(모델 값은 무시)", () => {
    const r = { ...base, classmate_names: ["박서준"], notes: `${base.notes} 서준이도 함께 풀었습니다.` };
    expect(scoreCheck(check(), codeSignals(r), r).trust.score).toBe(1);
    expect(scoreCheck(check({ trust: { ...check().trust, other_child: true } }), codeSignals(base), base).trust.score).toBe(5);
  });
});

describe("7차 규칙(2026-10-26 조정용 Codex 대조)", () => {
  it("반 전체 과제 목록의 '오답노트정리'는 돕는 말이 아니다 · '오답을 확인하고 노트 정리'는 돕는 말이다", () => {
    const low = { ...base, daily_test: "15문제 중 8개 맞음", notes: "일일테스트는 15문제 중 8개를 맞혔습니다. 오늘 과제는 쎈 8단원 오답노트정리입니다." };
    const c1 = check({ concern: { ...check().concern, mentioned_in_ment: true, helps: true } });
    expect(scoreCheck(c1, codeSignals(low), low, 6).concern.score).toBe(5); // 옛 규칙의 오탐
    expect(scoreCheck(c1, codeSignals(low), low).concern.score).toBe(3);
    const re = { ...base, notes: "월말평가 후 오답을 확인하고 노트 정리까지 확인했습니다. 다음 주에 재시험이 예정되어 있습니다." };
    const q = { ...check().concern, ment_concern_quote: "다음 주에 재시험이 예정되어 있습니다." };
    expect(scoreCheck(check({ concern: { ...q, helps: true } }), codeSignals(re), re).concern.score).toBe(5);
    // 모델이 돕는다고 보지 않으면(부정문 등) 표지만으로 5점을 주지 않는다.
    const no = { ...re, notes: "월말평가 오답을 확인하지 못했습니다. 다음 주에 재시험이 예정되어 있습니다." };
    expect(scoreCheck(check({ concern: q }), codeSignals(no), no).concern.score).toBeLessThan(5);
  });
  it("같은 반에 글자 그대로 나간 공지(이 아이 값 없음)는 개별성 1 · 교재를 안 가져온 상황은 이 아이만의 문장", () => {
    const notice = { ...base, homework_score: null, daily_test: null, attitude: null, sim_class: 1, sim_class_same: 5, notes: "월말 평가 실시 하였습니다. 과제는 시험지 풀어오도록 합니다." };
    const none = check({ personal: { own_sentences: [], followup_today: false, has_record_values: false, generic_only: true } });
    expect(scoreCheck(none, codeSignals(notice), notice).personal.score).toBe(1);
    const book = { ...base, notes: "교재를 가지고 오지 않아서 교재 검사는 다음 주에 하겠습니다." };
    const q = check({ personal: { own_sentences: ["교재를 가지고 오지 않아서 교재 검사는 다음 주에 하겠습니다."], followup_today: false, has_record_values: false, generic_only: false } });
    expect(scoreCheck(q, codeSignals(book), book).personal.score).toBe(4);
  });
  it("AI 작성 과정이 그대로 나간 문장 = 믿음 3 · 알기 쉬움 5 아님", () => {
    const leak = { ...base, notes: `${base.notes} 두 단원을 함께 다룬 점은 이 메모에 없으므로 덧붙이지 않겠습니다.` };
    const s = scoreCheck(check(), codeSignals(leak), leak);
    expect(s.trust.score).toBe(3);
    expect(s.clarity.score).toBeLessThanOrEqual(4);
  });
  it("했던 일을 보고하는 '지난주 과제는'·집에서 못 해 온 것을 함께 푼 문장은 돕는 말로 남는다", () => {
    const c = check({ concern: { ...check().concern, mentioned_in_ment: true, helps: true } });
    for (const notes of ["숙제를 덜 해 왔습니다. 지난주 과제는 오답을 다시 풀게 했습니다.", "숙제를 덜 해 왔습니다. 집에서 못 풀어 온 문제를 남아서 함께 다시 풀었습니다."]) {
      const r = { ...base, homework_score: "60%", notes };
      expect(scoreCheck(c, codeSignals(r), r).concern.score).toBe(5);
    }
  });
});

describe("저장 행 · 응답 해석 · 입력 지문", () => {
  it("단독 판정의 클레임은 'flagged'까지만(검증된 'confirmed'를 붙이지 않는다)", () => {
    const r = { ...base, homework_score: "50%", notes: "빠짐없이 다 해 왔습니다." };
    const row = ratingRow(r, check({ trust: { ...check().trust, contradictions: ["수행률 50%인데 빠짐없이"] } }), codeSignals(r), "claude-haiku-5-5", "h");
    expect(row?.claim).toBe("flagged");
    expect(row?.rubric).toBe(RATING_RUBRIC);
    expect(row?.items.map((i) => i.key)).toEqual(["warmth", "personal", "concern", "clarity", "trust"]);
  });
  it("응답의 id로 짝을 찾고 · 빠지거나 모양이 틀린 항목은 null", () => {
    const good = { id: "r2", ...check() };
    expect(checklistsOf({ results: [good, { id: "r1", warm: {} }] }, ["r1", "r2", "r3"]).map((x) => !!x)).toEqual([false, true, false]);
    expect(checklistsOf(null, ["r1"])).toEqual([null]);
  });
  it("입력 지문은 같은 글이면 같고, 멘트를 고치면 달라진다 · 친구 글·직전 글이 바뀌어도 그대로", () => {
    expect(ratingInputHash(base)).toBe(ratingInputHash({ ...base }));
    expect(ratingInputHash({ ...base, notes: `${base.notes} 수정` })).not.toBe(ratingInputHash(base));
    expect(ratingInputHash({ ...base, sim_class: 0.9, sim_class_text: "늦게 나간 친구 글", classmate_names: ["박하늘"], prev_notes: "x" })).toBe(ratingInputHash(base));
  });
  it("모양은 맞는데 값의 형식이 틀린 응답도 던지지 않고 다듬는다", () => {
    const odd = { id: "r1", ...check(), personal: { own_sentences: [1, "오늘 비례식을 다 풀었습니다"], followup_today: "true" }, parent_feeling: 3,
      clarity: { vague_item: false, verbose: false }, trust: { ...check().trust, minor_diff: false }, suggestion: {} };
    const [c] = checklistsOf({ results: [odd] }, ["r1"]);
    expect(c?.personal.own_sentences).toEqual(["오늘 비례식을 다 풀었습니다"]);
    expect(c?.personal.followup_today).toBe(false);
    expect(c?.parent_feeling).toBe("3");
    expect([c?.clarity.vague_item, c?.trust.minor_diff, c?.suggestion]).toEqual(["", "", ""]); // "false"·"[object Object]"가 저장되지 않게
    expect(() => ratingRow(base, c!, codeSignals(base), "m", "h")).not.toThrow();
  });
  it("외부 AI 전송 금지 정보(주민번호·계좌·카드·급여)는 글 안에서도 잡는다", () => {
    expect(piiHits("주민번호 080101-3123456 확인")).toEqual(["주민번호"]);
    expect(piiHits("환불 계좌 123-456-7890")).toEqual(["계좌번호"]);
    expect(piiHits("오늘 비례식 3번까지 풀었습니다. 다음 시간 42쪽.")).toEqual([]);
    expect(piiHits("기초 연산 보완이 시급합니다.")).toEqual([]);
    expect(piiHits("시급 12000원")).toEqual(["급여"]);
  });
  it("묶음 프롬프트 = 카드 수만큼 id(r1…) · 카드마다 코드 신호", () => {
    const { ids, signals, prompt } = buildRatingPrompt([base, { ...base, id: "r-2" }]);
    expect(ids).toEqual(["r1", "r2"]);
    expect(signals).toHaveLength(2);
    expect(prompt).toContain("results에 id 순서대로 2개");
  });
});

describe("재료 조립(옛 추출기와 같은 계산)", () => {
  const sent = (id: string, d: string, student: string, sid: string, notes: string, unit = "c1"): SentReport => ({
    ...base, id, d, student, notes, student_id: sid, unit_class: unit, created_at: `${d}T10:00:00Z`,
  });
  it("직전 보고서 = 같은 학생·과목의 바로 앞 발송분 · 같은 반 같은 날 비슷한 멘트", () => {
    const m = assembleRatingReports([
      sent("a1", "2026-10-20", "김하늘", "s1", "지난번 멘트"),
      sent("a2", "2026-10-22", "김하늘", "s1", "오늘 비례식을 다 풀었습니다"),
      sent("b2", "2026-10-22", "박서준", "s2", "오늘 비례식을 다 풀었습니다"),
    ]);
    expect(m.get("a2")?.prev_date).toBe("2026-10-20");
    expect(m.get("a1")?.prev_date).toBeUndefined();
    expect(m.get("a2")?.sim_class_same).toBe(1);
    expect(m.get("a2")?.classmate_names).toEqual(["박서준"]);
  });
});
