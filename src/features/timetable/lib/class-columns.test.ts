import { describe, it, expect } from "vitest";
import { buildClassCards, type ClassColumnSlot } from "./class-columns";

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
    const cards = buildClassCards([
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
    ]);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.activeCount).toBe(1); // 재원만
    expect(card.scheduleLabel).toContain("월");
    expect(card.scheduleLabel).toContain("목");
    expect(card.scheduleLabel).toContain("14:30");
  });

  it("시작 시각순 → 반명순 정렬", () => {
    const cards = buildClassCards([
      slot({ classId: "b", className: "B반", startTime: "16:20" }),
      slot({ classId: "a", className: "A반", startTime: "14:30" }),
      slot({ classId: "c", className: "C반", startTime: "14:30" }),
    ]);
    expect(cards.map((c) => c.className)).toEqual(["A반", "C반", "B반"]);
  });

  it("대표 강사 = 최빈 강사(여러 강사면 가장 많이 가르치는 사람)", () => {
    const cards = buildClassCards([
      slot({ classId: "x", dayOfWeek: "mon", teacherName: "김선생" }),
      slot({ classId: "x", dayOfWeek: "wed", teacherName: "김선생" }),
      slot({ classId: "x", dayOfWeek: "fri", teacherName: "이선생" }),
    ]);
    expect(cards[0].teacherName).toBe("김선생");
  });

  it("주말 반도 같은 카드 목록에 섞여 시작시각순으로(분절 박스 없음)", () => {
    const cards = buildClassCards([
      slot({ classId: "wd", className: "평일반", dayOfWeek: "mon", startTime: "16:20" }),
      slot({ classId: "we", className: "주말반", dayOfWeek: "sat", startTime: "09:00", endTime: "10:00" }),
    ]);
    expect(cards).toHaveLength(2);
    // 주말 09:00이 평일 16:20보다 먼저
    expect(cards.map((c) => c.className)).toEqual(["주말반", "평일반"]);
  });
});
