import { describe, expect, it } from "vitest";
import {
  loadPreset,
  normalizePresets,
  removePreset,
  renamePreset,
  upsertPreset,
  type GroupPreset,
} from "./group-presets";

const preset = (id: string, name: string, classIds: string[] = ["c1"]): GroupPreset => ({
  id,
  name,
  groups: [{ id: "g1", title: "1줄", classIds }],
  showOthers: true,
  othersTitle: "기타 수업",
});

describe("통합뷰 그룹 배치 보관함(프리셋)", () => {
  it("새 이름이면 뒤에 붙는다", () => {
    const out = upsertPreset([preset("p1", "학기")], preset("p2", "방학"));
    expect(out.map((p) => p.name)).toEqual(["학기", "방학"]);
  });

  it("같은 이름은 덮어쓰되 자리와 id를 유지한다(목록에서 고르는 키가 이름이라 중복이 곧 고장)", () => {
    const out = upsertPreset(
      [preset("p1", "학기", ["a"]), preset("p2", "방학")],
      preset("new-id", "학기", ["b", "c"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("p1"); // id 유지 — 다른 화면이 id로 가리켜도 안 끊긴다
    expect(out[0].groups[0].classIds).toEqual(["b", "c"]);
    expect(out.map((p) => p.name)).toEqual(["학기", "방학"]);
  });

  it("이름 앞뒤 공백은 같은 이름으로 본다(유령 중복 방지)", () => {
    const out = upsertPreset([preset("p1", "학기")], preset("p2", "  학기  "));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("학기");
  });

  it("삭제 — 없는 id는 무동작", () => {
    const list = [preset("p1", "학기"), preset("p2", "방학")];
    expect(removePreset(list, "p1").map((p) => p.name)).toEqual(["방학"]);
    expect(removePreset(list, "없음")).toBe(list);
  });

  it("이름 변경 — 빈 이름·다른 프리셋과 겹치는 이름은 거부", () => {
    const list = [preset("p1", "학기"), preset("p2", "방학")];
    expect(renamePreset(list, "p1", "겨울")[0].name).toBe("겨울");
    expect(renamePreset(list, "p1", "  ")).toBe(list);
    expect(renamePreset(list, "p1", "방학")).toBe(list);
  });

  it("불러오기는 깊은 복사 — 불러온 뒤 편집해도 보관본이 안 바뀐다", () => {
    const p = preset("p1", "학기", ["a"]);
    const body = loadPreset(p);
    body.groups[0].classIds.push("b");
    body.groups[0].title = "바뀜";
    expect(p.groups[0].classIds).toEqual(["a"]);
    expect(p.groups[0].title).toBe("1줄");
  });

  it("저장된 부분값은 완전한 프리셋으로 정규화(기본은 '기타 보여줌')", () => {
    const out = normalizePresets([{ id: "p1", name: "학기" }], "기타 수업");
    expect(out[0]).toEqual({ id: "p1", name: "학기", groups: [], showOthers: true, othersTitle: "기타 수업" });
    expect(normalizePresets([{ id: "p2", name: "x", showOthers: false }])[0].showOthers).toBe(false);
  });
});

describe("누가·언제 저장했나(도장)", () => {
  it("불러오기는 도장을 실어 나르지 않는다 — 불러온 배치를 다시 저장하면 **그때 그 사람이** 저장한 것", () => {
    const p: GroupPreset = { ...preset("p1", "학기"), savedBy: "박소선", savedAt: "2026-08-01T00:00:00.000Z" };
    const body = loadPreset(p);
    expect("savedBy" in body).toBe(false);
    expect("savedAt" in body).toBe(false);
  });

  it("저장된 도장은 정규화에서 그대로 살아남는다(옛 저장분은 없어도 무방)", () => {
    const out = normalizePresets([
      { id: "p1", name: "학기", savedBy: "박소선", savedAt: "2026-08-01T00:00:00.000Z" },
      { id: "p2", name: "옛것" },
    ]);
    expect(out[0].savedBy).toBe("박소선");
    expect(out[0].savedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(out[1].savedBy).toBeUndefined();
  });
});
