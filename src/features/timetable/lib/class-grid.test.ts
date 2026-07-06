import { describe, it, expect } from "vitest";
import { buildRichCardGroups, teacherColor, type GridSlot } from "./class-grid";
import { DEFAULT_PERIODS_CONFIG } from "./periods";

const C = DEFAULT_PERIODS_CONFIG;

function slot(p: Partial<GridSlot>): GridSlot {
  return {
    classId: "c1",
    className: "PJ2",
    subject: "english",
    dayOfWeek: "mon",
    startTime: "14:20",
    endTime: "15:00",
    teacherName: "Hannah",
    classroomName: "본원604",
    slotTeacherLabel: null,
    slotRoomLabel: null,
    classBgColor: null,
    classTextColor: null,
    students: [],
    ...p,
  };
}

describe("buildRichCardGroups", () => {
  it("반별 카드 + 요일×교시 셀(슬롯 강사/LAB)·요일별 강의실 도출", () => {
    const groups = buildRichCardGroups(
      [
        slot({ dayOfWeek: "mon", startTime: "14:20", slotTeacherLabel: "LAB", slotRoomLabel: "LAB실" }),
        slot({ dayOfWeek: "mon", startTime: "15:00", slotTeacherLabel: "Kristine", slotRoomLabel: null }),
        slot({ dayOfWeek: "thu", startTime: "15:00", slotTeacherLabel: "Zoe", slotRoomLabel: null }),
      ],
      C,
    );
    expect(groups).toHaveLength(1);
    const card = groups[0].cards[0];
    // 14:20=영어 1교시(order=860), 15:00=2교시(order=900)
    expect(card.cells["860:mon"]).toEqual({ label: "LAB", isLab: true });
    expect(card.cells["900:mon"]).toEqual({ label: "Kristine", isLab: false });
    expect(card.cells["900:thu"]).toEqual({ label: "Zoe", isLab: false });
    // 강의실: 월 LAB실 / 나머지 반기본(본원604→604) → "월 LAB실 / 목 604" 형태(요일 묶음, 본원 접두사 압축)
    expect(card.classroomLabel).toContain("LAB실");
    expect(card.classroomLabel).toContain("604");
    expect(card.classroomLabel).not.toContain("본원");
  });

  it("슬롯 강사 없으면 반 기본 강사로 셀 채움(수학식 단색)", () => {
    const groups = buildRichCardGroups(
      [slot({ subject: "math", className: "수학A", teacherName: "김선생", startTime: "14:30", slotTeacherLabel: null })],
      C,
    );
    const card = groups[0].cards[0];
    const cell = Object.values(card.cells)[0];
    expect(cell.label).toBe("김선생");
    expect(cell.isLab).toBe(false);
  });

  it("시작 교시별 그룹(평일 기준) + 주말 전용 반은 '주말' 섹션(맨 뒤)", () => {
    const groups = buildRichCardGroups(
      [
        slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "14:20" }), // 영어 1교시
        slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "15:00" }), // 영어 2교시
        slot({ classId: "w", className: "W", subject: "english", dayOfWeek: "sat", startTime: "09:00", endTime: "10:00" }),
      ],
      C,
    );
    expect(groups[groups.length - 1].label).toBe("주말");
    const weekday = groups.filter((g) => g.label !== "주말");
    expect(weekday.map((g) => g.label)).toEqual(["1교시 시작", "2교시 시작"]);
  });

  it("평일 섹션은 항상 5요일(월~금)·5교시 그리드(5×5 기본) + 대기/퇴원 높이 동기화(max)", () => {
    const groups = buildRichCardGroups(
      [
        slot({
          classId: "a",
          className: "A",
          dayOfWeek: "mon",
          startTime: "14:20",
          students: [
            { name: "가", grade: "초3", school: "A초", status: "active" },
            { name: "나", grade: "초3", school: "A초", status: "hold" },
          ],
        }),
        slot({ classId: "b", className: "B", dayOfWeek: "tue", startTime: "14:20" }),
      ],
      C,
    );
    const g = groups[0];
    expect(g.days).toEqual(["mon", "tue", "wed", "thu", "fri"]); // 실제 월·화뿐이어도 항상 월~금 5열
    expect(g.periodRows).toHaveLength(5); // 영어 1교시 시작 → 1~5교시 5행
    expect(g.periodRows.map((p) => p.label)).toEqual(["1교시", "2교시", "3교시", "4교시", "5교시"]);
    expect(g.holdRows).toBe(1); // max(1,0)=1 → 빈 칸도 한 줄 높이
  });

  it("끝 가까운 섹션도 5교시 확보(윈도우 당김) — 10교시 시작 → 7~11교시", () => {
    const groups = buildRichCardGroups(
      [slot({ classId: "x", className: "X", dayOfWeek: "mon", startTime: "20:20" })], // 영어 10교시(통합 시트)
      C,
    );
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["7교시", "8교시", "9교시", "10교시", "11교시"]);
  });

  it("compact('1시간 단위')=그룹별 사이 빈 교시만 제거(4·6·8 점유 → 5·7 숨김)", () => {
    // 1시간 단위 수업 = 16:20(4교시)·17:20(6교시)·18:20(8교시) → 5·7교시가 빔.
    const oneHour = [
      slot({ dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
    ];
    // 기본(compact 아님) — 5칸 윈도우라 빈 5·7교시 포함(가운데 공백).
    expect(buildRichCardGroups(oneHour, C)[0].periodRows.map((p) => p.label)).toEqual([
      "4교시", "5교시", "6교시", "7교시", "8교시",
    ]);
    // compact — 점유 범위(4~8) 사이의 빈 5·7만 제거 = 1시간 단위.
    expect(buildRichCardGroups(oneHour, C, true)[0].periodRows.map((p) => p.label)).toEqual([
      "4교시", "6교시", "8교시",
    ]);
  });

  it("compact여도 그룹 위아래 빈 교시(윈도우 패딩)는 유지 — 사이만 숨김", () => {
    // 아래 패딩: 1·2·3교시만 점유(사이 공백 없음) → 뒤따르는 빈 4·5교시 유지(compact 무변).
    const morning = [
      slot({ dayOfWeek: "mon", startTime: "14:20" }),
      slot({ dayOfWeek: "mon", startTime: "15:00" }),
      slot({ dayOfWeek: "mon", startTime: "15:40" }),
    ];
    expect(buildRichCardGroups(morning, C, true)[0].periodRows.map((p) => p.label)).toEqual([
      "1교시", "2교시", "3교시", "4교시", "5교시",
    ]);
    // 위 패딩: 8·10교시 점유(윈도우 당김으로 7~11) → 위 7·아래 11 유지, 사이 9만 숨김.
    const evening = [
      slot({ dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
      slot({ dayOfWeek: "mon", startTime: "20:20", endTime: "21:10" }),
    ];
    expect(buildRichCardGroups(evening, C, true)[0].periodRows.map((p) => p.label)).toEqual([
      "7교시", "8교시", "10교시", "11교시",
    ]);
  });

  it("compact=같은 시작 교시라도 체계 다른 반은 별도 그룹 분리(각 그룹이 자기 축으로 압축·클립 없음)", () => {
    // 1시간 체계 A(4·6·8) + 40분 체계 B(4·5·7) — 같은 '4교시 시작'이지만 서로의 빈 행을 점유.
    const mixed = [
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "16:20", endTime: "17:00" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:00", endTime: "17:40" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:40", endTime: "18:20" }),
    ];
    // compact 아님 — 한 그룹, 유니언 축(4~8 전부).
    const plain = buildRichCardGroups(mixed, C);
    expect(plain).toHaveLength(1);
    expect(plain[0].periodRows.map((p) => p.label)).toEqual(["4교시", "5교시", "6교시", "7교시", "8교시"]);
    // compact — 두 그룹으로 분리, 각자 사이 빈 행만 숨김(B의 5·7교시 클립 없음).
    const groups = buildRichCardGroups(mixed, C, true);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("4교시 시작");
    expect(groups[0].cards.map((c) => c.className)).toEqual(["A"]);
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
    expect(groups[1].label).toBe("4교시 시작 ②");
    expect(groups[1].cards.map((c) => c.className)).toEqual(["B"]);
    // B 축: 4·5·7 점유 + 사이 6 숨김 + 아래 패딩 8 유지.
    expect(groups[1].periodRows.map((p) => p.label)).toEqual(["4교시", "5교시", "7교시", "8교시"]);
  });

  it("compact=같은 체계(부분집합 점유)는 한 그룹 유지 — 과분리 없음", () => {
    const sameChain = [
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }), // 4·6·8
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }), // 4·6
    ];
    const groups = buildRichCardGroups(sameChain, C, true);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.className)).toEqual(["A", "B"]);
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
  });

  it("영문이름·신입/전입은 학생에 보존", () => {
    const groups = buildRichCardGroups(
      [
        slot({
          students: [
            { name: "강민승", grade: "초4", school: "달성초", status: "active", englishName: "Willy", isNew: true },
            { name: "현가현", grade: "초4", school: "종로초", status: "active", isTransferredIn: true },
          ],
        }),
      ],
      C,
    );
    const card = groups[0].cards[0];
    expect(card.active[0].englishName).toBe("Willy");
    expect(card.active.find((s) => s.name === "현가현")?.isTransferredIn).toBe(true);
  });

  it("teacherColor는 결정적(같은 라벨 같은 색)", () => {
    expect(teacherColor("Kristine")).toBe(teacherColor("Kristine"));
    expect(teacherColor(null)).toBe("blue");
  });
});
