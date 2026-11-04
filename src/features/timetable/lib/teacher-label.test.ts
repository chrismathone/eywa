import { describe, expect, it } from "vitest";
import { buildTeacherNicknameMap } from "./teacher-label";
import {
  buildTeacherLabelMap,
  canonicalSlotTeacherLabel,
  isSpecialSlotLabel,
  resolveTeacherLabel,
  resolveTeacherLabels,
  resignedTeacherLabels,
  resolveSlotTeacherLabel,
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

describe("저장된 교시 담당자 표시", () => {
  const map = buildTeacherLabelMap(USERS);
  it("라벨 없는 담당자 변경과 오래된 사람 라벨 모두 FK를 따른다", () => {
    expect(resolveSlotTeacherLabel(null, { display_name: "추민아" }, map)).toBe("추민아");
    expect(resolveSlotTeacherLabel("Hannah", [{ display_name: "추민아" }], map)).toBe("추민아");
  });
  it("JJ·LAB 자리는 사람 이름으로 바꾸지 않고, FK 없는 시트 라벨도 유지한다", () => {
    expect(resolveSlotTeacherLabel("JJ", { display_name: "추민아" }, map)).toBe("JJ");
    expect(resolveSlotTeacherLabel("LAB", null, map)).toBe("LAB");
    expect(resolveSlotTeacherLabel("Jane", null, map)).toBe("추민아");
    expect(resolveSlotTeacherLabel(null, null, map)).toBeNull();
  });
});

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

  it("🔴 JJ는 LAB으로 합치지 않는다 — 다른 방(305 vs 603)이고 시간이 겹친다(원장 2026-07-30 'JJ는 그대로')", () => {
    expect(resolveTeacherLabel("이주희", map)).toBe("LAB");
    expect(resolveTeacherLabel("LAB", map)).toBe("LAB");
    expect(resolveTeacherLabel("JJ", map)).toBe("JJ");
  });

  it("옛 방이름 표기(랩실·집중자율수업실)로 저장된 값도 계속 해석된다 + 멱등", () => {
    expect(resolveTeacherLabel("랩실", map)).toBe("LAB");
    expect(resolveTeacherLabel("집중자율수업실", map)).toBe("JJ");
    expect(resolveTeacherLabel("자율실", map)).toBe("JJ");
  });

  it("🔴 자리 고정이 users 해석보다 먼저다 — 이주희의 english_name이 LAB이라 안 그러면 되돌아간다", () => {
    // map에는 LAB→이주희가 들어갈 수 있는 구조라, 우선순위가 뒤집히면 LAB 슬롯이 사람 이름으로 되돌아간다.
    expect(resolveTeacherLabel("LAB", { LAB: "이주희" })).toBe("LAB");
    expect(resolveTeacherLabel("이주희", { 이주희: "이주희" })).toBe("LAB");
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
    expect(resolveTeacherLabel("JJ", undefined)).toBe("JJ");
    expect(resolveTeacherLabel("Hannah", undefined)).toBe("Hannah");
  });
});

describe("isSpecialSlotLabel", () => {
  it("원 라벨·옛 방이름 둘 다 자리로 판정(시트 재동기 재배선 차단의 근거)", () => {
    for (const l of ["LAB", "JJ", "이주희", "랩실", "집중자율수업실", "자율실", "lab", "jj"])
      expect(isSpecialSlotLabel(l), l).toBe(true);
  });

  it("🔴 표기를 JJ로 되돌렸어도 JJ는 여전히 '자리'다 — 사람으로 세면 담임 폴백·직원 목록에 가짜 강사가 부활한다", () => {
    expect(isSpecialSlotLabel("JJ")).toBe(true);
  });

  it("사람 이름은 자리가 아니다", () => {
    for (const l of ["Hannah", "이현이", "부원장", null, undefined, ""])
      expect(isSpecialSlotLabel(l), String(l)).toBe(false);
  });
});

describe("resolveTeacherLabels", () => {
  const map = buildTeacherLabelMap(USERS);

  it("이주희·LAB은 LAB 한 열로 합쳐지고, JJ는 별도 열로 남는다", () => {
    expect(resolveTeacherLabels(["이주희", "JJ", "LAB", "Hannah"], map)).toEqual([
      "LAB",
      "JJ",
      "이현이",
    ]);
  });

  it("순서는 처음 등장 순서를 지킨다(열 순서 보존)", () => {
    expect(resolveTeacherLabels(["Sam", "Jane", "Sam"], map)).toEqual(["김태건", "추민아"]);
  });
});

/**
 * 영어 시간표 `한글이름(영어이름)` 표기의 재료 — **한국인 강사만** 담는다(원장 2026-08-13 "원어민 제외").
 * 판정은 직급 문자열이 아니라 **이름에 한글이 있나**다(직급은 학원설정 운영 enum이라 라벨이 바뀌면 뒤집힌다).
 */
