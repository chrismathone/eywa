import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  understandingPresetOf,
  activeUnderstanding,
  ratedUnderstanding,
  fallbackUnderstanding,
  clampUnderstanding,
  composePilotMent,
  isMathReportPilot,
  isPilotAutoWritten,
  isPilotDraftCurrent,
  hasPilotOneLine,
  pilotOneLineAttached,
  pilotRecomposeNote,
  pilotCanEdit,
  pilotNeedsAutoWrite,
  progressLead,
  readUnderstanding,
  topicName,
  pilotSection,
  PILOT_AI_DIRECTIVE,
  callName,
  cleanPilotUnderstanding,
  pilotAiDirective,
  understandingRows,
  UNDERSTANDING_DEFAULT,
  UNDERSTANDING_PRESETS,
  setAllUnderstanding,
  hasStoredUnderstanding,
} from "./math-report-pilot";
import { evaluateSendGate } from "./send-gate";
import { buildFactBlock, type ReportCommentInput } from "./report-comment";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

const PILOT = "67a53999-fb62-4753-a938-9a5ce4af9e61";

describe("새 수학 보고서 대상 판정 — 수학 전원(원장 2026-10-26)", () => {
  it("학생이 있는 수학 행이면 누구든", () => {
    expect(isMathReportPilot(PILOT, "math")).toBe(true);
    expect(isMathReportPilot(PILOT, undefined)).toBe(true);
    expect(isMathReportPilot("someone-else", "math")).toBe(true);
  });
  it("영어 행·학생을 모르는 화면은 아니다", () => {
    expect(isMathReportPilot(PILOT, "english")).toBe(false);
    expect(isMathReportPilot(null, "math")).toBe(false);
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
    const close = " 오늘 배운 내용이 잘 자리 잡을 수 있도록 다음 시간에도 이어서 꼼꼼히 다지겠습니다.";
    expect(progressLead("이승엽", ["소수와 거듭제곱"])).toBe(`우리 승엽이는 오늘 '소수와 거듭제곱' 진도를 나갔습니다.${close}`);
    expect(progressLead("이승엽", ["소인수분해", "최대공약수"])).toBe(
      `우리 승엽이는 오늘 '소인수분해'와 '최대공약수', 두 소단원 진도를 나갔습니다.${close}`,
    );
    expect(progressLead("이승엽", ["최대공약수", "최소공배수"])).toBe(
      `우리 승엽이는 오늘 '최대공약수'와 '최소공배수', 두 소단원 진도를 나갔습니다.${close}`,
    );
    expect(progressLead("이승엽", ["소수의 뜻", "거듭제곱", "소인수분해"])).toBe(
      `우리 승엽이는 오늘 '소수의 뜻'부터 '소인수분해'까지 모두 3개 소단원 진도를 나갔습니다.${close}`,
    );
  });
  it("초등 차시 번호는 뗀다", () => {
    expect(progressLead("김지수", ["1-1-1 1부터 5까지의 수 알아보기"])).toMatch(/^우리 지수는 오늘 '1부터 5까지의 수 알아보기' 진도를 나갔습니다\. /);
  });
  it("진도 중단일은 그날 한 일을 적는다 · 진도 없으면 빈 문장", () => {
    expect(progressLead("이승엽", [], "월말평가")).toBe("우리 승엽이는 오늘 월말평가 수업을 했습니다.");
    expect(progressLead("이승엽", [])).toBe("");
  });

  it("복습·문제풀이를 고르면 첫 문장이 그날 수업 성격대로(원장 2026-10-26)", () => {
    expect(progressLead("이승엽", ["소인수분해"], null, "복습")).toMatch(/^우리 승엽이는 오늘 '소인수분해' 내용을 복습했습니다\. /);
    expect(progressLead("이승엽", ["소인수분해", "최대공약수"], null, "복습")).toMatch(
      /^우리 승엽이는 오늘 '소인수분해'와 '최대공약수', 두 소단원을 복습했습니다\. /,
    );
    expect(progressLead("이승엽", ["소인수분해"], null, "문제풀이")).toMatch(
      /^우리 승엽이는 오늘 '소인수분해' 문제풀이 위주로 수업했습니다\. /,
    );
    expect(progressLead("이승엽", ["소수의 뜻", "거듭제곱", "소인수분해"], null, "문제풀이")).toMatch(
      /^우리 승엽이는 오늘 '소수의 뜻'부터 '소인수분해'까지 모두 3개 소단원의 문제풀이 위주로 수업했습니다\. /,
    );
    // 성격을 안 골랐거나 모르는 값이면 종전 그대로 · 진도 중단일(월말평가)이 성격보다 먼저.
    expect(progressLead("이승엽", ["소인수분해"], null, "")).toBe(progressLead("이승엽", ["소인수분해"]));
    expect(progressLead("이승엽", ["소인수분해"], null, "아무거나")).toBe(progressLead("이승엽", ["소인수분해"]));
    expect(progressLead("이승엽", [], "월말평가", "복습")).toBe("우리 승엽이는 오늘 월말평가 수업을 했습니다.");
    for (const m of ["복습", "문제풀이"]) expect(progressLead("이승엽", ["소인수분해"], null, m)).not.toContain("진도를 나갔습니다");
  });
});

