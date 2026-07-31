import { describe, expect, it } from "vitest";
import { groupRosterRows } from "./roster-order";

const NAMES: Record<string, string> = {
  s1: "김하나",
  s2: "박두리",
  s3: "이세찌",
  s4: "최네찌",
  s5: "한다섯",
};
const nameOf = (id: string) => NAMES[id] ?? "";

const row = (studentId: string, over?: Partial<{ eligible: boolean; endedOn: string | null }>) => ({
  studentId,
  eligible: over?.eligible ?? true,
  endedOn: over?.endedOn ?? null,
});

describe("groupRosterRows — 재원 → 퇴원 → 기록", () => {
  it("섹션 순서와 라벨(재원은 라벨 없음)", () => {
    const groups = groupRosterRows(
      [
        row("s3", { eligible: false }), // 기록
        row("s2", { eligible: false, endedOn: "2026-07-10" }), // 퇴원
        row("s1"), // 재원
      ],
      nameOf,
    );
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["active", null],
      ["withdrawn", "퇴원"],
      ["record", "기록"],
    ]);
  });

  it("빈 섹션은 반환하지 않는다(라벨만 뜨는 빈 구역 금지)", () => {
    const groups = groupRosterRows([row("s1"), row("s2")], nameOf);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("active");
  });

  it("재원·기록은 가나다 순", () => {
    const groups = groupRosterRows([row("s4"), row("s1"), row("s2")], nameOf);
    expect(groups[0].rows.map((r) => nameOf(r.studentId))).toEqual(["김하나", "박두리", "최네찌"]);
  });

  it("퇴원은 최신 종료일 먼저, 같은 날짜면 가나다", () => {
    const groups = groupRosterRows(
      [
        row("s4", { eligible: false, endedOn: "2026-07-01" }),
        row("s2", { eligible: false, endedOn: "2026-07-20" }),
        row("s1", { eligible: false, endedOn: "2026-07-20" }),
      ],
      nameOf,
    );
    expect(groups[0].rows.map((r) => [nameOf(r.studentId), r.endedOn])).toEqual([
      ["김하나", "2026-07-20"],
      ["박두리", "2026-07-20"],
      ["최네찌", "2026-07-01"],
    ]);
  });

  it("이름을 모르는 행(메타 없음)도 id 순으로 안정 정렬된다", () => {
    const groups = groupRosterRows([row("zz9"), row("aa1")], () => "");
    expect(groups[0].rows.map((r) => r.studentId)).toEqual(["aa1", "zz9"]);
  });

  it("eligible이면 endedOn이 있어도 재원 섹션(모순 입력 방어)", () => {
    const groups = groupRosterRows([row("s1", { eligible: true, endedOn: "2026-07-10" })], nameOf);
    expect(groups[0].key).toBe("active");
  });
});
