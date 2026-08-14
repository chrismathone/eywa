import { describe, expect, it } from "vitest";
import { withEmptyRowSections } from "./edit-rows";
import { OTHERS_GROUP_ID, type RichCardGroup } from "./class-grid";
import type { GroupDraft } from "./group-assign";

/**
 * 반이 0개인 줄이 편집 보드에서 통째로 사라지던 결함(원장 2026-08-14 *"줄 추가도 안되네?"*).
 * 섹션은 카드에서 파생되므로 빈 줄은 섹션이 없고, 그러면 **드롭 칸이 없어 반을 넣을 수도 없다**
 * → 새 줄을 만드는 것 자체가 불가능했다.
 */
const section = (customGroupId: string | undefined, label: string, cards = 1): RichCardGroup =>
  ({
    key: `k::${label}`,
    label,
    order: 0,
    sectionKey: 0,
    compacted: false,
    compactable: true,
    cards: Array.from({ length: cards }, (_, i) => ({ classId: `c${i}`, className: `반${i}` })),
    periodRows: [],
    days: [],
    rosterRows: { active: 0, hold: 0, withdrawn: 0 },
    customGroupId,
  }) as unknown as RichCardGroup;

const row = (id: string, title = id): GroupDraft => ({ id, title, classIds: [] });

describe("withEmptyRowSections", () => {
  it("반이 없는 줄도 섹션으로 끼워 넣는다(드롭 칸이 생긴다)", () => {
    const out = withEmptyRowSections([section("a", "A")], [row("a"), row("b")]);
    expect(out.map((s) => s.customGroupId)).toEqual(["a", "b"]);
    const empty = out[1]!;
    expect(empty.cards).toHaveLength(0);
    expect(empty.label).toBe("b");
    expect(empty.compactable).toBe(false); // 반이 없으니 '1시간 단위'는 뜻이 없다
  });

  it("줄 순서는 groups 배열이 진실 — 빈 줄이 사이에 있어도 그 자리에 들어간다", () => {
    const out = withEmptyRowSections(
      [section("c", "C"), section("a", "A")],
      [row("a"), row("b"), row("c")],
    );
    expect(out.map((s) => s.customGroupId)).toEqual(["a", "b", "c"]);
  });

  it("미배정('기타')은 줄이 아니라 늘 맨 뒤", () => {
    const out = withEmptyRowSections(
      [section(OTHERS_GROUP_ID, "기타 수업"), section("a", "A")],
      [row("a"), row("b")],
    );
    expect(out.map((s) => s.customGroupId)).toEqual(["a", "b", OTHERS_GROUP_ID]);
  });

  it("한 줄이 두 섹션(평일·주말)으로 갈려 있으면 그 둘의 순서를 그대로 지킨다", () => {
    const weekday = section("a", "A-평일");
    const weekend = section("a", "A-주말");
    const out = withEmptyRowSections([weekday, weekend], [row("a"), row("b")]);
    expect(out.map((s) => s.label)).toEqual(["A-평일", "A-주말", "b"]);
  });

  it("빈 줄이 없으면 입력 배열을 그대로 돌려준다(불필요한 재정렬 없음)", () => {
    const input = [section("a", "A"), section("b", "B")];
    expect(withEmptyRowSections(input, [row("a"), row("b")])).toBe(input);
  });

  it("groups에 없는 id의 섹션은 맨 뒤로 밀되 사라지지 않는다", () => {
    const out = withEmptyRowSections([section("zz", "떠돌이"), section("a", "A")], [row("a"), row("b")]);
    expect(out.map((s) => s.customGroupId)).toEqual(["a", "b", "zz"]);
  });
});
