import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  activeUnderstanding,
  clampUnderstanding,
  composePilotMent,
  isMathReportPilot,
  isPilotAutoWritten,
  isPilotDraftCurrent,
  MATH_REPORT_PILOT_STUDENT_IDS,
  progressLead,
  readUnderstanding,
  topicName,
  understandingSig,
  PILOT_AI_DIRECTIVE,
  understandingRows,
} from "./math-report-pilot";
import { evaluateSendGate } from "./send-gate";
import { buildFactBlock, type ReportCommentInput } from "./report-comment";

const PILOT = MATH_REPORT_PILOT_STUDENT_IDS[0]!;

describe("시범 대상 판정", () => {
  it("테스트 학생의 수학 행만", () => {
    expect(isMathReportPilot(PILOT, "math")).toBe(true);
    expect(isMathReportPilot(PILOT, undefined)).toBe(true);
    expect(isMathReportPilot(PILOT, "english")).toBe(false);
    expect(isMathReportPilot("someone-else", "math")).toBe(false);
    expect(isMathReportPilot(null, "math")).toBe(false);
  });
  it("명단은 학생 '테스트'·'학원이' 둘", () => {
    expect(MATH_REPORT_PILOT_STUDENT_IDS).toEqual(["67a53999-fb62-4753-a938-9a5ce4af9e61", "6219e442-aa57-455f-a5bc-834b222d9e1c"]);
  });
});

describe("이름 + 조사", () => {
  it("세 글자는 성을 떼고 받침에 따라 이는/는", () => {
    expect(topicName("이승엽")).toBe("승엽이는");
    expect(topicName("김지수")).toBe("지수는");
    expect(topicName("홍길동 (테스트)")).toBe("길동이는");
  });
  it("동명이인 구분 글자는 뗀다", () => {
    expect(topicName("김라윤A")).toBe("라윤이는");
    expect(topicName("김준영D")).toBe("준영이는");
    expect(topicName("이해율A")).toBe("해율이는");
  });
  it("외자는 성을 떼고, 네 글자는 그대로(복성을 추측하지 않는다)", () => {
    expect(topicName("이윤")).toBe("윤이는");
    expect(topicName("전설")).toBe("설이는");
    expect(topicName("남궁민수")).toBe("남궁민수는");
  });
  it("받침 없는 이름은 '는'", () => {
    expect(topicName("박하나")).toBe("하나는");
    expect(topicName("학원이")).toBe("원이는");
  });
});

describe("진도 첫 문장", () => {
  it("하나 / 둘 / 셋 이상", () => {
    expect(progressLead("이승엽", ["소수와 거듭제곱"])).toBe("승엽이는 오늘 소수와 거듭제곱 진도를 나갔습니다.");
    expect(progressLead("이승엽", ["소인수분해", "최대공약수"])).toBe("승엽이는 오늘 소인수분해와 최대공약수 진도를 나갔습니다.");
    expect(progressLead("이승엽", ["최대공약수", "최소공배수"])).toBe("승엽이는 오늘 최대공약수와 최소공배수 진도를 나갔습니다.");
    expect(progressLead("이승엽", ["소수의 뜻", "거듭제곱", "소인수분해"])).toBe(
      "승엽이는 오늘 소수의 뜻부터 소인수분해까지 진도를 나갔습니다.",
    );
  });
  it("초등 차시 번호는 뗀다", () => {
    expect(progressLead("김지수", ["1-1-1 1부터 5까지의 수 알아보기"])).toBe("지수는 오늘 1부터 5까지의 수 알아보기 진도를 나갔습니다.");
  });
  it("진도 중단일은 그날 한 일을 적는다 · 진도 없으면 빈 문장", () => {
    expect(progressLead("이승엽", [], "월말평가")).toBe("승엽이는 오늘 월말평가 수업을 했습니다.");
    expect(progressLead("이승엽", [])).toBe("");
  });
});

describe("소단원별 이해도", () => {
  const today = "소수와 거듭제곱\n소인수분해\n최대공약수";
  it("뺀 소단원·점수 없는 소단원은 자동작성에 안 들어간다", () => {
    const st = { scores: { 소수와거듭제곱: 3, "소수와 거듭제곱": 8, 소인수분해: 6, 최대공약수: 9 }, off: ["최대공약수"] };
    expect(activeUnderstanding(today, st)).toEqual([
      { title: "소수와 거듭제곱", score: 8 },
      { title: "소인수분해", score: 6 },
    ]);
    expect(activeUnderstanding(today, { scores: { 소인수분해: 7 }, off: [] })).toEqual([{ title: "소인수분해", score: 7 }]);
  });
  it("뺀 줄도 화면에는 남는다(되살리기)", () => {
    const rows = understandingRows(today, { scores: {}, off: ["소인수분해"] });
    expect(rows.map((r) => [r.title, r.off])).toEqual([
      ["소수와 거듭제곱", false],
      ["소인수분해", true],
      ["최대공약수", false],
    ]);
  });
  it("점수는 0~10 정수", () => {
    expect(clampUnderstanding("12")).toBe(10);
    expect(clampUnderstanding("-1")).toBe(0);
    expect(clampUnderstanding("7.6")).toBe(8);
    expect(clampUnderstanding("")).toBeNull();
    expect(clampUnderstanding("abc")).toBeNull();
  });
  it("세션 값의 모양을 믿지 않는다", () => {
    expect(readUnderstanding(null)).toEqual({ scores: {}, off: [] });
    expect(readUnderstanding({ scores: { a: 5, b: "x", c: 99 }, off: ["a", 3] })).toEqual({ scores: { a: 5, c: 10 }, off: ["a"] });
  });
  it("AI 사실 줄에 들어간다", () => {
    const input = { studentName: "a", subject: "수학", progress: "x", dailyTest: "", checkTest: "", attitude: "", homework: "", homeworkToday: "", textbook: "", specialNote: "", understanding: [{ title: "소인수분해", score: 7 }] } satisfies ReportCommentInput;
    expect(buildFactBlock(input)).toContain("소단원별 이해도: 소인수분해 10점 만점에 7점");
  });
});

