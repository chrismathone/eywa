import { describe, expect, it } from "vitest";
import { groupLandingByMyRole, MY_ROLE_LABEL } from "./landing-my-role";
import { SHEET_DICT } from "@/features/teacher-view/i18n";

const card = (id: string, teacherId: string | null, filled = 1, scheduled = 6) => ({
  classId: id,
  teacherId,
  teacherName: teacherId ? `T${teacherId}` : null,
  totalSlots: scheduled,
  filledSlots: filled,
});

const ME = "me";

describe("강사 본인 화면의 묶음 — 담임 / 부담임", () => {
  it("🔴 판정은 teacherId 하나 — 내가 담임인 반만 '담임'", () => {
    const g = groupLandingByMyRole([card("a", ME), card("b", "other"), card("c", ME)], ME);
    expect(g.map((x) => x.key)).toEqual(["homeroom", "assistant"]);
    expect(g[0]!.cards.map((c) => c.classId)).toEqual(["a", "c"]);
    expect(g[1]!.cards.map((c) => c.classId)).toEqual(["b"]);
  });

  it("🔴 담임 미지정 반도 '부담임' 쪽에 남는다 — 어느 갈래에도 없어 사라지면 안 된다", () => {
    const g = groupLandingByMyRole([card("a", null)], ME);
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe("assistant");
  });

  it("빈 갈래는 만들지 않는다", () => {
    expect(groupLandingByMyRole([card("a", ME)], ME).map((x) => x.key)).toEqual(["homeroom"]);
    expect(groupLandingByMyRole([card("a", "other")], ME).map((x) => x.key)).toEqual(["assistant"]);
    expect(groupLandingByMyRole([], ME)).toEqual([]);
  });

  it("반 순서는 서버가 준 그대로(묶음 안에서 다시 정렬하지 않는다)", () => {
    const g = groupLandingByMyRole([card("z", ME), card("a", ME)], ME);
    expect(g[0]!.cards.map((c) => c.classId)).toEqual(["z", "a"]);
  });

  it("갈래별 작성률은 그 갈래 몫만 센다", () => {
    const g = groupLandingByMyRole([card("a", ME, 3, 6), card("b", "other", 1, 6)], ME);
    expect(g[0]!.summary.filled).toBe(3);
    expect(g[1]!.summary.filled).toBe(1);
  });

  it("🔴 라벨은 **이미 있는 사전 키**를 쓴다 — 같은 말의 표를 새로 만들지 않는다", () => {
    expect(SHEET_DICT[MY_ROLE_LABEL.homeroom]!.ko).toBe("담임");
    expect(SHEET_DICT[MY_ROLE_LABEL.assistant]!.ko).toBe("부담임");
    expect(SHEET_DICT[MY_ROLE_LABEL.homeroom]!.en).toBe("Homeroom");
    expect(SHEET_DICT[MY_ROLE_LABEL.assistant]!.en).toBe("Assistant");
  });
});