describe("소단원별 이해도", () => {
  const today = "소수와 거듭제곱\n소인수분해\n최대공약수";
  it("뺀 소단원은 자동작성에 안 들어가고, 안 매긴 소단원은 기본값 10으로 들어간다(원장 2026-10-26)", () => {
    const st = { scores: { 소수와거듭제곱: 3, "소수와 거듭제곱": 8, 소인수분해: 6, 최대공약수: 9 }, off: ["최대공약수"] };
    expect(activeUnderstanding(today, st)).toEqual([
      { title: "소수와 거듭제곱", score: 8, rated: true },
      { title: "소인수분해", score: 6, rated: true },
    ]);
    // 종전엔 점수 없는 소단원이 빠졌다 — 이제 기본값 10(UNDERSTANDING_DEFAULT)으로 읽는다(저장값엔 없다 = stored false).
    expect(activeUnderstanding(today, { scores: { 소인수분해: 7 }, off: [] })).toEqual([
      { title: "소수와 거듭제곱", score: UNDERSTANDING_DEFAULT, rated: false },
      { title: "소인수분해", score: 7, rated: true },
      { title: "최대공약수", score: UNDERSTANDING_DEFAULT, rated: false },
    ]);
    // 글로 쓰는 이해도는 매긴 소단원만(원장 2026-10-28) — 표식이 없는 옛 값은 매긴 것으로 본다.
    expect(ratedUnderstanding(activeUnderstanding(today, { scores: { 소인수분해: 7 }, off: [] }))).toEqual([{ title: "소인수분해", score: 7, rated: true }]);
    expect(ratedUnderstanding<{ title: string; score: number; rated?: boolean }>([{ title: "옛 값", score: 9 }])).toEqual([{ title: "옛 값", score: 9 }]);
    expect(understandingRows(today, { scores: { 소인수분해: 7 }, off: [] }).map((r) => r.stored)).toEqual([false, true, false]);
  });
  it("단계 버튼 — 소단원 전부에 같은 점수, 뺀 소단원 목록은 그대로", () => {
    expect(UNDERSTANDING_PRESETS.map((p) => [p.key, p.score])).toEqual([["good", 10], ["ok", 7], ["poor", 4]]);
    const next = setAllUnderstanding(today, { scores: { 소인수분해: 2 }, off: ["최대공약수"] }, 7);
    expect(next.off).toEqual(["최대공약수"]);
    expect(activeUnderstanding(today, next)).toEqual([
      { title: "소수와 거듭제곱", score: 7, rated: true },
      { title: "소인수분해", score: 7, rated: true },
    ]);
    expect(hasStoredUnderstanding(today, { scores: {}, off: [] })).toBe(false);
    expect(hasStoredUnderstanding(today, next)).toBe(true);
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
    expect(buildFactBlock(input)).toContain("소단원별 이해도: 소인수분해 — 대체로 따라왔으나 아직 조금 어려워함");
    expect(buildFactBlock(input)).not.toMatch(/\d+점|만점/);
  });
});

