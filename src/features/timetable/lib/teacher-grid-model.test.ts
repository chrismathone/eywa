import { describe, expect, it } from "vitest";
import { buildTeacherGridModel } from "./teacher-grid-model";

// 최소 슬롯 픽스처(모델이 요구하는 필드 + 렌더용 className/room).
const slot = (
  p: {
    classId: string;
    day?: string;
    start: string;
    end: string;
    label?: string | null; // slot_teacher_label
    teacher?: string | null; // 담임
    name?: string;
    room?: string | null;
  },
) => ({
  classId: p.classId,
  dayOfWeek: p.day ?? "mon",
  startTime: p.start,
  endTime: p.end,
  slotTeacherLabel: p.label ?? null,
  teacherName: p.teacher ?? null,
  className: p.name ?? p.classId,
  slotRoomLabel: p.room ?? null,
});

describe("buildTeacherGridModel", () => {
  it("강사 컬럼 = slot_teacher_label 우선(담임 폴백), 시트 순서 정렬", () => {
    const model = buildTeacherGridModel([
      slot({ classId: "a", label: "Sam", start: "15:00", end: "15:40" }),
      slot({ classId: "b", label: "Anna", start: "15:00", end: "15:40" }),
      slot({ classId: "c", label: null, teacher: "담임김", start: "15:00", end: "15:40" }),
    ]);
    // ENGLISH_SHEET_TEACHERS: Anna(7) < Sam(10) < 시트밖 담임김(이름순 뒤).
    expect(model.teachers.map((t) => t.name)).toEqual(["Anna", "Sam", "담임김"]);
  });

  it("🔴 특수 자리 두 개(LAB·JJ)는 각자 한 열 — 합쳐지지 않고 시트 블록 순서대로 맨 오른쪽", () => {
    // 라벨은 서버 쿼리에서 이미 해석돼 도착한다(JJ 11 · 이주희/LAB → LAB 12).
    const model = buildTeacherGridModel([
      slot({ classId: "a", label: "LAB", start: "15:00", end: "15:40" }),
      slot({ classId: "b", label: "JJ", start: "15:00", end: "15:40" }),
      slot({ classId: "c", label: "Anna", start: "15:00", end: "15:40" }),
    ]);
    expect(model.teachers.map((t) => t.name)).toEqual(["Anna", "JJ", "LAB"]);
    // 헤더색도 시트 블록색을 그대로 승계(JJ=회색 · LAB(시트 이주희 블록)=연노랑).
    expect(model.teachers.map((t) => t.color?.bg)).toEqual(["#4285f4", "#bdbdbd", "#fff2cc"]);
  });

  it("단일 반 블록 — laneAnchors 앵커 + laneCovered 세로 연속(1레인=화면 anchors와 동일)", () => {
    const model = buildTeacherGridModel([
      slot({ classId: "a", label: "Anna", start: "15:00", end: "15:40", room: "602" }),
    ]);
    const anna = model.teachers.find((t) => t.name === "Anna")!;
    expect(anna.cols).toHaveLength(1);
    const col = anna.cols[0];
    expect(col.laneCount).toBe(1);
    // 15:00 = 폴백 그리드(14:20 시작, step10) index 4, 40분 = span 4.
    const a = col.laneAnchors.get("4:0")!;
    expect(a.span).toBe(4);
    expect(a.interval.slots[0]!.className).toBe("a");
    expect(a.interval.slots[0]!.slotRoomLabel).toBe("602");
    // 세로 연속 3칸 피복, 앵커 자신은 미포함.
    expect([...col.laneCovered].sort()).toEqual(["5:0", "6:0", "7:0"]);
    expect(col.laneCovered.has("4:0")).toBe(false);
    // 화면 표현(그룹)도 동일 앵커.
    expect(col.anchors.get("4:0")!.span).toBe(4);
  });

  it("병렬 반(같은 시간범위, 같은 컬럼) — laneCount 2, 레인별 개별 앵커", () => {
    const model = buildTeacherGridModel([
      slot({ classId: "x", label: "LAB", start: "15:00", end: "15:40" }),
      slot({ classId: "y", label: "LAB", start: "15:00", end: "15:40" }),
    ]);
    const lab = model.teachers.find((t) => t.name === "LAB")!;
    const col = lab.cols[0];
    expect(col.laneCount).toBe(2);
    // 엑셀: 반 2개가 레인 0·1에 각각(가로 이웃은 별도 앵커, 피복 아님).
    expect(col.laneAnchors.has("4:0")).toBe(true);
    expect(col.laneAnchors.has("4:1")).toBe(true);
    expect(col.laneCovered.has("4:1")).toBe(false); // 가로 이웃 앵커행은 피복 아님
    // 화면: 한 그룹 셀(colSpan=2) → 가로 이웃(4:1)은 covered.
    expect(col.anchors.get("4:0")!.group.laneWidth).toBe(2);
    expect(col.covered.has("4:1")).toBe(true);
  });

  it("요일 = 실제 가르치는 요일만(월→토 자연순)", () => {
    const model = buildTeacherGridModel([
      slot({ classId: "a", label: "Anna", day: "wed", start: "15:00", end: "15:40" }),
      slot({ classId: "b", label: "Anna", day: "mon", start: "15:00", end: "15:40" }),
    ]);
    const anna = model.teachers.find((t) => t.name === "Anna")!;
    expect(anna.cols.map((c) => c.day)).toEqual(["mon", "wed"]);
  });
});
