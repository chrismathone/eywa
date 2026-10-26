import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  homeworkLevel,
  homeworkSentence,
  isHomeworkMissed,
  needsHomeworkMissReason,
  readHomeworkMissReason,
  levelTableText,
  pilotLevelsSection,
  scoreRemark,
  understandingLevel,
  MAKEUP_TEST_PROMISE,
  pilotBody,
  pilotFactsSig,
  readTestSkip,
  testSkipComplete,
  testSkipText,
  type PilotFacts,
} from "./math-report-pilot-sections";
import { parseLevelRows } from "./pilot-notes";
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
    expect(
      pilotBody({ ...facts, understanding: [{ title: "연립방정식", score: 7 }] }, { understandingText: "연립방정식을 잘 소화했습니다." }),
    ).toBe(
      [
        "■ 일일 테스트\n5문제 중 4개 맞음\n대부분 잘 맞혔습니다. 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.",
        "■ 수업 태도\n오늘 수업 태도가 매우 좋았습니다. 처음부터 끝까지 집중해서 성실하게 참여했습니다.",
        "■ 숙제 완성도\n지난 시간 과제를 90% 해 왔습니다. 거의 다 해 왔고, 남은 부분은 수업 시간에 함께 확인하겠습니다.",
        "■ 오늘의 수업\n연립방정식을 잘 소화했습니다.",
        "■ 오늘의 숙제\n5p 풀기",
      ].join("\n\n"),
    );
  });
  it("이해도를 안 매겼으면 이해도 항목이 없다 · 영상 숙제는 오늘의 숙제에", () => {
    const out = pilotBody({ ...facts, videoHomework: true, videoHomeworkDue: "10/29 (목)까지" }, {});
    expect(out).not.toContain("■ 오늘의 수업");
    expect(out).toContain("■ 오늘의 숙제\n5p 풀기\n영상 숙제가 있습니다(10/29 (목)까지 제출).");
    expect(out).not.toContain("아래와 같습니다");
    expect(out).not.toContain("잘 해 왔는지");
  });
  it("숙제 미제출이면 강사가 적은 사유가 두 문장 사이에 들어간다(원장 2026-10-23)", () => {
    expect(homeworkSentence("미제출", "감기로 몸이 좋지 않았다고 합니다")).toBe(
      "지난 시간 과제를 아직 해 오지 못했습니다. 감기로 몸이 좋지 않았다고 합니다. 다음 시간에 함께 확인하고 꼭 마무리하도록 하겠습니다.",
    );
    expect(homeworkSentence("0%", "학교 행사가 있었습니다.")).toContain("못했습니다. 학교 행사가 있었습니다. 다음 시간에");
    // 미제출이 아니면 사유를 안 싣는다(옛 값이 남아 있어도)
    expect(homeworkSentence("80%", "감기")).not.toContain("감기");
    expect(pilotBody({ ...facts, homework: "미제출", homeworkMissReason: "감기" }, {})).toContain("■ 숙제 완성도\n지난 시간 과제를 아직 해 오지 못했습니다. 감기. 다음 시간에");
  });
  it("미제출 판정 · 사유 필수(발송 게이트) · 세션 값 복원", () => {
    expect(isHomeworkMissed("미제출")).toBe(true);
    expect(isHomeworkMissed("0%")).toBe(true);
    expect(isHomeworkMissed("50%")).toBe(false);
    expect(isHomeworkMissed("없음")).toBe(false);
    expect(isHomeworkMissed("")).toBe(false);
    expect(needsHomeworkMissReason("미제출", "")).toBe(true);
    expect(needsHomeworkMissReason("미제출", "  ")).toBe(true);
    expect(needsHomeworkMissReason("미제출", "감기")).toBe(false);
    expect(needsHomeworkMissReason("80%", "")).toBe(false);
    expect(readHomeworkMissReason("a\nb")).toBe("a b");
    expect(readHomeworkMissReason(3)).toBe("");
    expect(readHomeworkMissReason("x".repeat(300))).toHaveLength(200);
  });
  it("지난 과제 수행률을 문장으로 — 고른 값만 옮긴다", () => {
    expect(homeworkSentence("100%")).toContain("빠짐없이 모두 해 왔습니다");
    expect(homeworkSentence("완료")).toContain("빠짐없이 모두 해 왔습니다");
    expect(homeworkSentence("80%")).toMatch(/^지난 시간 과제를 80% 해 왔습니다\. /);
    expect(homeworkSentence("20%")).toContain("꼭 마무리하겠습니다");
    expect(homeworkSentence("미제출")).toContain("아직 해 오지 못했습니다");
    expect(homeworkSentence("0%")).toBe(homeworkSentence("미제출"));
    expect(homeworkSentence("없음")).toBe(""); // 과제 없던 날은 항목째 뺀다(원장 2026-10-23)
    expect(homeworkSentence("일부 미흡")).toBe("일부 미흡");
    expect(homeworkSentence("—")).toBe("");
  });
});