describe("이해도 AI — 이름·숫자·혼잣말(원장 2026-10-23 제보)", () => {
  it("지시에 예시 이름이 없고, 이 학생의 부르는 이름이 붙는다", () => {
    expect(PILOT_AI_DIRECTIVE).not.toMatch(/승엽|지수/);
    expect(callName("학원삼")).toBe("원삼이");
    expect(callName("김지수")).toBe("지수");
    expect(pilotAiDirective("학원삼")).toMatch(/\[부르는 이름\] 우리 원삼이$/);
    expect(pilotAiDirective("")).toMatch(/이름을 부르지 말고/);
  });
  it("점수 숫자·규칙 혼잣말이 든 문장은 통째로 뺀다", () => {
    const items = [{ title: "연립방정식의 풀이의 응용", score: 10 }];
    const leaked =
      "연립방정식의 풀이의 응용은 10점 만점에 10점을 받아, 우리 원삼이가 가장 자신 있게 이해한 부분으로 보입니다 — 이 문장은 금지 표현이니 제외하고 다시 쓰겠습니다. 우리 원삼이가 문제를 차근차근 잘 풀었습니다.";
    expect(cleanPilotUnderstanding(leaked, items)).toBe("우리 원삼이가 문제를 차근차근 잘 풀었습니다.");
    // 2026-11-12 실례 — 지시를 되받는 혼잣말과 글자 그대로의 줄바꿈 기호.
    const real = "공배수와 최소공배수는 대체로 따라왔지만 아직 조금 어려워했습니다. 우리 재윤이가 공약수와 최대공약수, 공배수와 최소공배수를 차례로 익혔고, 공배수와 최소공배수 부분에서 조금 더 시간이 필요해 보였다는 말은 쓰지 않겠습니다.\\n";
    expect(cleanPilotUnderstanding(real, items)).toBe("공배수와 최소공배수는 대체로 따라왔지만 아직 조금 어려워했습니다.");
    // 글자 그대로의 줄바꿈 기호만 남은 문장은 띄어쓰기로 접는다(문장은 살린다).
    expect(cleanPilotUnderstanding("잘 따라왔습니다.\\n우리 재윤이가 열심히 풀었습니다.", items)).toBe("잘 따라왔습니다. 우리 재윤이가 열심히 풀었습니다.");
    // 관찰 사실('필기 내용을 적지 않고')은 혼잣말이 아니다.
    expect(cleanPilotUnderstanding("필기 내용을 적지 않고 답만 써서 실수가 있었습니다.", items)).toBe("필기 내용을 적지 않고 답만 써서 실수가 있었습니다.");
    // 수업 사실의 부정('하지 않았습니다')은 혼잣말이 아니다.
    expect(cleanPilotUnderstanding("오늘은 일일 테스트를 보지 않았습니다.", items)).toBe("오늘은 일일 테스트를 보지 않았습니다.");
  });
  it("다 빠지면 정해진 문장으로 · 숫자 없음", () => {
    const out = cleanPilotUnderstanding("10점 만점에 10점입니다.", [
      { title: "소인수분해", score: 9 },
      { title: "최대공약수", score: 6 },
    ]);
    expect(out).toContain("'소인수분해'는 잘 이해하고 있습니다.");
    expect(out).toContain("'최대공약수'는 대체로 잘 따라왔지만");
    expect(out).not.toMatch(/\d/);
  });
  it("멀쩡한 글은 그대로", () => {
    expect(cleanPilotUnderstanding("우리 원삼이는 소인수분해를 잘 이해했습니다.", [])).toBe("우리 원삼이는 소인수분해를 잘 이해했습니다.");
  });
});

