import { describe, expect, it } from "vitest";
import { operationsSchema } from "./settings-types";
import { DEFAULT_SETTINGS } from "./defaults";

/**
 * 저장 게이트(saveOwnerSection이 쓰는 스키마) 회귀.
 *
 * 원장 2026-08-13: 과목 운영에서 교시 이름을 지우면 저장이
 * `입력값 오류 (subjects.1.weekdayPeriods.0.label): Too small`로 **거부**됐다.
 * 이름을 안 붙이는 건 정당한 선택(그 교시는 화면에 시간대만 나온다)이라 빈 값을 허용한다.
 * ⚠️ `min(1)`을 다시 붙이지 말 것 — 그러면 이름을 지운 학원이 다른 설정도 저장 못 한다(섹션 전체가 막힌다).
 */
describe("operationsSchema — 교시 이름은 비워도 저장된다", () => {
  const ops = DEFAULT_SETTINGS.operations;

  it("전역 평일 교시 이름을 비워도 통과", () => {
    const parsed = operationsSchema.safeParse({
      ...ops,
      weekdayPeriods: ops.weekdayPeriods.map((p, i) => (i === 0 ? { ...p, label: "" } : p)),
    });
    expect(parsed.success).toBe(true);
  });

  it("과목 전용 평일 교시 이름을 비워도 통과(원장이 실제로 막혔던 경로)", () => {
    const parsed = operationsSchema.safeParse({
      ...ops,
      subjects: ops.subjects.map((s) =>
        s.weekdayPeriods?.length ? { ...s, weekdayPeriods: s.weekdayPeriods.map((p) => ({ ...p, label: "" })) } : s,
      ),
    });
    expect(parsed.success).toBe(true);
  });

  it("시각은 여전히 HH:MM 형식이어야 한다(빈 이름 허용이 검증을 통째로 푼 게 아니다)", () => {
    // ⚠️ 스키마는 **형식만** 본다(`/^\d{2}:\d{2}$/`) — "25:00"은 통과한다. 범위 검증은 여기 몫이 아니다.
    const parsed = operationsSchema.safeParse({
      ...ops,
      weekdayPeriods: [{ label: "", startTime: "1000", endTime: "10:00" }],
    });
    expect(parsed.success).toBe(false);
  });
});
