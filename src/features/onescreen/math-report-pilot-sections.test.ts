import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  homeworkSentence,
  MAKEUP_TEST_PROMISE,
  pilotBody,
  pilotFactsSig,
  readTestSkip,
  testSkipComplete,
  testSkipText,
  type PilotFacts,
} from "./math-report-pilot-sections";
import { evaluateSendGate } from "./send-gate";

const facts: PilotFacts = {
  progress: "연립방정식",
  dailyTest: "5문제 중 4개 맞음 (지난 회차 대비 ▲1)",
  checkTest: "",
  attitude: "매우 좋음",
  homework: "90%",
  homeworkToday: "5p 풀기",
};

describe("항목별 글(원장 2026-10-22 — 섹션을 나눠 어떤 것에 어떤 답인지)", () => {
  it("항목마다 제목이 붙고 값이 없는 항목은 빠진다", () => {
    expect(pilotBody(facts, { understandingText: "연립방정식을 잘 소화했습니다." })).toBe(
      [
        "■ 일일 테스트\n5문제 중 4개 맞음",
        "■ 수업 태도\n매우 좋았습니다.",
        "■ 과제 수행률\n지난 과제를 90% 해 왔습니다.",
        "■ 이해도\n연립방정식을 잘 소화했습니다.",
        "■ 오늘 과제\n5p 풀기",
      ].join("\n\n"),
    );
  });
  it("이해도를 안 매겼으면 이해도 항목이 없다 · 영상 숙제는 오늘 과제에", () => {
    const out = pilotBody({ ...facts, videoHomework: true, videoHomeworkDue: "10/29 (목)까지" }, {});
    expect(out).not.toContain("■ 이해도");
    expect(out).toContain("■ 오늘 과제\n5p 풀기\n영상 숙제가 있습니다(10/29 (목)까지 제출).");
  });
  it("지난 과제 수행률을 문장으로 — 고른 값만 옮긴다", () => {
    expect(homeworkSentence("100%")).toBe("지난 과제를 100% 해 왔습니다.");
    expect(homeworkSentence("없음")).toBe("지난 시간에 내준 과제가 없었습니다.");
    expect(homeworkSentence("—")).toBe("");
  });
});

describe("일일 테스트 있음/없음 · 사유", () => {
  it("'없음'이면 점수 대신 사유 문장 + 덧붙인 말", () => {
    const out = pilotBody({ ...facts, dailyTestSkip: { reason: "sick", detail: "감기 기운이 있었습니다." } }, {});
    expect(out).toContain("■ 일일 테스트\n오늘은 몸이 좋지 않아 일일 테스트를 보지 않았습니다. 감기 기운이 있었습니다.");
    expect(out).not.toContain("5문제 중");
  });
  it("이해도가 느리거나 선생님 판단이면 보충 시험 약속이 들어간다", () => {
    expect(testSkipText({ reason: "slow", detail: "" })).toContain(MAKEUP_TEST_PROMISE);
    expect(testSkipText({ reason: "teacher", detail: "" })).toContain(MAKEUP_TEST_PROMISE);
    expect(testSkipText({ reason: "sick", detail: "" })).not.toContain(MAKEUP_TEST_PROMISE);
    expect(testSkipText({ reason: "parent", detail: "" })).toContain("어머님의 요청으로");
  });
  it("아이를 탓하는 말을 쓰지 않는다", () => {
    expect(testSkipText({ reason: "slow", detail: "" })).not.toMatch(/느려|느림|못해|부족/);
  });
  it("사유를 다 적었나 — 미선택·'기타'인데 빈 말이면 아직", () => {
    expect(testSkipComplete(null)).toBe(true);
    expect(testSkipComplete({ reason: null, detail: "" })).toBe(false);
    expect(testSkipComplete({ reason: "other", detail: " " })).toBe(false);
    expect(testSkipComplete({ reason: "other", detail: "학교 행사" })).toBe(true);
    expect(testSkipComplete({ reason: "sick", detail: "" })).toBe(true);
  });
  it("세션 값의 모양을 믿지 않는다", () => {
    expect(readTestSkip(null)).toBeNull();
    expect(readTestSkip({ reason: "hack", detail: 3 })).toEqual({ reason: null, detail: "" });
    expect(readTestSkip({ reason: "slow", detail: "a\nb" })).toEqual({ reason: "slow", detail: "a b" });
  });
  it("사유가 비면 '일일 테스트 사유 입력 필요'로 막는다", () => {
    const g = evaluateSendGate({ needsTestReason: true, alreadySent: false, isAbsent: false, hasProgress: true, hasDraft: true, attendanceUnchecked: false });
    expect(g.reasons).toEqual(["testreason"]);
    expect(g.label).toBe("일일 테스트 사유 입력 필요");
  });
});

describe("사실 서명", () => {
  const und = [{ title: "연립방정식", score: 7 }];
  const base = pilotFactsSig(facts, und);
  it("지난 회차 꼬리는 서명에 안 들어간다(같은 점수면 같은 서명)", () => {
    expect(pilotFactsSig({ ...facts, dailyTest: "5문제 중 4개 맞음" }, und)).toBe(base);
  });
  it("태도·과제·이해도·시험 없음 사유가 바뀌면 서명이 바뀐다", () => {
    expect(pilotFactsSig({ ...facts, attitude: "좋음" }, und)).not.toBe(base);
    expect(pilotFactsSig({ ...facts, homework: "80%" }, und)).not.toBe(base);
    expect(pilotFactsSig(facts, [{ title: "연립방정식", score: 9 }])).not.toBe(base);
    expect(pilotFactsSig({ ...facts, dailyTestSkip: { reason: "sick", detail: "" } }, und)).not.toBe(base);
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("서버는 시범 대상 AI 입력에서 테스트·태도·과제를 비우고 이해도 항목만 받는다", () => {
    const src = read("./server/actions.ts");
    expect(src).toMatch(/input: aiInput,/);
    expect(src).toMatch(/pilot && !safeInput\.understanding\?\.length/);
    expect(src).toMatch(/const comment = pilot \? composePilot\(res\.comment, videoReceipt\) : body;/);
  });
  it("세션이 '시험 없음' 사유를 싣고 로스터가 되읽는다 · '없음'이면 점수를 비운다", () => {
    expect(read("./components/onescreen-client.tsx")).toMatch(/dailyTestSkip: su\.dailyTestSkip/);
    expect(read("./components/onescreen-client.tsx")).toMatch(/dailyTestSkip: skip, \.\.\.\(skip \? \{ dailyScore: null \} : \{\}\)/);
    expect(read("./server/roster.ts")).toMatch(/su\.dailyTestSkip = readTestSkip\(entry\.dailyTestSkip\)/);
  });
});

describe("'시험 없음'이면 점수를 어디서도 읽지 않는다", () => {
  it("행 값 해석(row-fields)이 점수를 비운다 — 저장·추세·멘트가 같은 값을 본다", async () => {
    const { resolveRowFields } = await import("./row-fields");
    const student = {
      tests: { daily: { score: 4, max: 5, prevScore: null }, check: { score: null, max: 10, prevScore: null } },
      attitude: null,
      homework: "",
    } as unknown as Parameters<typeof resolveRowFields>[0];
    const row = { name: "수학", dailyScore: 4, dailyTestSkip: { reason: "sick", detail: "" } } as unknown as Parameters<typeof resolveRowFields>[1];
    expect(resolveRowFields(student, row).tests.daily.score).toBeNull();
    expect(resolveRowFields(student, { ...row!, dailyTestSkip: null }).tests.daily.score).toBe(4);
  });
});