describe("글 조립", () => {
  it("진도 → 본문 → 사랑의 한마디(맨 아래, 항목 제목과 함께)", () => {
    expect(composePilotMent({ lead: "L", body: "B", note: " 격려 " })).toBe("L\n\nB\n\n■ 사랑의 한마디\n격려");
    expect(composePilotMent({ lead: "L", body: "B", note: "" })).toBe("L\n\nB");
  });
  it("AI 지시가 점수를 말로 풀게 한다(강점·응원·격려, 숫자 금지)", () => {
    expect(PILOT_AI_DIRECTIVE).toMatch(/강점/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/격려/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/점수 숫자.*쓰지 마세요/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/이름 앞에 .우리./);
    // 낮은 이해도 = 순화한 상태 설명 → 그 이유로 학원이 챙긴다(원장 2026-10-21 — "뜬금없이 챙기겠다"만 나왔다).
    expect(PILOT_AI_DIRECTIVE).toMatch(/두 단계/);
    // 무엇이 어려웠는지는 입력에 없다 — 소단원 안의 부분을 추측하지 않는다(원장 2026-10-22).
    expect(PILOT_AI_DIRECTIVE).toMatch(/절대 추측해서 쓰지 마세요/);
    expect(PILOT_AI_DIRECTIVE).not.toMatch(/응용 문제를 조금|식을 세우는 부분을/);
    expect(PILOT_AI_DIRECTIVE).not.toMatch(/\*\*|🔴/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/그래서 다음 시간에 한 번 더 짚어/);
    expect(PILOT_AI_DIRECTIVE).toMatch(/직접적인 표현은 쓰지 마세요/);
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
  const now = { studentName: "이승엽", today: "소인수분해", progressMode: null, note: "잘했어요", factsSig: "A", writtenSig: "A" };
  const draft = composePilotMent({ lead: pilotSection("진도", progressLead("이승엽", ["소인수분해"])), body: "본문", note: "잘했어요" });
  it("그대로면 통과", () => expect(isPilotDraftCurrent(draft, now)).toBe(true));
  it("🔑 복습으로 쓴 글은 복습일 때만 최신 — 알약을 바꾸면 다시 자동작성", () => {
    const review = composePilotMent({ lead: pilotSection("진도", progressLead("이승엽", ["소인수분해"], null, "복습")), body: "본문", note: "잘했어요" });
    expect(isPilotDraftCurrent(review, { ...now, progressMode: "복습" })).toBe(true);
    expect(isPilotDraftCurrent(review, now)).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, progressMode: "문제풀이" })).toBe(false);
  });
  it("수업 평가 표가 맨 위에 있어도 진도 항목을 찾는다", () => {
    expect(isPilotDraftCurrent(`■ 수업 평가\n구분\n\n${draft}`, now)).toBe(true);
    expect(isPilotDraftCurrent(`■ 수업 평가\n구분\n\n${draft}`, { ...now, today: "최대공약수" })).toBe(false);
  });
  it("진도·사실 서명·한마디가 바뀌면 막는다", () => {
    expect(isPilotDraftCurrent(draft, { ...now, today: "최대공약수" })).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, factsSig: "B" })).toBe(false);
    expect(isPilotDraftCurrent(draft, { ...now, note: "더 잘했어요!" })).toBe(false);
  });
  it("서명이 없으면(새로고침 뒤) 서명 대조는 건너뛴다", () => {
    expect(isPilotDraftCurrent(draft, { ...now, writtenSig: undefined, factsSig: "B" })).toBe(true);
  });
  it("🔑 선생님 말투로 다시 쓴 진도(원장 2026-10-30)도 같은 사실이면 최신 — 새로고침 뒤(서명 없음)에도", () => {
    const styled = composePilotMent({ lead: pilotSection("진도", "승엽이는 '소인수분해' 문제를 풀었습니다."), body: "본문", note: "잘했어요" });
    expect(isPilotDraftCurrent(styled, now)).toBe(true);
    expect(isPilotDraftCurrent(styled, { ...now, writtenSig: undefined })).toBe(true);
    expect(isPilotDraftCurrent(styled, { ...now, today: "최대공약수" })).toBe(false);
    expect(isPilotDraftCurrent(styled, { ...now, progressMode: "복습" })).toBe(false);
    const styledReview = composePilotMent({ lead: pilotSection("진도", "승엽이는 '소인수분해'를 복습했습니다."), body: "본문", note: "잘했어요" });
    expect(isPilotDraftCurrent(styledReview, { ...now, progressMode: "복습" })).toBe(true);
    expect(isPilotDraftCurrent(styledReview, now)).toBe(false);
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("서버 발송 경로가 저장된 작성 방식으로 다시 막는다", () => {
    const src = read("./server/actions.ts");
    expect(src).toMatch(/saved\.mentSource !== "auto" && saved\.mentSource !== "auto_edited"[^\n]*\n\s*\?\s*PILOT_AUTOWRITE_REQUIRED_ERROR/);
    expect(src).toMatch(/!pilotOneLineAttached\(input\.notes, input\.pilotOneLine\)/);
    expect(src).toMatch(/mentSource: mentSourceFinal,/);
  });
  it("자동작성 글에 이해도 점수 블록을 붙이지 않는다(말로 풀어 쓴다)", () => {
    expect(read("./server/actions.ts")).not.toMatch(/understandingBlock/);
  });
  it("카드·표 멘트 칸이 자동작성 전에만 잠기고 이해도 서명으로 대조한다", () => {
    const card = read("./components/report-card.tsx");
    const grid = read("./components/grid-row.tsx");
    expect(card).toMatch(/const pilotLocked = pilot && !pilotCanEdit\(rep\.autoDraft\)/);
    expect(card).toMatch(/readOnly=\{pilotLocked\}/);
    expect(grid).toMatch(/const pilotLocked = pilot && !pilotCanEdit\(rep\?\.autoDraft\)/);
    expect(grid).toMatch(/readOnly=\{rowLocked \|\| pilotLocked\}/);
    expect(card).not.toMatch(/readOnly=\{pilot\}/);
    // 사실 서명은 카드·표·자동작성이 같은 함수(pilotRowSig)로 만든다 — 갈리면 값이 그대로인데도 게이트가 안 풀린다.
    // 카드·표의 게이트 재료는 한 벌(row-send-gate.ts, P1-O)이라 그 파일을 본다(두 화면이 그것을 부르는지는 row-send-gate-wiring).
    const gate = read("./row-send-gate.ts");
    expect(gate).toMatch(/factsSig: pilotRowSig\(student, subject\.name\)/);
    expect(gate).toMatch(/writtenSig: rep\?\.pilotFactsSig/);
    expect(gate).toMatch(/needsTestReason: pilot && !testSkipComplete\(subject\.dailyTestSkip\)/);
    for (const src of [card, grid]) expect(src).toContain("rowSendGate({");
    expect(readOnescreenScreen()).toMatch(/pilotRowSig\(student, subjectName\)/);
  });
  it("한줄 멘트를 바꾸면 그 자리에서 글 끝을 바꾸고, 발송 경로가 한줄 멘트를 싣는다", () => {
    const client = readOnescreenScreen();
    expect(client).toMatch(/pilotRecomposeNote\(r\.draft, r\.autoDraft, pilotPrevNote, text\)/);
    expect(client).toMatch(/pilotOneLine: rowEval\.note/);
    // 영어 행도 '사랑의 한마디' 필수(원장 2026-10-26) — 판정은 oneLineRow = pilot || 영어.
    // JJ 수업보고서 글만 한마디가 선택(원장 2026-10-27) — 나머지 영어·수학 행은 그대로 필수.
    const gate = read("./row-send-gate.ts");
    expect(gate).toMatch(/needsOneLine: oneLineRow && !jjOptionalNote && !hasPilotOneLine\(fields\.note\)/);
    expect(gate).toMatch(/const oneLineRow = pilot \|\| subject\.subjectKey === "english"/);
    expect(read("./components/report-card.tsx")).toMatch(/const oneLineRow = pilot \|\| subject\.subjectKey === "english"/);
  });
});

