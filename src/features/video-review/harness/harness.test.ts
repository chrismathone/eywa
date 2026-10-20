import { describe, expect, it } from "vitest";
import { applyTermDict } from "./term-dict";
import { formatMaterial, speechStats, transcriptLines } from "./transcript";
import { buildResult, claimsFrom, fixNote, overallOf } from "./result";
import { parseVerdict, VERIFY_SYSTEM, verifyMaterial, verifyPrompt } from "./prompt-verify";
import { JUDGE_SYSTEM, judgePrompt } from "./prompt-judge";

describe("applyTermDict", () => {
  it("고친 곳에 원래 말을 남긴다", () => {
    expect(applyTermDict("정면 면체 전개도")).toBe("정육면체(전사: 정면 면체) 전개도");
  });
  it("긴 말을 먼저 바꾸고, 바꾼 자리를 짧은 항목이 다시 건드리지 않는다", () => {
    expect(applyTermDict("원조율은 원조 나누기 지름")).toBe("원주율(전사: 원조율)은 원주(전사: 원조) 나누기 지름");
  });
  it("사전에 없는 말은 그대로", () => {
    expect(applyTermDict("괄호를 먼저 푼다")).toBe("괄호를 먼저 푼다");
  });
});

describe("speechStats · transcriptLines", () => {
  const words = [[0, "음"], [500, "정비를"], [4000, "관계는"], [4500, "대충"], [11000, "끝"]] as const;
  it("3초 넘는 멈춤과 군말을 센다", () => {
    const st = speechStats(words);
    expect(st.pauses).toEqual(["00:00~00:04(3.5초)", "00:04~00:11(6.5초)"]);
    expect(st.fillers).toEqual({ 음: 1, 대충: 1 });
    expect(st.lastAt).toBe(11000);
  });
  it("멈춤에서 줄을 바꾼다", () => {
    expect(transcriptLines(words).map((l) => l.text)).toEqual(["음 정비를", "관계는 대충", "끝"]);
  });
  it("자료에 사전 보정과 이 영상의 메모 금지어가 들어간다", () => {
    const m = formatMaterial({ words, durationSec: 12, grade: "초6", progress: null });
    expect(m).toContain("정비례(전사: 정비를)");
    expect(m).toContain("메모 금지어: '막힘 없이·끊김 없이·멈춤 없이', '군말 없이'");
    expect(m).toContain("[최근 진도] 기록 없음");
  });
  it("말이 없으면 그렇게 적는다", () => {
    expect(formatMaterial({ words: [], durationSec: 5, grade: null, progress: null })).toContain("말소리가 전사되지 않음");
  });
});

describe("claimsFrom", () => {
  it("검산에서 '틀림'인 주장만 남긴다", () => {
    const judge = {
      checks: [{ no: 1, result: "맞음" }, { no: 2, result: "틀림" }],
      mistakes: [
        { check: 1, where: "f01_00m02s", seen: "a", why_wrong: "x" },
        { check: 2, where: "f02_00m05s", seen: "b", why_wrong: "y" },
        { check: 2, where: "", seen: "c", why_wrong: "z" },
      ],
    };
    expect(claimsFrom(judge).map((c) => c.where)).toEqual(["f02_00m05s"]);
  });
});

describe("overallOf", () => {
  it("정확성 2 이하면 보완 필요, 고르게 높고 이유 3 이상이면 잘함", () => {
    expect(overallOf({ accuracy: 2, order: 5, reasoning: 5, terms: 5, delivery: 5 })).toBe("needs_work");
    expect(overallOf({ accuracy: 5, order: 4, reasoning: 3, terms: 4, delivery: 4 })).toBe("good");
    expect(overallOf({ accuracy: 5, order: 5, reasoning: 1, terms: 5, delivery: 5 })).toBe("fair");
  });
});

describe("fixNote", () => {
  it("멈춤·군말·판독 보류와 부딪치는 표현을 고친다", () => {
    const sp = { pauses: ["00:01~00:05(4.0초)"], fillers: { 뭐: 1 } };
    expect(fixNote("막힘 없이 군말 없이 모두 맞게 썼다", sp, true)).toBe("끝까지 군말이 적게 확인한 범위에서 맞게 썼다");
    expect(fixNote("막힘 없이 말했다", { pauses: [], fillers: {} }, false)).toBe("막힘 없이 말했다");
  });
});

