import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGLISH_SKILL_AREAS,
  resolveSkillAreas,
  skillAreaColorOf,
  skillAreaLabelOf,
} from "./skill-areas";

describe("resolveSkillAreas (ECS 구분 영역 해석)", () => {
  it("english 미설정 = 기본 6영역 프리필", () => {
    const areas = resolveSkillAreas({ key: "english" });
    expect(areas.map((a) => a.key)).toEqual([
      "vocab",
      "listening",
      "reading",
      "grammar",
      "writing",
      "speaking",
    ]);
  });

  it("english 빈 배열도 기본 6영역 프리필(미설정과 동일 취급)", () => {
    expect(resolveSkillAreas({ key: "english", skillAreas: [] })).toHaveLength(6);
  });

  it("설정값이 있으면 그 값이 이긴다(기본 6영역 무시)", () => {
    const areas = resolveSkillAreas({
      key: "english",
      skillAreas: [{ key: "phonics", label: "파닉스" }],
    });
    expect(areas).toEqual([{ key: "phonics", label: "파닉스" }]);
  });

  it("english 외 과목 미설정 = 빈 목록(ECS 대상 아님)", () => {
    expect(resolveSkillAreas({ key: "math" })).toEqual([]);
    expect(resolveSkillAreas(undefined)).toEqual([]);
  });

  it("english 외 과목도 설정하면 ECS 대상이 된다(설정 단일 소스)", () => {
    expect(
      resolveSkillAreas({ key: "math", skillAreas: [{ key: "algebra", label: "대수" }] }),
    ).toHaveLength(1);
  });

  it("기본 배열 원본은 변형되지 않는다(복사 반환)", () => {
    const a = resolveSkillAreas({ key: "english" });
    a.push({ key: "x", label: "X" });
    expect(DEFAULT_ENGLISH_SKILL_AREAS).toHaveLength(6);
  });
});

describe("skillAreaLabelOf (삭제된 slug 표시 유지)", () => {
  const areas = [{ key: "vocab", label: "Vocab" }];
  it("등록된 key = 설정 라벨 + known", () => {
    expect(skillAreaLabelOf(areas, "vocab")).toEqual({ label: "Vocab", known: true });
  });
  it("삭제된 key = slug 원문 표시 + known=false(데이터 소실 금지)", () => {
    expect(skillAreaLabelOf(areas, "grammar")).toEqual({ label: "grammar", known: false });
  });
});

describe("skillAreaColorOf (영역 고유색 — '아 보카네' 한눈 구분)", () => {
  const defaults = [...DEFAULT_ENGLISH_SKILL_AREAS];

  it("기본 6영역은 서로 다른 색", () => {
    const colors = defaults.map((a) => skillAreaColorOf(defaults, a.key));
    expect(new Set(colors).size).toBe(defaults.length);
  });

  it("설정 색이 내장 기본색을 이긴다", () => {
    expect(skillAreaColorOf(defaults, "vocab")).toBe("blue"); // 내장 기본
    expect(skillAreaColorOf([{ key: "vocab", label: "Vocab", color: "rose" }], "vocab")).toBe("rose");
  });

  it("색 없는 커스텀 영역도 순번으로 색을 받는다(무색 화면 금지)", () => {
    const areas = [
      { key: "area_1", label: "듣기훈련" },
      { key: "area_2", label: "쓰기첨삭" },
    ];
    const c1 = skillAreaColorOf(areas, "area_1");
    const c2 = skillAreaColorOf(areas, "area_2");
    expect(c1).not.toBe("neutral");
    expect(c1).not.toBe(c2);
  });

  it("설정에서 사라진 key는 neutral — 지워진 영역이 정상 영역처럼 보이면 안 된다", () => {
    expect(skillAreaColorOf(defaults, "phonics")).toBe("neutral");
  });

  it("망가진 저장값(팔레트 밖 색)은 무시하고 기본색으로 폴백", () => {
    const areas = [{ key: "vocab", label: "Vocab", color: "chartreuse" as never }];
    expect(skillAreaColorOf(areas, "vocab")).toBe("blue");
  });
});
