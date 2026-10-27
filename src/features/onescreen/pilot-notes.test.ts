import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { levelTableText, pilotBody, pilotLevelsSection } from "./math-report-pilot-sections";
import { composePilotMent, pilotSection } from "./math-report-pilot";
import { isPilotReportSections, isScoreLine, parseLevelRows, parsePilotNotes, parseScoreLine, splitPilotNote } from "./pilot-notes";
import { PilotNotesBody } from "./components/pilot-notes-body";

const facts = {
  dailyTest: "5문제 중 5개 맞음",
  checkTest: "",
  attitude: "매우 좋음",
  homework: "80%",
  homeworkToday: "~131p",
  understanding: [{ title: "연립방정식", score: 7 }],
};
const notes = composePilotMent({
  lead: [pilotLevelsSection(facts), pilotSection("진도", "우리 원상이는 오늘 '연립방정식' 진도를 나갔습니다.")].join("\n\n"),
  body: pilotBody(facts, { understandingText: "연립방정식을 잘 따라왔습니다." }),
  note: "오늘도 수고했어요",
});

describe("항목별 글 → 카드 조각(원장 2026-10-23 시안 B)", () => {
  it("자동작성 글을 항목으로 나눈다 — 수업 평가가 맨 앞", () => {
    const s = parsePilotNotes(notes)!;
    expect(s.map((x) => x.title)).toEqual(["수업 평가", "진도", "일일 테스트", "숙제 완성도", "오늘의 수업", "오늘의 숙제", "사랑의 한마디"]);
  });
  it("손으로 쓴 글·빈 글은 null(카드가 글 그대로 그린다)", () => {
    expect(parsePilotNotes("오늘 잘했어요")).toBeNull();
    expect(parsePilotNotes("")).toBeNull();
    expect(parsePilotNotes(null)).toBeNull();
  });
  it("표 글 → 줄(지금 형식 · 옛 눈금 형식 둘 다)", () => {
    const rows = [
      { label: "수업 태도", level: "상" },
      { label: "숙제 완성도", level: "중상" },
      { label: "이해도", level: "중" },
    ];
    expect(parseLevelRows(levelTableText(facts))).toEqual(rows);
    expect(parseLevelRows("(왼쪽부터 하 · 중하 · 중 · 중상 · 상)\n수업 태도  ○○○○●  상\n숙제 완성도  ○○○●○  중상\n이해도  ○○●○○  중")).toEqual(rows);
  });
  it("등급이 눈금 밖이거나 줄이 없으면 null(표를 지어내지 않는다)", () => {
    expect(parseLevelRows("수업 태도 ○○●○○ 최고")).toBeNull();
    expect(parseLevelRows("그냥 글")).toBeNull();
  });
  it("점수 줄 판정", () => {
    expect(isScoreLine("5문제 중 5개 맞음")).toBe(true);
    expect(isScoreLine("오늘은 몸이 좋지 않아 일일 테스트를 보지 않았습니다.")).toBe(false);
    expect(parseScoreLine("10문제 중 7개 맞음")).toEqual({ right: 7, total: 10 });
    expect(parseScoreLine("5문제 중 7개 맞음")).toBeNull();
    expect(parseScoreLine("0문제 중 0개 맞음")).toBeNull();
  });
});

describe("카드 렌더", () => {
  const html = renderToStaticMarkup(createElement(PilotNotesBody, { sections: parsePilotNotes(notes)! }));
  it("진짜 표 — 머리 칸 6개 · 고른 칸에 등급 글자 · 그 앞 칸은 채움", () => {
    expect(html).toContain("<table");
    expect((html.match(/<th[^>]*>(구분|하|중하|중|중상|상)<\/th>/g) ?? []).length).toBe(6);
    expect(html).toMatch(/bg-primary text-primary-foreground[^>]*>상</);
    expect((html.match(/bg-primary-soft block/g) ?? []).length).toBe(4 + 3 + 2);
    expect(html).not.toContain("○");
  });
  it("점수 블록 — 큰 숫자 · 정식 표기 · 문제마다 점", () => {
    expect(html).toMatch(/text-4xl[^>]*>5<\/span>/);
    expect(html).toContain(">/ 5</span>");
    expect(html).toContain(">5문제 중 5개 맞음</p>");
    expect((html.match(/size-3\.5 rounded-full bg-primary"/g) ?? []).length).toBe(5);
  });
  it("오늘의 숙제는 상자로 · 한마디도 상자로", () => {
    expect(html).toMatch(/bg-primary-softer[^>]*>~131p</);
    expect(html).toMatch(/bg-primary-softer[^>]*>오늘도 수고했어요</);
  });
  it("옛 제목('오늘 과제'·앞뒤 문장)으로 저장된 글도 같은 상자로 — 앞뒤 문장은 상자 밖 그대로", () => {
    const old = renderToStaticMarkup(
      createElement(PilotNotesBody, {
        sections: [{ title: "오늘 과제", body: "오늘 내준 과제는 아래와 같습니다.\n5p 풀기\n다음 시간에 잘 해 왔는지 함께 확인하겠습니다." }],
      }),
    );
    expect(old).toMatch(/bg-primary-softer[^>]*>5p 풀기</);
    expect(old).toContain("오늘 내준 과제는 아래와 같습니다.");
  });
});

describe("사랑의 한마디 떼기(카드 맨 아래, 원장 2026-10-23)", () => {
  it("마지막 항목이 한마디면 떼고, 옛 제목도 알아본다", () => {
    const { main, note } = splitPilotNote(parsePilotNotes(notes)!);
    expect(note).toEqual({ title: "사랑의 한마디", body: "오늘도 수고했어요" });
    expect(main.map((x) => x.title)).not.toContain("사랑의 한마디");
    expect(splitPilotNote([{ title: "진도", body: "a" }, { title: "선생님 한마디", body: "b" }]).note?.body).toBe("b");
    expect(splitPilotNote([{ title: "진도", body: "a" }]).note).toBeNull();
  });
});

describe("시범 글 판정", () => {
  it("아는 항목 제목이 있어야 시범 글 — 손으로 '■'로 시작한 글은 아니다", () => {
    expect(isPilotReportSections(parsePilotNotes(notes)!)).toBe(true);
    expect(isPilotReportSections(parsePilotNotes("■ 메모\n오늘 잘했어요")!)).toBe(false);
  });
});
