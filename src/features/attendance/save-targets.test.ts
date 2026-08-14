import { describe, expect, it } from "vitest";
import { hasSaveTarget, pickSaveTargets } from "./save-targets";

const day = (id: string) => ({ id, slot_start: null });
const at = (id: string, slot: string) => ({ id, slot_start: slot });

describe("pickSaveTargets", () => {
  it("교시 미지정이면 그날 모든 교시 행을 함께 고친다", () => {
    const t = pickSaveTargets([at("c", "17:20"), at("b", "16:20"), day("a")], null);
    expect(new Set(t.updateIds)).toEqual(new Set(["a", "b", "c"]));
    expect(t.promoteIds).toEqual([]);
  });

  it("교시마다 최신 1건만 고른다(정정 이력은 안 건드린다)", () => {
    // recorded_at 내림차순 입력 — 같은 교시의 뒤엣것은 옛 정정본
    const t = pickSaveTargets([at("new", "16:20"), at("old", "16:20")], null);
    expect(t.updateIds).toEqual(["new"]);
  });

  it("교시를 넘겼고 그 교시 행이 있으면 그 행을 고친다", () => {
    const t = pickSaveTargets([at("x", "16:20"), at("y", "17:20")], "17:20");
    expect(t.updateIds).toEqual(["y"]);
    expect(t.promoteIds).toEqual([]);
  });

  it("교시 행 + day-level 행이 공존하면 둘을 함께 고친다(옛 상태가 남의 칸에 안 보이게)", () => {
    const t = pickSaveTargets([at("slot", "17:20"), day("legacy")], "17:20");
    expect(new Set(t.updateIds)).toEqual(new Set(["slot", "legacy"]));
    expect(t.promoteIds).toEqual([]);
  });

  it("🔴 day-level 행뿐이면 승격한다 — 새 행을 만들지 않는다(시수 이중 계상 차단)", () => {
    const t = pickSaveTargets([day("legacy")], "16:20");
    expect(t.updateIds).toEqual([]);
    expect(t.promoteIds).toEqual(["legacy"]);
  });

  it("🔴 승격 뒤 다른 교시 저장은 대상이 없어 새 행이 된다 = 교시당 한 행", () => {
    // 승격 결과를 그대로 다음 저장의 입력으로 넣어 본다
    const promoted = [at("legacy", "16:20")];
    const second = pickSaveTargets(promoted, "17:20");
    expect(second.updateIds).toEqual([]);
    expect(second.promoteIds).toEqual([]);
    expect(hasSaveTarget(second)).toBe(false); // → INSERT
  });

  it("다른 교시 행은 남의 칸이라 절대 건드리지 않는다", () => {
    const t = pickSaveTargets([at("other", "16:20")], "17:20");
    expect(t).toEqual({ updateIds: [], promoteIds: [] });
  });

  it("초 단위가 붙은 slot_start도 앞 5자로 맞춘다", () => {
    const t = pickSaveTargets([at("x", "16:20:00")], "16:20");
    expect(t.updateIds).toEqual(["x"]);
  });

  it("기록이 없으면 대상 없음", () => {
    expect(hasSaveTarget(pickSaveTargets([], "16:20"))).toBe(false);
    expect(hasSaveTarget(pickSaveTargets([], null))).toBe(false);
  });
});
