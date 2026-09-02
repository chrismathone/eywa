import { describe, expect, it } from "vitest";
import { positionOf } from "@/features/progress/curriculum-position";
import { dayPositionOf, dayPositionsOf, goalEndOf, lessonPointsOf } from "./lesson-position";

// 실데이터에서 온 차시 이름(2026-08 lesson_reports). 커리큘럼에 있는지 먼저 확인해 테스트 재료로 쓴다.
const 중3_곱셈 = "다항식의 곱셈";
const 중3_인수분해 = "인수분해";
const 중1_방정식 = "일차방정식의 풀이";

describe("lessonPointsOf — 진도 문자열의 차시들", () => {
  it("재료 확인: 실데이터 차시 이름이 커리큘럼에 있다", () => {
    expect(positionOf(중3_곱셈)).not.toBeNull();
    expect(positionOf(중3_인수분해)).not.toBeNull();
    expect(positionOf(중1_방정식)).not.toBeNull();
  });

  it("'수학 ' 라벨이 붙은 한 줄", () => {
    const pts = lessonPointsOf(`수학 ${중3_곱셈}`, "중3");
    expect(pts).toHaveLength(1);
    expect(pts[0]!.track).toBe("current");
  });

  it("🔴 여러 줄이 역순이어도 가장 뒤 차시가 그날 위치다", () => {
    const a = positionOf(중3_곱셈)!.position;
    const b = positionOf(중3_인수분해)!.position;
    const hi = Math.max(a, b);
    const day = dayPositionsOf(`수학 ${중3_인수분해}\n${중3_곱셈}`, "중3");
    expect(day.current?.position).toBe(hi);
  });

  it("초6 학생이 중3 차시를 나가면 선행(ahead)", () => {
    const day = dayPositionsOf(`수학 ${중3_곱셈}`, "초6");
    expect(day.ahead?.position).toBe(positionOf(중3_곱셈)!.position);
    expect(day.current).toBeUndefined();
  });

  it("학년을 모르면 current로 둔다", () => {
    const day = dayPositionsOf(`수학 ${중3_곱셈}`, null);
    expect(day.current).toBeDefined();
  });

  it("🔴 커리큘럼 밖(시험 상태·프린트·고등)은 점을 안 찍는다", () => {
    expect(lessonPointsOf("수학 모의고사", "중2")).toEqual([]);
    expect(lessonPointsOf("프린트 3장", "중2")).toEqual([]);
    expect(lessonPointsOf(null, "중2")).toEqual([]);
  });

  it("goalEndOf — 여러 차시를 골랐으면 가장 뒤가 End", () => {
    const a = positionOf(중3_곱셈)!.position;
    const b = positionOf(중3_인수분해)!.position;
    expect(goalEndOf(`${중3_곱셈}\n${중3_인수분해}`, "중3")?.position).toBe(Math.max(a, b));
    expect(goalEndOf("프린트", "중3")).toBeNull();
  });

  it("🔴 dayPositionOf는 트랙을 가르지 않는다 — 중1 차시와 중3 차시가 한 칸에 있으면 가장 뒤(중3)가 그날 위치", () => {
    // 종전엔 트랙별로 갈라 '현행'과 '선행'에 각각 세웠다 — 그러면 다음 학년 목표를 적은 학생이 "목표 없음"이 됐다.
    const day = dayPositionOf(`수학 ${중1_방정식}\n${중3_곱셈}`, "중2");
    expect(day?.position).toBe(positionOf(중3_곱셈)!.position);
    expect(day?.grade).toBe("중3");
  });
});
