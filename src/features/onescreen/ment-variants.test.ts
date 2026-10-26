import { describe, expect, it } from "vitest";
import { asVariety, pickVariant } from "./ment-variants";
import {
  fallbackUnderstanding,
  isPilotDraftCurrent,
  PILOT_AI_DIRECTIVE,
  PILOT_SECTION_TITLES,
  PROGRESS_CLOSES,
  composePilotMent,
  pilotSection,
  progressLead,
  progressLeadHead,
} from "./math-report-pilot";
import {
  HOMEWORK_FULL,
  NO_DAILY_TEST_TEXTS,
  SCORE_REMARKS,
  homeworkSentence,
  pilotBody,
  pilotFactsSig,
  scoreRemark,
} from "./math-report-pilot-sections";
import { prevPhrasingHint } from "./pilot-notes";

const LIST = ["가", "나", "다"];

describe("갈래 고르기(원장 2026-10-26 매크로성 반복 금지)", () => {
  it("variety가 없으면 첫 갈래(종전 문장)", () => {
    expect(pickVariant(LIST, null, "f")).toBe("가");
    expect(scoreRemark("5문제 중 5개 맞음")).toBe(SCORE_REMARKS.perfect[0]);
  });
  it("같은 시드면 늘 같은 갈래(다시 눌러도 흔들리지 않는다)", () => {
    const v = { seed: "s1|2026-10-26|math" };
    expect(pickVariant(LIST, v, "f")).toBe(pickVariant(LIST, v, "f"));
  });
  it("직전 글에 쓴 갈래는 피한다", () => {
    const v = { seed: "s1|2026-10-26|math" };
    const first = pickVariant(LIST, v, "f");
    expect(pickVariant(LIST, { ...v, prev: `어제 글 … ${first} …` }, "f")).not.toBe(first);
  });
  it("날짜가 바뀌면 갈래가 돈다(여러 날 중 적어도 두 갈래가 나온다)", () => {
    const seen = new Set(Array.from({ length: 10 }, (_, i) => pickVariant(LIST, { seed: `s1|2026-10-${10 + i}` }, "f")));
    expect(seen.size).toBeGreaterThan(1);
  });
  it("`.map(fn)`의 세 번째 인자(배열)는 Variety가 아니다", () => {
    expect(asVariety([1, 2])).toBeNull();
    expect(["100%"].map(homeworkSentence)[0]).toBe(HOMEWORK_FULL[0]);
  });
});

describe("갈래가 바뀌어도 사실·대조는 그대로", () => {
  const BASE = { dailyTest: "", checkTest: "", attitude: "", homework: "", homeworkToday: "" };
  it("빈 테스트 문구는 갈래 목록 안에서", () => {
    const body = pilotBody(BASE, { variety: { seed: "x|2026-10-27" } });
    expect(NO_DAILY_TEST_TEXTS.some((t) => body.includes(t))).toBe(true);
  });
  it("사실 서명은 글이 아니라 값으로 — 갈래와 무관", () => {
    expect(pilotFactsSig(BASE, [])).toBe(pilotFactsSig(BASE, []));
  });
  it("진도 마무리는 갈래, 첫 문장은 그대로 — 자동작성 글 대조가 통과한다", () => {
    const v = { seed: "s9|2026-10-27|math" };
    const lead = progressLead("이승엽", ["소인수분해"], null, null, v);
    const head = progressLeadHead("이승엽", ["소인수분해"]);
    expect(lead.startsWith(head)).toBe(true);
    expect(PROGRESS_CLOSES.진도.some((c) => lead.endsWith(c))).toBe(true);
    const draft = composePilotMent({ lead: pilotSection(PILOT_SECTION_TITLES.progress, lead), body: "본문", note: "잘했어요" });
    expect(isPilotDraftCurrent(draft, { studentName: "이승엽", today: "소인수분해", progressMode: null, note: "잘했어요", factsSig: "a", writtenSig: "a" })).toBe(true);
  });
});

describe("'오늘의 수업' — 소단원을 나열하지 않고 묶는다(원장 2026-10-26)", () => {
  it("지시가 요약·묶기를 요구한다", () => {
    expect(PILOT_AI_DIRECTIVE).toContain("나열하지 말고");
    expect(PILOT_AI_DIRECTIVE).toContain("2~4문장");
  });
  it("대체 글도 이해 정도별로 묶고 '챙기겠습니다'는 한 번만", () => {
    const t = fallbackUnderstanding([
      { title: "함수", score: 9 },
      { title: "그래프", score: 10 },
      { title: "방정식", score: 6 },
      { title: "부등식", score: 3 },
    ]);
    expect(t).toBe(
      "'함수'와 '그래프'는 잘 이해하고 있습니다. '방정식'은 대체로 잘 따라왔지만 아직 조금 어려워했습니다. '부등식'은 조금 힘들어했습니다. 그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.",
    );
    expect(t.match(/챙기겠습니다/g)?.length).toBe(1);
  });
});

describe("직전 표현 참고(AI)", () => {
  it("항목 글의 '오늘의 수업' 문단만, 사실이 아님을 밝혀서", () => {
    const prev = "■ 진도\n어제 진도\n\n■ 오늘의 수업\n함수를 잘 이해했습니다.";
    const hint = prevPhrasingHint(prev);
    expect(hint).toContain("함수를 잘 이해했습니다.");
    expect(hint).toContain("사실이 아니라 표현 참고용");
    expect(hint).not.toContain("어제 진도");
  });
  it("항목 글이 아니거나 문단이 없으면 빈 값", () => {
    expect(prevPhrasingHint("손글씨 보고서")).toBe("");
    expect(prevPhrasingHint(null)).toBe("");
  });
});