describe("자동작성 뒤 수정 허용(원장 2026-10-23)", () => {
  const now = { studentName: "이승엽", today: "소인수분해", progressMode: null, note: "잘했어요", factsSig: "A", writtenSig: "A" };
  const auto = composePilotMent({ lead: pilotSection("진도", progressLead("이승엽", ["소인수분해"])), body: "본문", note: "잘했어요" });
  const edited = auto.replace("본문", "고친 본문");
  it("자동작성 전엔 잠금 · 뒤엔 열림", () => {
    expect(pilotCanEdit(undefined)).toBe(false);
    expect(pilotCanEdit("  ")).toBe(false);
    expect(pilotCanEdit(auto)).toBe(true);
  });
  it("고친 글도 보낼 수 있다", () => {
    expect(pilotNeedsAutoWrite(edited, auto, now)).toBe(false);
    expect(pilotNeedsAutoWrite(auto, auto, now)).toBe(false);
  });
  it("자동작성을 안 했거나 글이 비면 막는다", () => {
    expect(pilotNeedsAutoWrite(edited, undefined, now)).toBe(true);
    expect(pilotNeedsAutoWrite("", auto, now)).toBe(true);
  });
  it("고친 글이어도 칸 값이 바뀌었거나 한마디가 끝에 없으면 막는다", () => {
    expect(pilotNeedsAutoWrite(edited, auto, { ...now, factsSig: "B" })).toBe(true);
    expect(pilotNeedsAutoWrite(edited, auto, { ...now, note: "다른 말" })).toBe(true);
  });
  it("고친 글에서도 한마디를 바꾸면 끝만 바뀐다", () => {
    expect(pilotRecomposeNote(edited, auto, "잘했어요", "최고예요")).toBe(edited.replace(/잘했어요$/, "최고예요"));
  });
});

