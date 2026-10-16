/**
 * 2026-07-30 발송 멘트 전수검사(226건) 뒤 들어간 품질 장치들의 잠금 테스트.
 * 각 항목은 **실제로 학부모에게 나갔던 문장**에서 출발한 것이라, 완화하려면 그 사례부터 다시 볼 것.
 */
import { describe, expect, it } from "vitest";
import {
  COMMENT_STYLE_VARIANTS,
  DEFAULT_PROMPTS,
  OUTPUT_NEWLINE_RULE,
  assembleCombined,
  assembleSingle,
  commentStyleDirective,
  styleSeedIndex,
} from "./prompt-defaults";
import {
  buildTrendInput,
  compressRuns,
  examScales,
  findImpossibleScaleSpans,
  findTrendViolations,
  isTrendScaleSane,
  trendBody,
  TREND_MIXED_SCALE_NOTE,
} from "./trend-comment";

describe("멘트 프롬프트 — 원장 지시 4종이 문구로 박혀 있다", () => {
  const p = DEFAULT_PROMPTS.comment;
  it("추측 금지·비난 금지", () => {
    expect(p).toContain("추측 금지");
    expect(p).toContain("비난 금지");
  });
  it("담임의 목소리로 쓰는 '오늘의 일지'", () => {
    expect(p).toContain("담임 선생님");
    expect(p).toContain("오늘의 일지");
  });
  it("줄바꿈 허용", () => {
    expect(p).toContain("줄바꿈으로 나눠 써도 됩니다");
  });
  it("🔴 획일성 금지 — '오늘은' 고정 시작·고정 순서를 명시로 막는다", () => {
    expect(p).toContain("획일성 금지");
    expect(p).toContain("'오늘은'으로 시작하지 마세요");
  });
  it("🔴 증감은 [입력]에 ▲가 있을 때만 — 추세 이력으로 직접 계산 금지", () => {
    expect(p).toContain("직접 계산하면 안 됩니다");
  });
  it("예시가 하나뿐이면 모델이 그 틀을 베낀다 — 서로 다른 결의 예시 3개", () => {
    expect(p).toContain("예1)");
    expect(p).toContain("예2)");
    expect(p).toContain("예3)");
  });
  it("학부모에게 훈수 두는 문장을 금지한다(폴백 템플릿이 실제로 보내던 종류)", () => {
    expect(p).toContain("복습이 필요합니다");   // 금지 예시로 인용
    expect(p).toContain("훈수");
  });
});

