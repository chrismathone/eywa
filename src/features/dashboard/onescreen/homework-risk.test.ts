import { describe, expect, it } from "vitest";
import { LOW_HOMEWORK_RATE, buildHomeworkRisk, type HomeworkRow } from "./homework-risk";

const row = (studentId: string, homeworkScore: string | null): HomeworkRow => ({ studentId, homeworkScore });

describe("숙제 위험", () => {
  it("낮은 기록이 있는 **학생 수**를 센다(같은 학생이 여러 번이어도 하나)", () => {
    const r = buildHomeworkRisk([row("a", "0%"), row("a", "20%"), row("b", "100%")]);
    expect(r.students).toBe(1);
    expect(r.parsed).toBe(3);
  });

  it("`미제출`(안 내옴)과 `0%`(했는데 못 함)를 뭉치지 않는다", () => {
    const r = buildHomeworkRisk([row("a", "미제출"), row("b", "0%")]);
    expect(r.students).toBe(2);
    expect(r.notSubmitted).toBe(1);
    expect(r.zero).toBe(1);
  });

  it("판정할 수 없는 값은 0이 아니라 **분모 밖**이다", () => {
    // 🔴 `일부 미흡`을 50으로 읽던 매핑이 학부모 카드에 강사가 하지 않은 판단을 찍어 보냈다.
    const r = buildHomeworkRisk([row("a", "일부 미흡"), row("b", "없음"), row("c", ""), row("d", null)]);
    expect(r.students).toBe(0);
    expect(r.parsed).toBe(0);
    expect(r.unparsed).toBe(4);
  });

  it("경계 — 기준값 자체는 낮음이 아니다", () => {
    expect(buildHomeworkRisk([row("a", `${LOW_HOMEWORK_RATE}%`)]).students).toBe(0);
    expect(buildHomeworkRisk([row("a", `${LOW_HOMEWORK_RATE - 1}%`)]).students).toBe(1);
    expect(buildHomeworkRisk([row("a", "완료")]).students).toBe(0);
  });

  it("기록이 하나도 없으면 0이고, 그 0은 '못 받았다'와 다른 말이다(호출부가 null로 가른다)", () => {
    expect(buildHomeworkRisk([])).toEqual({
      students: 0,
      notSubmitted: 0,
      zero: 0,
      unparsed: 0,
      parsed: 0,
    });
  });
});
