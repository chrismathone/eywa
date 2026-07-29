import { describe, expect, it } from "vitest";
import {
  buildTeacherLabelMap,
  isSpecialSlotLabel,
  resolveTeacherLabel,
  resolveTeacherLabels,
  specialSlotShortLabel,
} from "./teacher-label";

/** 실데이터(injaewon) 표본 — Zoe는 실제로 두 퇴사자가 나눠 쓴다. */
const USERS = [
  { displayName: "이현이", englishName: "Hannah", active: true },
  { displayName: "추민아", englishName: "Jane", active: true },
  { displayName: "김태건", englishName: "Sam", active: true },
  { displayName: "육소희", englishName: "Anna", active: true },
  { displayName: "이주희", englishName: "LAB", active: true },
  { displayName: "JJ", englishName: "JJ", active: true },
  { displayName: "곽민정", englishName: "Zoe", active: false },
  { displayName: "박나연(Jenny)", englishName: "Zoe", active: false },
  { displayName: "강보경", englishName: "Sarah", active: false },
];

describe("buildTeacherLabelMap", () => {
  const map = buildTeacherLabelMap(USERS);

  it("영문 닉네임 → 한글 이름", () => {
    expect(map["Hannah"]).toBe("이현이");
    expect(map["Jane"]).toBe("추민아");
    expect(map["Sam"]).toBe("김태건");
  });

  it("퇴사자라도 닉네임이 유일하면 해석한다(옛 시간표도 이름으로 읽히게)", () => {
    expect(map["Sarah"]).toBe("강보경");
  });

  it("한 닉네임을 여러 사람이 쓰면 해석하지 않는다 — 남의 이름을 붙이느니 닉네임 유지", () => {
    expect(map["Zoe"]).toBeUndefined();
  });

  it("닉네임과 이름이 같으면 맵에 넣지 않는다(바꿀 게 없음)", () => {
    expect(map["JJ"]).toBeUndefined();
  });
});

describe("resolveTeacherLabel", () => {
  const map = buildTeacherLabelMap(USERS);

  it("닉네임을 한글 이름으로 바꾼다", () => {
    expect(resolveTeacherLabel("Hannah", map)).toBe("이현이");
    expect(resolveTeacherLabel("Anna", map)).toBe("육소희");
  });

  it("이미 한글 이름이면 그대로", () => {
    expect(resolveTeacherLabel("김태건", map)).toBe("김태건");
    expect(resolveTeacherLabel("부원장", map)).toBe("부원장");
  });

  it("특수 자리 = 방 이름으로. LAB·이주희 → 랩실 / JJ → 집중자율수업실", () => {
    expect(resolveTeacherLabel("이주희", map)).toBe("랩실");
    expect(resolveTeacherLabel("LAB", map)).toBe("랩실");
    expect(resolveTeacherLabel("JJ", map)).toBe("집중자율수업실");
  });

  it("이미 자리 이름이면 그대로(멱등) — 해석된 값이 다시 들어와도 안 흔들린다", () => {
    expect(resolveTeacherLabel("랩실", map)).toBe("랩실");
    expect(resolveTeacherLabel("집중자율수업실", map)).toBe("집중자율수업실");
  });

  it("🔴 자리 고정이 users 해석보다 먼저다 — 이주희의 english_name이 LAB이라 안 그러면 되돌아간다", () => {
    // map에는 LAB→이주희가 들어갈 수 있는 구조라, 우선순위가 뒤집히면 LAB 슬롯이 사람 이름으로 되돌아간다.
    expect(resolveTeacherLabel("LAB", { LAB: "이주희" })).toBe("랩실");
  });

  it("모르는 라벨은 지어내지 않고 원본 유지", () => {
    expect(resolveTeacherLabel("Zoe", map)).toBe("Zoe");
    expect(resolveTeacherLabel("보조T", map)).toBe("보조T");
  });

  it("null/빈 값은 그대로 통과(호출부 폴백 보존)", () => {
    expect(resolveTeacherLabel(null, map)).toBeNull();
    expect(resolveTeacherLabel(undefined, map)).toBeNull();
    expect(resolveTeacherLabel("  ", map)).toBe("  ");
  });

  it("맵이 없어도 자리 고정은 동작한다", () => {
    expect(resolveTeacherLabel("JJ", undefined)).toBe("집중자율수업실");
    expect(resolveTeacherLabel("Hannah", undefined)).toBe("Hannah");
  });
});

describe("isSpecialSlotLabel / specialSlotShortLabel", () => {
  it("원 라벨·해석된 이름 둘 다 자리로 판정(시트 재동기 재배선 차단의 근거)", () => {
    for (const l of ["LAB", "JJ", "이주희", "랩실", "집중자율수업실", "lab"])
      expect(isSpecialSlotLabel(l), l).toBe(true);
  });

  it("사람 이름은 자리가 아니다", () => {
    for (const l of ["Hannah", "이현이", "부원장", null, undefined, ""])
      expect(isSpecialSlotLabel(l), String(l)).toBe(false);
  });

  it("좁은 셀용 짧은 이름 — 집중자율수업실은 '자율실'", () => {
    expect(specialSlotShortLabel("JJ")).toBe("자율실");
    expect(specialSlotShortLabel("이주희")).toBe("랩실");
    expect(specialSlotShortLabel("Hannah")).toBeNull();
  });
});

describe("resolveTeacherLabels", () => {
  const map = buildTeacherLabelMap(USERS);

  it("이주희·LAB은 랩실 한 열로 합쳐지고, JJ는 별도 열(집중자율수업실)이다", () => {
    expect(resolveTeacherLabels(["이주희", "JJ", "LAB", "Hannah"], map)).toEqual([
      "랩실",
      "집중자율수업실",
      "이현이",
    ]);
  });

  it("순서는 처음 등장 순서를 지킨다(열 순서 보존)", () => {
    expect(resolveTeacherLabels(["Sam", "Jane", "Sam"], map)).toEqual(["김태건", "추민아"]);
  });
});