describe("사랑의 한마디(옛 강사 한줄 멘트 — 필수, 실시간 반영)", () => {
  const auto = "우리 원이는 오늘 A 진도를 나갔습니다.\n\n본문입니다.";
  it("자동작성 뒤 처음 적으면 맨 끝에 붙는다", () => {
    expect(pilotRecomposeNote(auto, auto, "", "멋졌어요")).toBe(auto + "\n\n■ 사랑의 한마디\n멋졌어요");
  });
  it("옛 제목('선생님 한마디')으로 끝난 글도 끝만 바꾼다 — 바꾼 끝은 새 제목", () => {
    const old = auto + "\n\n■ 선생님 한마디\n멋졌어요";
    expect(pilotRecomposeNote(old, old, "멋졌어요", "최고")).toBe(auto + "\n\n■ 사랑의 한마디\n최고");
  });
  it("고치면 끝의 옛 멘트만 바뀌고, 지우면 떨어진다", () => {
    const withA = auto + "\n\n■ 사랑의 한마디\n멋졌어요";
    expect(pilotRecomposeNote(withA, withA, "멋졌어요", "멋졌어요!")).toBe(auto + "\n\n■ 사랑의 한마디\n멋졌어요!");
    expect(pilotRecomposeNote(withA, withA, "멋졌어요", "")).toBe(auto);
    expect(pilotRecomposeNote(withA, withA, " 멋졌어요 ", "좋아요 ")).toBe(auto + "\n\n■ 사랑의 한마디\n좋아요");
  });
  it("자동작성 글이 아니거나 끝이 옛 멘트가 아니면 손대지 않는다", () => {
    expect(pilotRecomposeNote(auto, "", "", "x")).toBeNull();
    expect(pilotRecomposeNote(auto, auto, "다른 멘트", "x")).toBeNull();
    // 본문 끝 글자와 우연히 같은 짧은 멘트를 본문으로 오인하지 않는다(문단 경계까지 맞아야 한다)
    expect(pilotRecomposeNote(auto, auto, "다.", "x")).toBeNull();
  });
  it("필수 판정 · 서버는 글 끝에 붙었는지까지 본다", () => {
    expect(hasPilotOneLine("  ")).toBe(false);
    expect(hasPilotOneLine("좋아요")).toBe(true);
    expect(pilotOneLineAttached(auto + "\n\n좋아요", "좋아요")).toBe(true);
    expect(pilotOneLineAttached(auto, "좋아요")).toBe(false);
    expect(pilotOneLineAttached(auto, undefined)).toBe(false);
  });
  it("사랑의 한마디가 없으면 '사랑의 한마디 입력 필요'로 막는다", () => {
    const g = evaluateSendGate({
      needsOneLine: true,
      alreadySent: false,
      isAbsent: false,
      hasProgress: true,
      hasDraft: true,
      attendanceUnchecked: false,
    } as Parameters<typeof evaluateSendGate>[0]);
    expect(g.canSend).toBe(false);
    expect(g.reasons).toEqual(["oneline"]);
    expect(g.label).toBe("사랑의 한마디 입력 필요");
  });
});

