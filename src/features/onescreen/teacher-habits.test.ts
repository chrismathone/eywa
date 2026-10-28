import { describe, expect, it } from "vitest";
import { applyHabitsToSections, habitStats, learnTeacherHabits, NO_HABITS, stripHabitSentences } from "./teacher-habits";

const pair = (ai: string, final: string) => ({ ai, final });

describe("teacher-habits — 늘 지우는 문장을 기록으로 판정(원장 2026-10-28)", () => {
  it("다짐 문장을 4번 이상 · 35% 이상 지웠으면 생략", () => {
    const ai = "비례식을 배웠습니다. 그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.";
    const pairs = [
      ...Array.from({ length: 4 }, () => pair(ai, "비례식을 배웠습니다. 오답노트 작성했습니다.")),
      ...Array.from({ length: 5 }, () => pair(ai, ai)),
    ];
    expect(habitStats(pairs).promise).toEqual({ seen: 9, removed: 4 });
    expect(learnTeacherHabits(pairs).omitPromises).toBe(true);
  });
  it("지운 횟수가 3번뿐이면 그대로(기록이 모자라다)", () => {
    const ai = "그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.";
    const pairs = Array.from({ length: 3 }, () => pair(ai, "다른 글"));
    expect(learnTeacherHabits(pairs)).toEqual(NO_HABITS);
  });
  it("소단원 나열을 자주 지우면 묶어 쓰기, 틀 문장을 자주 지우면 생략", () => {
    const ai = "'비례배분'은 대체로 잘 따라왔지만 아직 조금 어려워했습니다. 배운 개념을 문제에 적용해 보며 실력을 다졌습니다.";
    const pairs = Array.from({ length: 4 }, () => pair(ai, "비례배분 문제풀이 진행했습니다."));
    expect(learnTeacherHabits(pairs)).toEqual({ omitPromises: false, omitFiller: true, compactUnits: true });
  });
  it("항목 제목 줄은 문장으로 세지 않는다 · 보낸 글이 비면 건너뛴다", () => {
    expect(habitStats([pair("■ 오늘의 수업\n그래서 다음 시간에 챙기겠습니다.", "")]).promise.seen).toBe(0);
  });
});

describe("stripHabitSentences — 다짐·틀 문장만 뗀다", () => {
  const H = { omitPromises: true, omitFiller: true, compactUnits: false };
  it("숫자 든 문장·선생님이 적은 말은 남긴다", () => {
    expect(stripHabitSentences("25문제 중 22개 맞음 대부분 잘 맞혔습니다. 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.", H)).toBe(
      "25문제 중 22개 맞음 대부분 잘 맞혔습니다.",
    );
    expect(stripHabitSentences("다음 주 수요일 보충하겠습니다.", H, ["다음 주 수요일 보충하겠습니다."])).toBe("다음 주 수요일 보충하겠습니다.");
  });
  it("다 지워지면 원래 글 그대로", () => {
    const t = "그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.";
    expect(stripHabitSentences(t, H)).toBe(t);
  });
  it("습관이 없으면 손대지 않는다", () => {
    const t = "그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다. 다른 말.";
    expect(stripHabitSentences(t, NO_HABITS)).toBe(t);
  });
});

describe("applyHabitsToSections — 항목별", () => {
  const H = { omitPromises: true, omitFiller: true, compactUnits: false };
  it("진도 첫 문장은 남고 마무리 갈래만 빠진다 · 사랑의 한마디·수업 평가는 그대로", () => {
    const text = [
      "■ 수업 평가\n표 줄 챙기겠습니다.",
      "■ 진도\n우리 지호는 오늘 '정수와 유리수' 진도를 나갔습니다. 오늘 배운 내용이 잘 자리 잡을 수 있도록 다음 시간에도 이어서 꼼꼼히 다지겠습니다.",
      "■ 숙제 완성도\n지난 숙제를 절반 해 왔습니다. 남은 부분은 다음 시간에 같이 점검하며 끝까지 마치도록 하겠습니다.",
      "■ 사랑의 한마디\n다음에도 꼭 챙기겠습니다.",
    ].join("\n\n");
    const out = applyHabitsToSections(text, H, { skipTitles: ["수업 평가", "사랑의 한마디"] });
    expect(out).toBe(
      [
        "■ 수업 평가\n표 줄 챙기겠습니다.",
        "■ 진도\n우리 지호는 오늘 '정수와 유리수' 진도를 나갔습니다.",
        "■ 숙제 완성도\n지난 숙제를 절반 해 왔습니다.",
        "■ 사랑의 한마디\n다음에도 꼭 챙기겠습니다.",
      ].join("\n\n"),
    );
  });
});
