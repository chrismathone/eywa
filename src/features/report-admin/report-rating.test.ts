import { describe, expect, it } from "vitest";
import { decodeTip, encodeTip, tipText } from "@/components/hover-tip/tip";
import {
  claimNeedsAttention,
  formatPoints,
  isLowRating,
  parseRating,
  ratingTipCard,
  type RatingDbRow,
} from "./report-rating";

// 10-22 배치가 만든 실제 모양(upload-rows.json 첫 행) — 값만 옮겼다.
const row = (over: Partial<RatingDbRow> = {}): RatingDbRow => ({
  report_id: "r1",
  points: 3.3,
  items: [
    { key: "warmth", label: "따뜻함", score: 2, note: "멘트 '개념 복습 예습을 반드시 하고 문제를 풀어옵니다.'는 사실 나열 위주" },
    { key: "personal", label: "개별성", score: 1, note: "반 친구 4명과 같은 문장 — 이 아이만의 문장이 없음" },
    { key: "concern", label: "아쉬운 점 전달", score: 0, note: "해당 없음" },
    { key: "clarity", label: "알기 쉬움", score: 5, note: "배운 것·결과·과제 모두 분명" },
    { key: "trust", label: "믿음", score: 5, note: "칸과 멘트 일치" },
  ],
  parent_feeling: "과제도 잘하고 있다는 건 알겠어요",
  suggestion: "수업 중 아이가 보인 모습을 한 가지 덧붙여 주세요",
  claim: null,
  claim_reason: null,
  rated_on: "2026-10-22",
  ...over,
});

describe("parseRating — 표 행을 화면 값으로", () => {
  it("numeric이 문자열로 와도 숫자로 읽는다", () => {
    expect(parseRating(row({ points: "3.30" }))?.points).toBe(3.3);
  });

  it("종합 점수가 0~5 숫자가 아니면 평점이 없는 것으로 본다(이상한 값을 그리지 않는다)", () => {
    for (const points of [null, "", "abc", -0.1, 5.01, Number.NaN]) {
      expect(parseRating(row({ points: points as RatingDbRow["points"] }))).toBeNull();
    }
    expect(parseRating(row({ points: 0 }))?.points).toBe(0);
  });

  it("항목 라벨이 비면 알려진 키의 한글 이름, 모르는 키·점수 이상은 뺀다(raw 키를 지어내지 않는다)", () => {
    const r = parseRating(
      row({
        items: [
          { key: "warmth", label: "", score: 4, note: "다정함" },
          { key: "mystery", score: 3, note: "모름" },
          { key: "trust", label: "믿음", score: 9, note: "범위 밖" },
          "문자열",
          null,
        ],
      }),
    );
    expect(r?.items).toEqual([{ label: "따뜻함", score: 4, note: "다정함" }]);
    expect(parseRating(row({ items: { not: "array" } }))?.items).toEqual([]);
  });

  it("모르는 클레임 값은 버리고, 날짜는 앞 10자리만", () => {
    expect(parseRating(row({ claim: "something" }))?.claim).toBeNull();
    expect(parseRating(row({ claim: "confirmed" }))?.claim).toBe("confirmed");
    expect(parseRating(row({ rated_on: "2026-10-22T00:00:00" }))?.ratedOn).toBe("2026-10-22");
  });
});

describe("표기·색 판정", () => {
  it("소수 한 자리 — 부동소수 반올림 흔들림 없이", () => {
    expect(formatPoints(3.3)).toBe("3.3");
    expect(formatPoints(3.25)).toBe("3.3");
    expect(formatPoints(3.15)).toBe("3.2");
    expect(formatPoints(5)).toBe("5.0");
  });

  it("주의 색은 화면에 보이는 값으로 — '3.0'으로 보이면 주의가 아니다", () => {
    expect(isLowRating(2.9)).toBe(true);
    expect(isLowRating(2.96)).toBe(false);
    expect(isLowRating(3)).toBe(false);
  });

  it("숫자 옆 표식은 검증에서 위험으로 남은 클레임만", () => {
    expect(claimNeedsAttention("confirmed")).toBe(true);
    expect(claimNeedsAttention("needs_check")).toBe(true);
    expect(claimNeedsAttention("cleared")).toBe(false);
    expect(claimNeedsAttention("flagged")).toBe(false);
    expect(claimNeedsAttention(null)).toBe(false);
  });
});

describe("근거 카드", () => {
  it("항목마다 '라벨 점수 · 근거', 해당 없음 항목은 점수 없이 — 넓은 카드로", () => {
    const card = decodeTip(encodeTip(ratingTipCard(parseRating(row())!)));
    expect(card?.title).toBe("평점 3.3");
    expect(card?.meta).toBe("참고용");
    expect(card?.wide).toBe(true);
    expect(card?.rows).toEqual([
      ["따뜻함 2", "멘트 '개념 복습 예습을 반드시 하고 문제를 풀어옵니다.'는 사실 나열 위주"],
      ["개별성 1", "반 친구 4명과 같은 문장 — 이 아이만의 문장이 없음"],
      ["아쉬운 점 전달", "해당 없음"],
      ["알기 쉬움 5", "배운 것·결과·과제 모두 분명"],
      ["믿음 5", "칸과 멘트 일치"],
    ]);
    expect(card?.lines).toEqual([
      '학부모 느낌: "과제도 잘하고 있다는 건 알겠어요"',
      "고치면 좋을 점: 수업 중 아이가 보인 모습을 한 가지 덧붙여 주세요",
      "AI가 2026-10-22에 한 번 매긴 값 — 기준: 학부모가 받았을 때 좋은 느낌인가",
    ]);
  });

  it("클레임은 한글 라벨로 적고 raw 키는 카드 어디에도 없다", () => {
    for (const [claim, label] of [
      ["confirmed", "확정"],
      ["needs_check", "확인 필요"],
      ["cleared", "검증에서 풀림"],
      ["flagged", "1차 판정만"],
    ] as const) {
      const raw = encodeTip(ratingTipCard(parseRating(row({ claim, claim_reason: "칸과 멘트가 실제로 어긋남" }))!));
      const text = tipText(raw);
      expect(text).toContain(`클레임 위험(${label}): 칸과 멘트가 실제로 어긋남`);
      expect(text).not.toMatch(/warmth|personal|concern|clarity|trust|confirmed|needs_check|cleared|flagged/);
    }
  });

  it("근거가 빈 항목도 줄이 사라지지 않는다", () => {
    const r = parseRating(row({ items: [{ key: "warmth", label: "따뜻함", score: 3, note: "" }] }))!;
    expect(decodeTip(encodeTip(ratingTipCard(r)))?.rows).toEqual([["따뜻함 3", "—"]]);
  });
});