describe("buildTeacherNicknameMap — 한국인 강사만 (원어민 제외)", () => {
  const u = (displayName: string, englishName: string | null, active = true) => ({
    displayName,
    englishName,
    active,
  });

  it("한글 이름 + 닉네임이면 담는다", () => {
    expect(buildTeacherNicknameMap([u("이현이", "Hannah"), u("추민아", "Jane")])).toEqual({
      이현이: "Hannah",
      추민아: "Jane",
    });
  });

  it("🔴 원어민(로마자 이름)은 담지 않는다 — 이름이 곧 영어라 괄호가 중복이다", () => {
    const map = buildTeacherNicknameMap([u("KRISTINE DRIVER", "Kristine"), u("Florence Park", "Florence")]);
    expect(map).toEqual({});
  });

  it("닉네임이 없거나 이름과 같으면 담지 않는다", () => {
    expect(buildTeacherNicknameMap([u("김태건", null), u("이수진", "이수진")])).toEqual({});
  });

  it("동명이인이 서로 다른 닉네임이면 안 담는다 — 남의 닉네임을 붙이느니 이름만", () => {
    const map = buildTeacherNicknameMap([u("김민수", "Kevin"), u("김민수", "Mike")]);
    expect(map).toEqual({});
  });

  it("동명이인이라도 재직자가 하나뿐이면 그 사람으로 정한다", () => {
    const map = buildTeacherNicknameMap([u("김민수", "Kevin", true), u("김민수", "Mike", false)]);
    expect(map).toEqual({ 김민수: "Kevin" });
  });

  it("퇴사자만 있어도 닉네임이 하나면 담는다(옛 시간표도 이름으로 읽히게)", () => {
    expect(buildTeacherNicknameMap([u("박나연", "Zoe", false)])).toEqual({ 박나연: "Zoe" });
  });
});

/**
 * 시트가 사람을 **직책으로 적는 칸**(`부원장`) — 가져오는 순간 닉네임으로 바꾼다
 * (원장 2026-08-29 *"시트를 바꾸라는게 아님. 우리로 가져올때 yoojin 처리하라는것."*).
 */
describe("직책 라벨(부원장) → 닉네임", () => {
  const map = buildTeacherLabelMap([
    ...USERS,
    { displayName: "정유진", englishName: "Yoojin", active: true },
  ]);

  it("저장 라벨은 닉네임으로 굳는다", () => {
    expect(canonicalSlotTeacherLabel("부원장")).toBe("Yoojin");
    expect(canonicalSlotTeacherLabel(" 부원장 ")).toBe("Yoojin");
  });

  it("멱등 — 이미 닉네임이면 그대로", () => {
    expect(canonicalSlotTeacherLabel("Yoojin")).toBe("Yoojin");
    expect(canonicalSlotTeacherLabel(canonicalSlotTeacherLabel("부원장"))).toBe("Yoojin");
  });

  it("자리(LAB·JJ) 판정을 밀어내지 않는다", () => {
    expect(canonicalSlotTeacherLabel("이주희")).toBe("LAB");
    expect(canonicalSlotTeacherLabel("JJ")).toBe("JJ");
  });

  it("표시도 같은 별칭을 타 **한 열로 합쳐진다** — 이미 저장된 옛 라벨과 새 라벨이 같은 이름", () => {
    expect(resolveTeacherLabel("부원장", map)).toBe("정유진");
    expect(resolveTeacherLabel("Yoojin", map)).toBe("정유진");
    expect(resolveTeacherLabels(["부원장", "Yoojin"], map)).toEqual(["정유진"]);
  });

  it("🔴 닉네임이 users에 없으면 원본 유지 — 사람이 못 알아보는 라벨로 바꾸지 않는다", () => {
    const noYoojin = buildTeacherLabelMap(USERS);
    expect(resolveTeacherLabel("부원장", noYoojin)).toBe("부원장");
  });
});

describe("resignedTeacherLabels", () => {
  it("퇴사자의 한글 이름·닉네임을 모은다", () => {
    const s = resignedTeacherLabels([
      { displayName: "정은지", englishName: "Charlie", status: "inactive" },
      { displayName: "추민아", englishName: "Jane", status: "active" },
    ]);
    expect([...s].sort()).toEqual(["Charlie", "정은지"]);
  });
  it("재직자와 같은 표기는 빼지 않는다", () => {
    const s = resignedTeacherLabels([
      { displayName: "김하나", englishName: "Anna", status: "inactive" },
      { displayName: "육소희", englishName: "Anna", status: "active" },
      { displayName: "김하나", englishName: null, status: "pending" },
    ]);
    expect(s.size).toBe(0);
  });
});
