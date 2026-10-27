import { describe, expect, it } from "vitest";
import { OWNER_ANCHORS } from "./owner-anchors";
import {
  AUTO_MENT_CAP,
  OWNER_RUBRIC,
  OWNER_RUBRIC_ID,
  buildOwnerPrompt,
  buildOwnerSystem,
  notesHash,
  ownerCard,
  ownerFinalScore,
  ownerInputHash,
  ownerRatingRow,
  parseOwnerResult,
} from "./owner";

/** 평점 기준 v6(원장 점수표, 2026-10-26) — 판정 재료·해석·코드 규칙을 잠근다. */
const card = { progress: "수학 순환소수", homework_score: "100%", attitude: "좋음", homework_today: "p35~p47", notes: "월말 평가 실시 하였습니다.\n교재는 다음 주 월요일에 검사하겠습니다." };

describe("원장 예시(owner-anchors) — 점수표 44건", () => {
  it("44건 · 보고서 번호 중복 없음 · 점수 1~5 · 지문 16자리", () => {
    expect(OWNER_ANCHORS).toHaveLength(44);
    expect(new Set(OWNER_ANCHORS.map((a) => a.reportId)).size).toBe(44);
    for (const a of OWNER_ANCHORS) {
      expect([1, 2, 3, 4, 5]).toContain(a.score);
      expect(a.notesHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("점수가 고루 있다 — 한쪽 끝만 있으면 눈높이가 기운다", () => {
    for (const s of [1, 2, 3, 4, 5]) expect(OWNER_ANCHORS.filter((a) => a.score === s).length).toBeGreaterThanOrEqual(5);
  });
});

describe("카드 · 지침 · 프롬프트", () => {
  it("카드 = 원장 점수표와 같은 다섯 칸 · 멘트의 줄바꿈은 ' / '", () => {
    expect(ownerCard(card)).toBe(
      "진도: 수학 순환소수\n지난 과제: 100%\n태도: 좋음\n오늘 과제: p35~p47\n멘트: 월말 평가 실시 하였습니다. / 교재는 다음 주 월요일에 검사하겠습니다.",
    );
  });

  it("지문은 공백 차이에 흔들리지 않고, 글이 바뀌면 달라진다", () => {
    expect(notesHash("가 나\n다")).toBe(notesHash(" 가  나 다 "));
    expect(notesHash("가 나 다")).not.toBe(notesHash("가 나 라"));
  });

  it("지침 = 기준 + 예시마다 '→ 원장 N점 (이유)' — 순서는 넘긴 그대로(캐시 지점)", () => {
    const sys = buildOwnerSystem([
      { anchor: { reportId: "a", score: 1, why: "너무 짧음", notesHash: "0".repeat(16) }, card: { ...card, notes: "짧음" } },
      { anchor: { reportId: "b", score: 5, why: "", notesHash: "0".repeat(16) }, card },
    ]);
    expect(sys.startsWith(OWNER_RUBRIC)).toBe(true);
    expect(sys).toContain("[원장이 직접 매긴 예시]");
    expect(sys.indexOf("→ 원장 1점 (너무 짧음)")).toBeLessThan(sys.indexOf("→ 원장 5점"));
    expect(sys).not.toContain("→ 원장 5점 (");
  });

  it("프롬프트 = 매길 카드 + JSON 모양(점수·이유·인용)", () => {
    const p = buildOwnerPrompt(card);
    expect(p).toContain("[매길 보고서]");
    expect(p).toContain(ownerCard(card));
    expect(p).toContain('{"score":3,"reason":"한 줄 이유","evidence":"멘트 인용"}');
  });
});

describe("응답 해석", () => {
  it("1~5 정수(문자 숫자 포함)만 받는다", () => {
    expect(parseOwnerResult({ score: 4, reason: " 성의 ", evidence: "인용" })).toEqual({ score: 4, reason: "성의", evidence: "인용" });
    expect(parseOwnerResult({ score: "2", reason: "기본" })?.score).toBe(2);
    for (const score of [0, 6, 3.5, "3.5", "셋", null, undefined]) expect(parseOwnerResult({ score })).toBeNull();
    for (const data of [null, "문자열", [1], 3]) expect(parseOwnerResult(data)).toBeNull();
  });

  it("이유·인용이 글이 아니면 빈 글로", () => {
    expect(parseOwnerResult({ score: 3, reason: 7, evidence: { x: 1 } })).toEqual({ score: 3, reason: "", evidence: "" });
  });
});

describe("코드 규칙 — 손대지 않은 자동작성은 3점까지", () => {
  it("자동작성(auto)만 내린다 · 고친 자동작성·직접 작성·모름은 그대로", () => {
    const res = { score: 5, reason: "", evidence: "" } as const;
    expect(ownerFinalScore(res, "auto")).toEqual({ score: AUTO_MENT_CAP, capped: true });
    for (const ms of ["auto_edited", "manual", null, undefined]) expect(ownerFinalScore(res, ms)).toEqual({ score: 5, capped: false });
    expect(ownerFinalScore({ score: 2, reason: "", evidence: "" }, "auto")).toEqual({ score: 2, capped: false });
  });
});

describe("저장 행 · 입력 지문", () => {
  it("항목은 '정성·구체성' 하나 — 이유 + 인용, 내렸으면 그 사실을 앞에", () => {
    const row = ownerRatingRow("r1", { score: 4, reason: "학부모에게 직접 일정 안내", evidence: "다음 주 월요일에 검사" }, "auto", "claude-haiku-5-5", "h");
    expect(row).toMatchObject({ report_id: "r1", points: 3, rubric: OWNER_RUBRIC_ID, model: "claude-haiku-5-5", input_hash: "h", claim: null, parent_feeling: null, suggestion: null });
    expect(row.items).toEqual([{ key: "owner", label: "정성·구체성", score: 3, note: "손대지 않은 자동작성 멘트라 3점까지 · 학부모에게 직접 일정 안내 · “다음 주 월요일에 검사”" }]);
  });

  it("이유·인용이 다 비어도 근거 칸은 '—'(빈 줄을 그리지 않는다)", () => {
    expect(ownerRatingRow("r1", { score: 2, reason: "", evidence: "" }, "manual", "m", "h").items[0]!.note).toBe("—");
  });

  it("지문은 학부모가 받는 칸 · 작성 방식이 바뀌면 달라진다", () => {
    const base = ownerInputHash("r1", card, "auto");
    expect(ownerInputHash("r1", { ...card }, "auto")).toBe(base);
    expect(ownerInputHash("r1", { ...card, notes: "고친 멘트" }, "auto")).not.toBe(base);
    expect(ownerInputHash("r1", card, "auto_edited")).not.toBe(base);
    expect(ownerInputHash("r2", card, "auto")).not.toBe(base);
  });
});
