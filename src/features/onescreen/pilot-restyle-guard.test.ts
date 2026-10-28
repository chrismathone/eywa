import { describe, expect, it } from "vitest";
import { acceptRestyle, applyRestyle, restyleTargets, splitLockedLines, transplantRestyle } from "./pilot-restyle-guard";

describe("acceptRestyle — 말투만 바꾸고 사실은 그대로(원장 2026-10-28)", () => {
  it("숫자·날짜·쪽수가 그대로면 받는다", () => {
    expect(acceptRestyle("오늘 과제는 p93-99이며 10/30 (금)까지 제출입니다.", "오늘 숙제는 p93-99이고, 10/30 (금)까지 내면 됩니다.")).toBe(true);
  });
  it("숫자가 빠지거나 새로 생기면 버린다", () => {
    expect(acceptRestyle("25문제 중 22개를 맞혔습니다.", "대부분 맞혔습니다.")).toBe(false);
    expect(acceptRestyle("지난 과제를 모두 해 왔습니다.", "지난 과제를 100% 해 왔습니다.")).toBe(false);
  });
  it("날짜·쪽수가 다른 모양으로 바뀌면 버린다", () => {
    expect(acceptRestyle("10월 2일 결석분입니다.", "10/2 결석분입니다.")).toBe(false);
    expect(acceptRestyle("p93-99를 풀어 오세요.", "93쪽부터 99쪽까지 풀어 오세요.")).toBe(false);
  });
  it("부정이 생기거나 사라지면 버린다", () => {
    expect(acceptRestyle("지난 과제는 제출하지 않았습니다.", "지난 과제를 제출했습니다.")).toBe(false);
    expect(acceptRestyle("지난 과제를 모두 해 왔습니다.", "지난 과제를 빠짐없이 해 왔습니다.")).toBe(true);
    expect(acceptRestyle("지난 과제를 모두 해 왔습니다.", "지난 과제를 빼놓지 않고 해 왔습니다.")).toBe(false);
  });
  it("따옴표 단원 이름·선생님이 적은 말은 글자 그대로", () => {
    expect(acceptRestyle("'비례식' 문제를 풀었습니다.", "비례식 문제를 풀었습니다.")).toBe(false);
    const keep = ["교재를 가져오지 않음"];
    expect(acceptRestyle("지난 과제는 미제출입니다(사유: 교재를 가져오지 않음).", "지난 과제는 미제출(교재 안 가져옴)입니다.", keep)).toBe(false);
  });
  it("너무 짧거나 길면 · 항목 표시·가린 이름이 섞이면 버린다", () => {
    expect(acceptRestyle("수업 태도가 아주 좋았고 끝까지 집중했습니다.", "좋음.")).toBe(false);
    expect(acceptRestyle("태도가 좋았습니다.", "태도가 좋았습니다.\n■ 진도")).toBe(false);
    expect(acceptRestyle("태도가 좋았습니다.", "○○는 태도가 좋았습니다.")).toBe(false);
  });
});

describe("잠근 줄 — 카드가 글자로 다시 읽는 줄은 AI에 안 준다", () => {
  it("테스트 점수 첫 줄 · 영상 숙제 줄", () => {
    expect(splitLockedLines("일일 테스트", "25문제 중 22개 맞음\n거의 다 맞혔습니다.")).toEqual({ head: ["25문제 중 22개 맞음"], free: "거의 다 맞혔습니다.", tail: [] });
    expect(splitLockedLines("오늘의 숙제", "p93-99 풀어 오기.\n영상 숙제가 있습니다(10/30 (금)까지 제출).")).toEqual({
      head: [],
      free: "p93-99 풀어 오기.",
      tail: ["영상 숙제가 있습니다(10/30 (금)까지 제출)."],
    });
  });
  it("진도·출결·한마디는 다시 쓰지 않는다", () => {
    const t = restyleTargets([
      { title: "진도", body: "우리 지아는 오늘 비례식을 배웠습니다." },
      { title: "출결", body: "오늘 수업에 정상적으로 출석했습니다." },
      { title: "수업 태도", body: "수업 태도가 좋았습니다." },
      { title: "사랑의 한마디", body: "멋져요" },
    ]);
    expect(t).toEqual([{ title: "수업 태도", text: "수업 태도가 좋았습니다." }]);
  });
  it("applyRestyle — 통과한 항목만 · 잠근 줄 제자리", () => {
    const sections = [
      { title: "일일 테스트", body: "25문제 중 22개 맞음\n거의 다 맞혔습니다." },
      { title: "수업 태도", body: "수업 태도가 좋았습니다." },
      { title: "숙제 완성도", body: "지난 과제를 제출하지 않았습니다." },
    ];
    const sent = restyleTargets(sections);
    const out = applyRestyle(sections, sent, {
      "일일 테스트": "대부분 맞혔어요.",
      "수업 태도": "수업 내내 태도가 좋았습니다.",
      "숙제 완성도": "지난 과제를 해 왔습니다.",
    });
    expect(out.map((s) => s.body)).toEqual(["25문제 중 22개 맞음\n대부분 맞혔어요.", "수업 내내 태도가 좋았습니다.", "지난 과제를 제출하지 않았습니다."]);
  });
  it("보낸 뒤 항목 글이 달라졌으면 끼우지 않는다", () => {
    const sections = [{ title: "수업 태도", body: "수업 태도가 보통이었습니다." }];
    expect(applyRestyle(sections, [{ title: "수업 태도", text: "수업 태도가 좋았습니다." }], { "수업 태도": "태도가 좋았습니다." })).toEqual(sections);
  });
});

describe("transplantRestyle — 미리 다시 쓴 사실 항목을 최종 글에 옮긴다", () => {
  const fact = "■ 진도\n비례식\n\n■ 수업 태도\n수업 태도가 좋았습니다.\n\n■ 사랑의 한마디\n멋져요";
  const styled = "■ 진도\n비례식\n\n■ 수업 태도\n수업 내내 태도가 좋았습니다.\n\n■ 사랑의 한마디\n멋져요";
  it("같은 항목 글이면 바꾸고 '오늘의 수업'은 그대로", () => {
    const final = "■ 진도\n비례식\n\n■ 수업 태도\n수업 태도가 좋았습니다.\n\n■ 오늘의 수업\nAI 글\n\n■ 사랑의 한마디\n멋져요";
    expect(transplantRestyle(final, fact, styled)).toBe(final.replace("수업 태도가 좋았습니다.", "수업 내내 태도가 좋았습니다."));
  });
  it("최종 글의 항목이 다르면 두고 · 다시 안 쓰는 항목은 손대지 않는다", () => {
    const final = "■ 진도\n비례식\n\n■ 수업 태도\n수업 태도가 보통이었습니다.";
    expect(transplantRestyle(final, fact, styled)).toBe(final);
    expect(transplantRestyle("■ 진도\n비례식", "■ 진도\n비례식", "■ 진도\n비례식을 했어요")).toBe("■ 진도\n비례식");
  });
});