describe("buildResult", () => {
  const judge = {
    topic: "원기둥 전개도",
    scores: { accuracy: { score: 1, evidence: "f07" }, order: { score: 4, evidence: "" }, reasoning: { score: 2, evidence: "" }, terms: { score: 4, evidence: "" }, delivery: { score: 3, evidence: "" } },
    checks: [{ no: 1, result: "틀림" }, { no: 2, result: "틀림" }],
    mistakes: [
      { check: 1, where: "f07_01m10s", seen: "28.26", why_wrong: "원의 넓이" },
      { check: 2, where: "f09_01m30s", seen: "16x", why_wrong: "계수" },
    ],
    unclear: ["세 번째 그림"],
    teacher_note: "막힘 없이 설명했다",
  };
  const base = { speech: { pauses: ["x"], fillers: {} }, judgeModel: "claude-haiku-5-5", verifyModel: "claude-sonnet-5-5", now: new Date("2026-10-21T00:00:00Z") };
  it("확정만 오류, 애매는 확인 필요로", () => {
    const r = buildResult({ ...base, judge, verdicts: ["확정", "애매"] });
    expect(r.mistakes).toHaveLength(1);
    expect(r.needsCheck).toEqual(["f09_01m30s — 계수", "세 번째 그림"]);
    expect(r.overall).toBe("needs_work");
    expect(r.note).toBe("끝까지 설명했다");
  });
  it("확정 오류가 없으면 정확성 감점을 4로 되돌린다", () => {
    const r = buildResult({ ...base, judge, verdicts: ["반증", "고침"] });
    expect(r.mistakes).toHaveLength(0);
    expect(r.selfFixed).toEqual(["f09_01m30s — 계수"]);
    expect(r.scores.accuracy.score).toBe(4);
  });
  it("확인을 안 거쳤으면 주장은 모두 확인 필요", () => {
    expect(buildResult({ ...base, judge, verdicts: null }).needsCheck).toHaveLength(3);
  });
});

describe("parseVerdict", () => {
  it("모르는 값은 애매", () => {
    expect(parseVerdict({ verdict: "확정" })).toBe("확정");
    expect(parseVerdict({ verdict: "maybe" })).toBe("애매");
    expect(parseVerdict(null)).toBe("애매");
  });
});

describe("프롬프트 갈래 — 고정 글은 system, 영상 자료는 본문(프롬프트 캐시 2026-10-21)", () => {
  const labels = ["f01_00m01s", "last_00m35s_hi"];
  it("판정: system에 순서·금지 전부, 본문에 자료·화면·출력 형식 — 영상 자료가 system에 새지 않는다", () => {
    const body = judgePrompt("[전사]\n[00:01] 정육면체", labels);
    expect(JUDGE_SYSTEM).toContain("[0단계 전사 보정]");
    expect(JUDGE_SYSTEM).toContain("[금지]");
    expect(JUDGE_SYSTEM).not.toContain("정육면체");
    expect(body).not.toContain("[0단계 전사 보정]");
    expect(body).toContain("[00:01] 정육면체");
    expect(body).toContain("[화면] 2장");
    expect(body).toContain("last_00m35s_hi");
    expect(body.trimEnd().endsWith("}")).toBe(true); // 출력 형식(JSON)이 맨 끝
  });
  it("확인: 자료(캐시 글)에는 주장이 없고, 본문은 주장 하나뿐", () => {
    const prefix = verifyMaterial("[전사]\n[00:01] 둘레", labels);
    const body = verifyPrompt({ where: "f01_00m01s", seen: "2x3=5", why_wrong: "곱셈" });
    expect(VERIFY_SYSTEM).toContain("반박 담당");
    expect(prefix).toContain("[00:01] 둘레");
    expect(prefix).toContain("[화면] 2장");
    expect(prefix).not.toContain("받은 주장");
    expect(body).toContain("[받은 주장]");
    expect(body).toContain("2x3=5");
    expect(body).not.toContain("둘레");
  });
});
