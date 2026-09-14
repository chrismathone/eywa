import { describe, expect, it } from "vitest";
import { SHEET_DICT } from "@/features/teacher-view/i18n";
import {
  ECS_EDIT_KINDS,
  MATH_EDIT_KINDS,
  parseSheetEdits,
  PLAN_FIELD_LABEL,
  SEAT_JJ_EDIT_KINDS,
  SEAT_PLAN_EDIT_KINDS,
  seatJjEditFieldOf,
  sheetEditCellId,
} from "./edit-audit";

// 원장 결정(2026-09-14) 범위 확대: 계획 줄 칸 · 수학 시트 월간 목표 · 자리 PIN 문 JJ 칸도 "칸을 떠날 때 한 줄".
const SID = "3f0b6a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const CID = "9a8b7c6d-1111-4222-8333-444455556666";

const plan = { kind: "plan", lineId: "6c1d2e3f-aaaa-4bbb-8ccc-dddddddddddd", field: "progress" };
const mathGoal = { kind: "mathGoal", studentId: SID, month: "2026-09", field: "targetProgress" };
const seatJj = {
  kind: "seatJj",
  classId: CID,
  studentId: SID,
  date: "2026-09-14",
  slotStart: "17:20:00",
  field: "listeningLevel",
};

describe("새 칸 종류의 모양 검증", () => {
  it("계획 칸 · 수학 목표 · 자리 JJ 칸이 통과하고 자리 교시는 HH:MM으로 굳는다", () => {
    const out = parseSheetEdits([
      { cell: plan, before: "U3" },
      { cell: mathGoal, before: null },
      { cell: seatJj, before: "3" },
    ]);
    expect(out).toHaveLength(3);
    expect(out![0]!.cell).toEqual(plan);
    expect(out![2]!.cell).toMatchObject({ slotStart: "17:20" });
  });

  it.each<[string, unknown]>([
    ["계획 칸 이름 틀림", { ...plan, field: "note" }],
    ["계획 줄 id 모양 틀림", { ...plan, lineId: "../x" }],
    ["수학 목표 달 모양 틀림", { ...mathGoal, month: "2026-9" }],
    ["자리 JJ 칸에 시험 점수(그 화면에 없다)", { ...seatJj, field: "score" }],
    ["자리 JJ 반 id가 uuid 아님", { ...seatJj, classId: "c1" }],
  ])("거절: %s", (_label, cell) => {
    expect(parseSheetEdits([{ cell, before: null }])).toBeNull();
  });
});

describe("🔴 문마다 자기 칸만 — 다른 문의 칸을 실어 보내 게이트를 우회하지 못한다", () => {
  it("강사 시트 문은 계획 칸을 받고, 수학·자리 JJ 칸은 통째로 거절", () => {
    expect(parseSheetEdits([{ cell: plan, before: null }], ECS_EDIT_KINDS)).toHaveLength(1);
    expect(parseSheetEdits([{ cell: plan, before: null }, { cell: mathGoal, before: null }], ECS_EDIT_KINDS)).toBeNull();
    expect(parseSheetEdits([{ cell: seatJj, before: null }], ECS_EDIT_KINDS)).toBeNull();
  });

  it("수학 문은 수학 목표만 · 자리 JJ 문은 JJ 칸만 · 공개 계획 문은 계획 칸만", () => {
    expect(parseSheetEdits([{ cell: mathGoal, before: null }], MATH_EDIT_KINDS)).toHaveLength(1);
    expect(
      parseSheetEdits([{ cell: { kind: "monthMemo", month: "2026-09" }, before: null }], MATH_EDIT_KINDS),
    ).toBeNull();
    expect(parseSheetEdits([{ cell: seatJj, before: null }], SEAT_JJ_EDIT_KINDS)).toHaveLength(1);
    expect(
      parseSheetEdits(
        [{ cell: { kind: "mark", studentId: SID, date: "2026-09-14", slotStart: "17:20", field: "status" }, before: null }],
        SEAT_JJ_EDIT_KINDS,
      ),
    ).toBeNull();
    expect(parseSheetEdits([{ cell: plan, before: null }], SEAT_PLAN_EDIT_KINDS)).toHaveLength(1);
    expect(parseSheetEdits([{ cell: mathGoal, before: null }], SEAT_PLAN_EDIT_KINDS)).toBeNull();
  });
});

describe("라벨·칸 이름", () => {
  it("🔴 계획 칸 이름은 계획 표 열 머리(사전 `plan.col.*` 한국어)와 글자까지 같다", () => {
    expect(PLAN_FIELD_LABEL.skill_area).toBe(SHEET_DICT["plan.col.kind"].ko);
    expect(PLAN_FIELD_LABEL.textbook).toBe(SHEET_DICT["plan.col.book"].ko);
    expect(PLAN_FIELD_LABEL.page_range).toBe(SHEET_DICT["plan.col.pageTime"].ko);
    expect(PLAN_FIELD_LABEL.progress).toBe(SHEET_DICT["plan.col.progress"].ko);
    expect(PLAN_FIELD_LABEL.homework).toBe(SHEET_DICT["plan.col.homework"].ko);
  });

  it("자리 화면의 태도(attitude)는 저장 컬럼 이름(status)으로 기록한다", () => {
    expect(seatJjEditFieldOf("attitude")).toBe("status");
    expect(seatJjEditFieldOf("memorizedWords")).toBe("memorizedWords");
  });

  it("칸 이름(id)은 종류가 달라도 뭉치지 않는다", () => {
    const ids = [plan, mathGoal, { ...seatJj, slotStart: "17:20" }].map((c) =>
      sheetEditCellId(c as Parameters<typeof sheetEditCellId>[0]),
    );
    expect(new Set(ids).size).toBe(3);
  });
});