describe("글 조립", () => {
  it("진도 → 본문 → 특이사항(맨 아래) · 이해도 점수는 글에 숫자로 안 붙는다", () => {
    expect(composePilotMent({ lead: "L", body: "B", note: " 격려 " })).toBe("L\n\nB\n\n격려");
    expect(composePilotMent({ lead: "L", body: "B", note: "" })).toBe("L\n\nB");
  });
  it("AI 지시가 점수를 말로 풀게 한다(강점·응원·격려, 숫자 금지)", () => {
    expect(PILOT_AI_DIRECTIVE).toMatch(/강점/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/격려/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/점수 숫자.*쓰지 마세요/);
  });
});

describe("발송 게이트", () => {
  it("자동작성 글 그대로일 때만", () => {
    expect(isPilotAutoWritten("글", "글")).toBe(true);
    expect(isPilotAutoWritten("글 ", "글")).toBe(true);
    expect(isPilotAutoWritten("고친 글", "글")).toBe(false);
    expect(isPilotAutoWritten("글", undefined)).toBe(false);
    expect(isPilotAutoWritten("", "")).toBe(false);
  });
  const base = { alreadySent: false, isAbsent: false, hasProgress: true, hasDraft: true, attendanceUnchecked: false };
  it("자동작성이 아니면 '자동작성 입력 필요'로 막는다", () => {
    const g = evaluateSendGate({ ...base, needsAutoWrite: true });
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["autowrite"]);
    expect(g.label).toBe("자동작성 입력 필요");
  });
  it("시범 밖 행은 종전 판정", () => {
    expect(evaluateSendGate(base).canSend).toBe(true);
    expect(evaluateSendGate({ ...base, hasDraft: false }).reasons).toEqual(["ment"]);
  });
});

describe("자동작성 뒤에 칸을 바꾸면 다시 눌러야 한다", () => {
  const und = [{ title: "소인수분해", score: 7 }];
  const now = { studentName: "이승엽", today: "소인수분해", note: "잘했어요", understanding: und, writtenSig: understandingSig(und) };
  const draft = composePilotMent({ lead: progressLead("이승엽", ["소인수분해"]), body: "본문", note: "잘했어요" });
  it("그대로면 통과", () => expect(isPilotDraftCurrent(draft, now)).toBe(true));
  it("진도·이해도·특이사항이 바뀌면 막는다", () => {
    expect(isPilotDraftCurrent(draft, { ...now, today: "최대공약수" })).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, understanding: [{ title: "소인수분해", score: 9 }] })).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, understanding: [] })).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, note: "더 잘했어요!" })).toBe(false);
  });
  it("서명이 없으면(새로고침 뒤) 이해도 대조는 건너뛴다", () => {
    expect(isPilotDraftCurrent(draft, { ...now, writtenSig: undefined, understanding: [] })).toBe(true);
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("서버 발송 경로가 저장된 작성 방식으로 다시 막는다", () => {
    const src = read("./server/actions.ts");
    expect(src).toMatch(/isMathReportPilot\(input\.studentId, input\.subject\) && saved\.mentSource !== "auto"/);
    expect(src).toMatch(/mentSource: mentSourceFinal,/);
  });
  it("자동작성 글에 이해도 점수 블록을 붙이지 않는다(말로 풀어 쓴다)", () => {
    expect(read("./server/actions.ts")).not.toMatch(/understandingBlock/);
  });
  it("카드·표 멘트 칸이 시범 대상에서 잠기고 이해도 서명으로 대조한다", () => {
    const card = read("./components/report-card.tsx");
    const grid = read("./components/grid-row.tsx");
    expect(card).toMatch(/readOnly=\{pilot\}/);
    expect(grid).toMatch(/readOnly=\{rowLocked \|\| pilot\}/);
    expect(card).toMatch(/writtenSig: rep\?\.pilotUnderstandingSig/);
    expect(grid).toMatch(/writtenSig: rep\?\.pilotUnderstandingSig/);
  });
});
