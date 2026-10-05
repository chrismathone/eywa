import { describe, expect, it } from "vitest";
import { cleanPreset, normalizeSubjectFields, sanitizeGroups, sanitizeTeacherOrder, stampPresets } from "./subject-fields";
import type { IntegrationGroupPresetSetting, SubjectSetting } from "./settings-types";

/**
 * 시간표 쪽 과목 칸의 저장 전 다듬기(2026-10-05 적대 리뷰 C1) — 다듬기와 보관함 도장은 중앙 저장이 정한다.
 * 화면용 서버 액션에만 두면 저장 액션을 직접 부르는 요청이 빈 줄·중복 배정·남의 이름 도장을 그대로 저장한다.
 */
const NOW = { by: "지금 저장하는 사람", at: "2026-10-05T12:00:00.000Z" };
const english = (patch: Partial<SubjectSetting> = {}): SubjectSetting => ({
  key: "english",
  label: "영어",
  color: "rose",
  weekdayGrouping: "mon-thu",
  testMax: 5,
  ...patch,
});
const preset = (patch: Partial<IntegrationGroupPresetSetting> = {}): IntegrationGroupPresetSetting => ({
  id: "p1",
  name: "학기 배치",
  groups: [{ id: "g1", title: "1교시", classIds: ["c1"] }],
  ...patch,
});

describe("그룹(줄)·강사 순서 다듬기", () => {
  it("제목 없는 줄은 버리고, 줄 사이에 겹친 반은 먼저 나온 줄이 갖는다", () => {
    expect(
      sanitizeGroups([
        { id: "g1", title: " 1교시 ", classIds: ["c1", "c2"] },
        { id: "g2", title: "   ", classIds: ["c3"] },
        { id: "g3", title: "2교시", classIds: ["c2", "c4"] },
      ]),
    ).toEqual([
      { id: "g1", title: "1교시", classIds: ["c1", "c2"] },
      { id: "g3", title: "2교시", classIds: ["c4"] },
    ]);
  });

  it("강사 순서는 공백·빈 값·중복을 걷어 낸다(먼저 나온 것이 이긴다)", () => {
    expect(sanitizeTeacherOrder([" Jane ", "", "Tom", "Jane", "  "])).toEqual(["Jane", "Tom"]);
  });

  it("이름 없는 보관함 항목은 버린다 · 다듬은 항목엔 도장이 없다", () => {
    expect(cleanPreset(preset({ name: "  " }))).toBeNull();
    const cleaned = cleanPreset(preset({ name: " 방학 ", othersTitle: "  ", savedBy: "x", savedAt: "y" } as IntegrationGroupPresetSetting));
    expect(cleaned).toEqual({ id: "p1", name: "방학", groups: [{ id: "g1", title: "1교시", classIds: ["c1"] }] });
  });
});

describe("보관함 도장", () => {
  const stored = [preset({ savedBy: "처음 만든 사람", savedAt: "2026-08-06T00:00:00.000Z" })];

  it("🔴 요청이 실어 온 '누가·언제'는 믿지 않는다 — 바뀐 항목은 지금 저장하는 사람·시각", () => {
    const forged = preset({ name: "학기 배치(수정)", savedBy: "다른 직원", savedAt: "2020-01-01T00:00:00Z" });
    expect(stampPresets([forged], stored, NOW)).toEqual([
      { id: "p1", name: "학기 배치(수정)", groups: forged.groups, savedBy: NOW.by, savedAt: NOW.at },
    ]);
  });

  it("🔴 내용이 그대로면 저장돼 있던 도장을 유지한다 — 요청이 다른 도장을 보내도", () => {
    const same = preset({ savedBy: "다른 직원", savedAt: "2020-01-01T00:00:00Z" });
    expect(stampPresets([same], stored, NOW)[0]).toMatchObject({ savedBy: "처음 만든 사람", savedAt: "2026-08-06T00:00:00.000Z" });
  });

  it("키 순서만 다른 저장본(jsonb)은 '그대로'다 — 저장 시각이 매번 갱신되지 않는다", () => {
    const reordered = [{ savedAt: "2026-08-06T00:00:00.000Z", groups: [{ classIds: ["c1"], title: "1교시", id: "g1" }], savedBy: "처음 만든 사람", name: "학기 배치", id: "p1" }];
    expect(stampPresets([preset()], reordered, NOW)[0]!.savedAt).toBe("2026-08-06T00:00:00.000Z");
  });

  it("새 항목은 지금 도장 · 다른 항목의 도장은 안 바뀐다", () => {
    const result = stampPresets([preset(), preset({ id: "p2", name: "방학 배치" })], stored, NOW);
    expect(result[0]!.savedBy).toBe("처음 만든 사람");
    expect(result[1]).toMatchObject({ id: "p2", savedBy: NOW.by, savedAt: NOW.at });
  });

  it("저장하는 사람 이름이 없으면 그 칸은 비운다(빈 문자열을 남기지 않는다)", () => {
    const [stamped] = stampPresets([preset({ id: "p9" })], [], { by: undefined, at: NOW.at });
    expect("savedBy" in stamped!).toBe(false);
    expect(stamped!.savedAt).toBe(NOW.at);
  });
});

describe("normalizeSubjectFields", () => {
  it("보낸 칸만 다듬고, null(지우기)과 안 보낸 칸은 그대로 통과한다", () => {
    const out = normalizeSubjectFields({ teacherViewOrder: [" A ", "A"], integrationOthersTitle: null }, english(), NOW);
    expect(out).toEqual({ teacherViewOrder: ["A"], integrationOthersTitle: null });
    expect("integrationGroups" in out).toBe(false);
  });

  it("다듬고 나니 빈 값이면 그 칸을 지운다", () => {
    expect(normalizeSubjectFields({ teacherViewOrder: [" ", ""], integrationOthersTitle: "   " }, english(), NOW)).toEqual({
      teacherViewOrder: null,
      integrationOthersTitle: null,
    });
  });

  it("보관함은 방금 읽은 그 과목의 저장본을 기준으로 도장을 찍는다", () => {
    const fresh = english({ integrationGroupPresets: [preset({ savedBy: "처음 만든 사람", savedAt: "2026-08-06T00:00:00.000Z" })] });
    const out = normalizeSubjectFields(
      { integrationGroupPresets: [preset({ savedBy: "위조" }), preset({ id: "p2", name: "새 배치", savedBy: "위조" })] },
      fresh,
      NOW,
    );
    expect(out.integrationGroupPresets!.map((p) => p.savedBy)).toEqual(["처음 만든 사람", NOW.by]);
  });

  it("빈 보관함(다 지웠다)은 빈 배열 그대로다", () => {
    expect(normalizeSubjectFields({ integrationGroupPresets: [] }, english({ integrationGroupPresets: [preset()] }), NOW)).toEqual({
      integrationGroupPresets: [],
    });
  });
});