describe("문체 변형 — 같은 반이 복사본을 받지 않게", () => {
  it("시드가 같으면 늘 같은 변형(재생성해도 결이 안 흔들린다)", () => {
    const a = commentStyleDirective("김서연|2026-07-30|수학");
    const b = commentStyleDirective("김서연|2026-07-30|수학");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });
  it("학생이 다르면 변형이 갈린다(같은 반 전원이 같은 틀로 나오지 않게)", () => {
    const seeds = ["김경민", "윤정인", "이채은", "이후성", "정채민", "공서연", "구하람", "김민찬"].map((n) =>
      commentStyleDirective(`${n}|2026-07-29|수학`),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
  it("시드가 비면 변형을 걸지 않는다(기존 동작 보존)", () => {
    expect(commentStyleDirective("")).toBe("");
    expect(commentStyleDirective("   ")).toBe("");
  });
  it("인덱스는 항상 범위 안", () => {
    for (const s of ["", "a", "가나다", "김서연|2026-07-30|수학", "x".repeat(500)]) {
      const i = styleSeedIndex(s, COMMENT_STYLE_VARIANTS.length);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(COMMENT_STYLE_VARIANTS.length);
    }
  });
  it("변형은 순서·초점만 바꾸라고 못박는다(사실 추가 금지)", () => {
    expect(commentStyleDirective("아무개|2026-07-30|수학")).toContain("순서와 초점만");
  });
});

describe("출력 계약 — 줄바꿈 허용하되 JSON은 깨지지 않게", () => {
  it("단일·통합 계약 모두 \\n 표기를 요구한다", () => {
    expect(assembleSingle("본문", "comment")).toContain(OUTPUT_NEWLINE_RULE);
    expect(assembleCombined([{ type: "comment", field: "comment", body: "본문" }])).toContain(OUTPUT_NEWLINE_RULE);
  });
  it("'줄바꿈 없이'라는 옛 계약은 남아 있지 않다", () => {
    expect(assembleSingle("본문", "comment")).not.toContain("줄바꿈 없이");
  });
});

describe("추세 — 척도 혼합 감지", () => {
  const row = (date: string, examInfo: string | null) => ({ date, examInfo, homeworkScore: null });
  it("만점이 같으면 혼합 아님", () => {
    const i = buildTrendInput([row("2026-07-01", "일일 6/10"), row("2026-07-08", "일일 8/10"), row("2026-07-15", "일일 9/10")])!;
    expect(i.scaleMixed).toBe(false);
    expect(trendBody(i)).not.toContain(TREND_MIXED_SCALE_NOTE);
  });
  it("🔴 회차마다 만점이 다르면 **입력에서 뺀다**(2026-10-15) — 증감을 이을 재료 자체가 없다", () => {
    // 실사례(이수진/곽경찬 07-27): "100점 만점에 56점 … 9문제 중 7개, 68점으로 내려갔습니다"
    // 예전엔 둘 다 넘기고 주의를 붙였는데 "만점이 달라 직접 비교하기는 어렵지만"이 30일 261건 나갔다.
    const i = buildTrendInput([row("2026-06-22", "일일 50/100"), row("2026-06-29", "일일 56/100"), row("2026-07-05", "일일 7/9"), row("2026-07-12", "일일 6/9")]);
    // 같은 만점이 2회씩뿐이라 시험 줄이 없고, 과제 기록도 없으니 말할 것이 없다(없는 것보다 거짓이 나쁘다) — quiet(자동작성 추세 칸만 비운다, 2026-10-16).
    expect(i!.facts).toEqual([]);
    expect(i!.quiet).toBe(true);
  });
  it("🔴 한 회차에 만점이 다른 시험이 둘이면 혼합 — 증감 서술을 막는 주의가 붙는다", () => {
    const i = buildTrendInput([row("2026-07-01", "일일 4/5, 확인 8/10"), row("2026-07-08", "일일 5/5, 확인 7/10"), row("2026-07-15", "일일 3/5, 확인 9/10")])!;
    expect(i.scaleMixed).toBe(true);
    expect(trendBody(i)).toContain(TREND_MIXED_SCALE_NOTE);
    expect(TREND_MIXED_SCALE_NOTE).toContain("만점이 다릅니다");
  });
  it("examScales — 분수·'N점 만점' 두 표기를 모두 읽는다", () => {
    expect(examScales("일일 15/20, 확인 18/20")).toEqual([20, 20]);
    expect(examScales("88점(100점 만점)")).toEqual([100]);
    expect(examScales("이름 없는 기록")).toEqual([]);
  });
  it("분모를 못 읽으면 혼합으로 단정하지 않는다 — 그런 시험뿐이면 코드가 정리할 사실이 없어 말할 것이 없다(quiet, 2026-10-16)", () => {
    const i = buildTrendInput([row("2026-07-01", "잘함"), row("2026-07-08", "보통"), row("2026-07-15", "잘함")])!;
    expect(i.facts).toEqual([]);
    expect(i.quiet).toBe(true);
    expect(i.scaleMixed).toBe(false);
  });
});

describe("추세 — 연속 같은 값 묶기(입력 축약)", () => {
  it("이어지는 같은 값은 한 덩이로", () => {
    expect(
      compressRuns([
        { date: "2026-07-06", value: "완료" },
        { date: "2026-07-09", value: "완료" },
        { date: "2026-07-13", value: "완료" },
      ]),
    ).toBe("[07-06~07-13] 완료(3회)");
  });
  it("값이 바뀌는 지점은 끊는다", () => {
    expect(
      compressRuns([
        { date: "2026-07-06", value: "완료" },
        { date: "2026-07-09", value: "완료" },
        { date: "2026-07-13", value: "미제출" },
      ]),
    ).toBe("[07-06~07-09] 완료(2회) -> [07-13] 미제출");
  });
  it("단독 회차는 묶지 않는다 / 빈 입력은 빈 문자열", () => {
    expect(compressRuns([{ date: "2026-07-06", value: "완료" }])).toBe("[07-06] 완료");
    expect(compressRuns([])).toBe("");
  });
  it("점수는 대개 매번 달라 그대로 남는다(축약이 사실을 지우지 않는다)", () => {
    expect(
      compressRuns([
        { date: "2026-07-06", value: "일일 6/10" },
        { date: "2026-07-13", value: "일일 8/10" },
      ]),
    ).toBe("[07-06] 일일 6/10 -> [07-13] 일일 8/10");
  });
});

/**
 * 🔴 2026-08-13 실측 사고: 척도 주의 문구가 이미 있었는데도 이 문장이 학부모에게 나갔다 —
 *    "큰 변화 없이 **9~15문제 중 9~15개** 선을 유지하고 있으며". 모델이 '비교'는 안 했지만 범위로 뭉갠 것.
 *    프롬프트만으로는 못 막는다는 증거라, 생성 뒤 **후검증**을 둔다.
 */
describe("추세 — 사실일 수 없는 척도 표기 후검증", () => {
  it("🔴 분모(문항 수)에 범위가 붙으면 거짓 — 실제로 나간 문장", () => {
    const bad = "큰 변화 없이 9~15문제 중 9~15개 선을 유지하고 있으며, 과제도 대부분 챙겨 오고 있습니다.";
    expect(findImpossibleScaleSpans(bad)).toContain("9~15문제");
    expect(isTrendScaleSane(bad)).toBe(false);
  });

  it("만점에 범위가 붙어도 거짓", () => {
    expect(isTrendScaleSane("9~15점 만점에 8점을 받았습니다")).toBe(false);
  });

  it("하이픈·물결 어느 쪽이든 잡는다", () => {
    expect(isTrendScaleSane("10-20문제 중 절반쯤")).toBe(false);
    expect(isTrendScaleSane("10∼20문제 중 절반쯤")).toBe(false);
  });

  it("✅ 만점이 같고 점수만 범위인 건 **정상**이다 — 막으면 안 된다", () => {
    expect(isTrendScaleSane("10문제 중 8~9개 선을 유지하고 있습니다")).toBe(true);
    expect(isTrendScaleSane("100점 만점에 80~90점을 오가고 있습니다")).toBe(true);
  });

  it("✅ 숫자 없는 서술형 추세는 통과", () => {
    expect(isTrendScaleSane("최근 몇 회차는 예전만큼 점수가 나오지는 않고 있습니다.")).toBe(true);
  });

  it("주의 문구는 숫자를 쓰지 말라고만 한다 — 숫자 예시를 주면 그대로 따라 써 '숫자' 검사로 추세가 버려진다(2026-10-16 저녁)", () => {
    expect(TREND_MIXED_SCALE_NOTE).toContain("숫자(문항 수·점수·몇 개)는 쓰지 마세요");
    expect(TREND_MIXED_SCALE_NOTE).not.toMatch(/\d/);
    // 범위 표기는 생성 뒤 검사 두 겹이 막는다(척도 범위 · 숫자).
    expect(findTrendViolations("9~15문제 중 9~15개 선을 유지하고 있습니다.")).toContain("숫자");
  });
});
