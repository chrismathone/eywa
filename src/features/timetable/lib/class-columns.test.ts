import { describe, it, expect } from "vitest";
import { buildClassCards, buildClassCardGroups, type ClassColumnSlot } from "./class-columns";
import { DEFAULT_PERIODS_CONFIG } from "./periods";

const C = DEFAULT_PERIODS_CONFIG;

function slot(p: Partial<ClassColumnSlot>): ClassColumnSlot {
  return {
    classId: "c1",
    className: "수학A",
    subject: "math",
    dayOfWeek: "mon",
    startTime: "14:30",
    endTime: "15:25",
    teacherName: "김선생",
    classroomName: "301",
    students: [],
    ...p,
  };
}

describe("buildClassCards", () => {
  it("반(classId)별 카드로 묶고 명단·스케줄·정원 도출", () => {
    const cards = buildClassCards(
      [
        slot({
          classId: "c1",
          dayOfWeek: "mon",
          startTime: "14:30",
          students: [
            { name: "가", grade: "중1", school: "A중", status: "active" },
            { name: "나", grade: "중1", school: "A중", status: "hold" },
          ],
        }),
        slot({ classId: "c1", dayOfWeek: "thu", startTime: "14:30" }),
      ],
      C,
    );
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.activeCount).toBe(1); // 재원만
    expect(card.scheduleLabel).toContain("월");
    expect(card.scheduleLabel).toContain("목");
    expect(card.scheduleLabel).toContain("14:30");
  });

  it("시작 시각순 → 반명순 정렬", () => {
    const cards = buildClassCards(
      [
        slot({ classId: "b", className: "B반", startTime: "16:20" }),
        slot({ classId: "a", className: "A반", startTime: "14:30" }),
        slot({ classId: "c", className: "C반", startTime: "14:30" }),
      ],
      C,
    );
    expect(cards.map((c) => c.className)).toEqual(["A반", "C반", "B반"]);
  });

  it("대표 강사 = 최빈 강사(여러 강사면 가장 많이 가르치는 사람)", () => {
    const cards = buildClassCards(
      [
        slot({ classId: "x", dayOfWeek: "mon", teacherName: "김선생" }),
        slot({ classId: "x", dayOfWeek: "wed", teacherName: "김선생" }),
        slot({ classId: "x", dayOfWeek: "fri", teacherName: "이선생" }),
      ],
      C,
    );
    expect(cards[0].teacherName).toBe("김선생");
  });
});

describe("buildClassCardGroups — 시작 교시별 섹션(평일 기준) + 주말 따로", () => {
  it("평일 반은 시작 교시별 그룹, 주말 전용 반은 '주말' 그룹(맨 뒤)", () => {
    const groups = buildClassCardGroups(
      [
        slot({ classId: "a", className: "1교시반", dayOfWeek: "mon", startTime: "14:30" }), // 1교시 시작
        slot({ classId: "b", className: "2교시반", dayOfWeek: "mon", startTime: "16:20" }), // 2교시 시작
        slot({ classId: "w", className: "주말반", dayOfWeek: "sat", startTime: "09:00", endTime: "10:00" }),
      ],
      C,
    );
    // 주말 그룹은 항상 맨 뒤
    expect(groups[groups.length - 1].label).toBe("주말");
    expect(groups[groups.length - 1].cards.map((c) => c.className)).toEqual(["주말반"]);
    // 평일 그룹은 시작 교시 순(1교시 → 2교시)
    const weekday = groups.filter((g) => g.label !== "주말");
    expect(weekday.map((g) => g.label)).toEqual(["1교시 시작", "2교시 시작"]);
    expect(weekday[0].cards.map((c) => c.className)).toEqual(["1교시반"]);
  });

  it("평일+주말 동시 수강 반은 평일 시작 교시 기준으로 묶인다(주말 그룹 아님)", () => {
    const groups = buildClassCardGroups(
      [
        slot({ classId: "mix", className: "혼합반", dayOfWeek: "mon", startTime: "14:30" }),
        slot({ classId: "mix", className: "혼합반", dayOfWeek: "sat", startTime: "09:00", endTime: "10:00" }),
      ],
      C,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("1교시 시작"); // 평일 14:30 = 1교시 기준
    expect(groups[0].cards.map((c) => c.className)).toEqual(["혼합반"]);
  });

  it("중복 '1교시' 라벨 없음 — 주말 1교시(09:00)가 평일 1교시 버킷에 안 섞임", () => {
    const groups = buildClassCardGroups(
      [
        slot({ classId: "wd", className: "평일1교시", dayOfWeek: "mon", startTime: "14:30" }),
        slot({ classId: "we", className: "주말1교시", dayOfWeek: "sun", startTime: "09:00", endTime: "10:00" }),
      ],
      C,
    );
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual(["1교시 시작", "주말"]); // "1교시 시작"이 정확히 한 번
  });
});