describe("이해도 단계 버튼 — 카드·표 같은 판정(2026-10-26)", () => {
  const row = (score: number, stored = true, off = false) => ({ off, score, stored });
  it("직접 매긴 점수가 모두 한 단계면 그 버튼", () => {
    expect(understandingPresetOf([row(7), row(7)])).toBe("ok");
    expect(understandingPresetOf([row(10), row(10, true, false), row(4, true, true)])).toBe("good");
  });
  it("기본값뿐이거나 점수가 갈리면 아무것도 아니다", () => {
    expect(understandingPresetOf([row(10, false)])).toBeNull();
    expect(understandingPresetOf([row(7), row(4)])).toBeNull();
    expect(understandingPresetOf([])).toBeNull();
  });
  it("표에도 같은 버튼을 단다", () => {
    const grid = readFileSync(`${process.cwd()}/src/features/onescreen/components/grid-row.tsx`, "utf8");
    expect(grid).toMatch(/<UnderstandingPresetButtons/);
    expect(grid).toMatch(/fields\.onUnderstandingAll/);
  });
});

describe("선생님 습관·수업 메모 지시(원장 2026-10-28)", () => {
  const H = { omitPromises: true, omitFiller: true, compactUnits: true, omitScore: false };
  it("습관이 없으면 종전 지시 그대로", () => {
    expect(pilotAiDirective("학원삼")).toBe(pilotAiDirective("학원삼", { habits: { omitPromises: false, omitFiller: false, compactUnits: false, omitScore: false } }));
    expect(pilotAiDirective("학원삼")).toContain(PILOT_AI_DIRECTIVE);
  });
  it("다짐을 늘 지우는 선생님 — '그래서 … 챙기겠습니다' 예시·두 단계 지시가 빠지고 다짐 금지가 들어간다", () => {
    const d = pilotAiDirective("학원삼", { habits: H });
    expect(d).not.toMatch(/두 단계/);
    expect(d).not.toMatch(/그래서 다음 시간에 한 번 더 짚어/);
    expect(d).toMatch(/다짐·계획 문장은 쓰지 마세요/);
    expect(d).toMatch(/두루뭉술한 수업 묘사는 쓰지 마세요/);
    expect(d).toMatch(/한 문장\(길어도 두 문장\)으로 묶어/);
    expect(d).toMatch(/절대 추측해서 쓰지 마세요/); // 사실 규칙은 그대로
  });
  it("메모가 있으면 메모 규칙과 메모 줄이 붙는다", () => {
    const d = pilotAiDirective("학원삼", { memo: "월말평가 오답 첨삭, 오답노트 작성" });
    expect(d).toMatch(/\[선생님 수업 메모\] 월말평가 오답 첨삭, 오답노트 작성/);
    expect(d).toMatch(/메모에 없는 일을 덧붙이지 마세요/);
  });
  it("습관이 있으면 대체 글에도 다짐 문장이 없다 · 메모의 점수는 새는 숫자가 아니다", () => {
    expect(fallbackUnderstanding([{ title: "소인수분해", score: 6 }], H)).not.toMatch(/챙기겠/);
    expect(cleanPilotUnderstanding("월말고사는 92점이었습니다. 10점 만점입니다.", [], { memo: "월말고사 92점" })).toBe("월말고사는 92점이었습니다.");
    expect(cleanPilotUnderstanding("만점이었습니다.", [], { memo: "오답노트 작성" })).toBe("오답노트 작성");
  });
});