describe("수업 평가 표(원장 2026-10-22 — 하·중하·중·중상·상)", () => {
  it("과제 수행률 경계 · 과제가 없던 날은 줄을 뺀다", () => {
    expect(homeworkLevel("90%")).toBe("상");
    expect(homeworkLevel("89%")).toBe("중상");
    expect(homeworkLevel("50%")).toBe("중");
    expect(homeworkLevel("미제출")).toBe("하");
    expect(homeworkLevel("없음")).toBeNull();
    expect(homeworkLevel("")).toBeNull();
  });
  it("이해도 = 매긴 소단원 평균 · AI 지시(8 이상 강점 · 5~7 중간 · 4 이하 낮음)와 같은 쪽", () => {
    expect(understandingLevel([{ score: 10 }, { score: 8 }])).toBe("상");
    expect(understandingLevel([{ score: 8 }])).toBe("중상");
    expect(understandingLevel([{ score: 7 }])).toBe("중");
    expect(understandingLevel([{ score: 4 }])).toBe("중하");
    expect(understandingLevel([{ score: 2 }])).toBe("하");
    expect(understandingLevel([])).toBeNull();
  });
  it("표 모양 — 머리 줄 + 고른 칸에 ● · 전각 공백으로 칸을 맞춘다(첫 줄은 '구분'으로 시작해 trim에 안 깎인다)", () => {
    const t = levelTableText({ attitude: "매우 좋음", homework: "80%", understanding: [{ title: "a", score: 7 }] }).split("\n");
    expect(t[0]).toBe("구분\u3000\u3000\u3000\u3000\u3000하\u3000\u3000중하\u3000중\u3000\u3000중상\u3000상");
    expect(t[1]).toBe("수업\u3000태도\u3000\u3000○\u3000\u3000○\u3000\u3000○\u3000\u3000○\u3000\u3000●\u3000상");
    expect(t[2]).toBe("숙제\u3000완성도\u3000○\u3000\u3000○\u3000\u3000○\u3000\u3000●\u3000\u3000○\u3000중상");
    expect(t[3]).toBe("이해도\u3000\u3000\u3000\u3000○\u3000\u3000○\u3000\u3000●\u3000\u3000○\u3000\u3000○\u3000중");
    expect(t.every((l) => !l.includes(" "))).toBe(true);
    expect(pilotLevelsSection({ attitude: "좋음", homework: "" })).toMatch(/^■ 수업 평가\n구분/);
  });
  it("값이 없는 줄도 지우지 않고 '없음'으로 남긴다(원장 2026-10-26) · 옛 태도 값은 정도를 몰라 뺀다", () => {
    const empty = levelTableText({ attitude: "", homework: "", understanding: [] });
    expect(empty).toContain("수업　태도　　— 평가 없음");
    expect(empty).toContain("— 숙제 없음");
    expect(empty).toContain("이해도");
    // 영어(understanding을 안 넘김)엔 이해도 줄이 없다.
    expect(levelTableText({ attitude: "", homework: "" })).not.toContain("이해도");
    // 옛 자유입력 태도('최고')는 줄째 빠지고, 숙제 '없음'은 '숙제 없음'으로 남는다.
    const legacy = levelTableText({ attitude: "최고", homework: "없음" });
    expect(legacy).not.toContain("태도");
    expect(legacy).toContain("— 숙제 없음");
    expect(pilotBody(facts, {})).not.toContain("■ 수업 평가");
  });
  it("'없음' 줄은 카드가 그대로 읽는다", () => {
    const rows = parseLevelRows(levelTableText({ attitude: "좋음", homework: "", understanding: [] }));
    expect(rows).toEqual([
      { label: "수업 태도", level: "중상" },
      { label: "숙제 완성도", level: null, none: "숙제 없음" },
      { label: "이해도", level: null, none: "평가 없음" },
    ]);
  });
});

describe("점수 뒤 덧붙이는 말", () => {
  it("다 맞음 / 8할 이상 / 절반 이상 / 그 아래 · 형식이 다르면 없음", () => {
    expect(scoreRemark("5문제 중 5개 맞음")).toContain("모두 맞혔습니다");
    expect(scoreRemark("10문제 중 8개 맞음")).toContain("대부분");
    expect(scoreRemark("10문제 중 5개 맞음")).toContain("절반 이상");
    expect(scoreRemark("10문제 중 2개 맞음")).toContain("다음 시간에");
    expect(scoreRemark("시험")).toBe("");
    expect(scoreRemark("5문제 중 7개 맞음")).toBe("");
  });
  it("사람이 안 쓰는 말투를 쓰지 않는다(원장 2026-10-23)", () => {
    const all = [
      ...[0, 2, 5, 8, 10].map((k) => scoreRemark(`10문제 중 ${k}개 맞음`)),
      ...["0%", "40%", "60%", "95%", "100%", "미제출"].map((v) => homeworkSentence(v)),
    ];
    for (const t of all) expect(t).not.toMatch(/칭찬해 주고 싶|대견|응원하겠|챙겨 주었/);
  });
  it("아이를 탓하는 말을 쓰지 않는다", () => {
    for (const k of [0, 2, 5, 8]) expect(scoreRemark(`10문제 중 ${k}개 맞음`)).not.toMatch(/못했|부족|느려/);
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
    expect(src).toMatch(/composePilot\(cleanPilotUnderstanding\(res\.comment, safeInput\.understanding \?\? \[\]\), videoReceipt, varietyOf\(prevNotes\)\)/);
    expect(src).toMatch(/extraDirective: \[pilotAiDirective\(input\.studentName\), prevPhrasingHint\(prevNotes\)\]/);
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
