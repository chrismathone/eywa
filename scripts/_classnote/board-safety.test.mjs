import { describe, it, expect } from "vitest";
import {
  acceptBoardMembers,
  boardNameAmbiguity,
  evaluateBoardMapping,
  evaluateBoardSafety,
  expectedBirthYear,
  kstSchoolYear,
  normBoard,
} from "./board-safety.mjs";

// 실측 보드 모양(2026-07-15). children(연결 계정 수)은 이제 판정에 안 쓴다 — 매핑 검증으로 대체됐다.
const boards = [
  { id: 1, name: "(수학)박서준", children: 1 }, // eywa 박서준(초6) + 박서준C(중3) 존재 = 모호
  { id: 2, name: "(수학)안은지", children: 2 }, // 같은 학생 다계정(영어·수학 따로 가입 등) = 비모호
  { id: 4, name: "(수학)강민준", children: 1 },
  { id: 5, name: "(수학)김공유", children: 0 },
  { id: 6, name: "(수학)쌍둥이", children: 1 },
  { id: 7, name: "(수학)쌍둥이", children: 1 }, // 중복 보드명
];
const SY = 2026; // 2026학년도

describe("normBoard", () => {
  it("공백 전부 제거", () => {
    expect(normBoard("(수학) 안 은지")).toBe("(수학)안은지");
    expect(normBoard(null)).toBe("");
  });
});

describe("expectedBirthYear — 학년 → 출생연도 역산", () => {
  it("2026학년도 기준 실측값과 일치", () => {
    expect(expectedBirthYear("초6", SY)).toBe(2014); // 실측: (수학)박서준 원아 2014-09-24
    expect(expectedBirthYear("중3", SY)).toBe(2011); // 실측: 박서준C = 중3
    expect(expectedBirthYear("고1", SY)).toBe(2010);
    expect(expectedBirthYear("고3", SY)).toBe(2008);
    expect(expectedBirthYear("초1", SY)).toBe(2019);
  });
  it("모르는 학년·학년도는 null(대조 불가 → 호출부가 보류)", () => {
    expect(expectedBirthYear("N수", SY)).toBeNull();
    expect(expectedBirthYear(null, SY)).toBeNull();
    expect(expectedBirthYear("초6", null)).toBeNull();
  });
});

describe("kstSchoolYear — 3월 시작", () => {
  it("3월~12월은 그 해, 1~2월은 전 해", () => {
    expect(kstSchoolYear(new Date("2026-07-15T00:00:00Z"))).toBe(2026);
    expect(kstSchoolYear(new Date("2026-03-01T00:00:00Z"))).toBe(2026);
    expect(kstSchoolYear(new Date("2027-01-15T00:00:00Z"))).toBe(2026); // 아직 2026학년도
    expect(kstSchoolYear(new Date("2027-03-02T00:00:00Z"))).toBe(2027);
  });
  it("KST 기준 — UTC로 2월 28일 늦은 밤이면 KST는 3월 1일", () => {
    expect(kstSchoolYear(new Date("2027-02-28T15:30:00Z"))).toBe(2027); // KST 3/1 00:30
  });
});

describe("boardNameAmbiguity — 이 보드명이 여러 학생을 가리키나", () => {
  const names = ["박서준", "박서준B", "박서준C", "김채은", "김채은", "이윤", "이윤건", "이윤슬", "안은지", "이시우"];

  it("⭐ `이름+알파벳 한 글자` 형제가 있으면 모호 — 학부모는 가입 시 알파벳을 안 붙인다(박서준 사고 경로)", () => {
    const a = boardNameAmbiguity("박서준", names);
    expect(a.ambiguous).toBe(true);
    expect(a.siblings.sort()).toEqual(["박서준B", "박서준C"]);
  });

  it("⭐ 같은 이름이 2명+ 이면 모호 — **퇴원생을 포함한 우주**를 넘겨야 잡힌다(김채은 실사례)", () => {
    const a = boardNameAmbiguity("김채은", names);
    expect(a.ambiguous).toBe(true);
    expect(a.sameName).toBe(2);
  });

  it("⭐ 여러 글자 차이는 **다른 이름**이라 모호하지 않다 — 이윤 vs 이윤건(학부모는 '이윤건'으로 가입)", () => {
    const a = boardNameAmbiguity("이윤", names);
    expect(a.ambiguous).toBe(false);
    expect(a.siblings).toEqual([]);
  });

  it("형제도 동명도 없으면 비모호 — 검증 자체를 건너뛴다(오탐 0의 근거)", () => {
    expect(boardNameAmbiguity("안은지", names).ambiguous).toBe(false);
    expect(boardNameAmbiguity("이시우", names).ambiguous).toBe(false);
  });

  it("공백 차이는 같은 이름으로 본다", () => {
    expect(boardNameAmbiguity("박 서준", names).ambiguous).toBe(true);
  });

  it("빈 이름·빈 우주에 안전", () => {
    expect(boardNameAmbiguity("", names).ambiguous).toBe(false);
    expect(boardNameAmbiguity("이시우", []).ambiguous).toBe(false);
    expect(boardNameAmbiguity("이시우", undefined).ambiguous).toBe(false);
  });
});

describe("evaluateBoardMapping — 원아 생일 ↔ eywa 학년", () => {
  it("⭐ 실측 재현: (수학)박서준 초6 + 원아 2014-09-24 → 통과", () => {
    const v = evaluateBoardMapping({ grade: "초6", children: [{ name: "박서준", date_birth: "2014-09-24" }], schoolYear: SY });
    expect(v.ok).toBe(true);
  });

  it("⭐ 실측 재현: (수학)김서윤 고2인데 원아가 2013생(중1) → 차단", () => {
    // 퇴원한 중1 김서윤 가족이 보드에 남아 있던 실제 상황. 고2=2009생이어야 하는데 2013생.
    const v = evaluateBoardMapping({ grade: "고2", children: [{ name: "김서윤", date_birth: "2013-08-21" }], schoolYear: SY });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("grade_mismatch");
    expect(v.reason).toMatch(/2013/);
  });

  it("±1년은 허용 — 조기입학·유급·학부모 생일 오입력(실측: 자기 생일을 1년 틀리게 넣은 사례)", () => {
    expect(evaluateBoardMapping({ grade: "고1", children: [{ date_birth: "2011-12-20" }], schoolYear: SY }).ok).toBe(true);
    expect(evaluateBoardMapping({ grade: "고1", children: [{ date_birth: "2009-01-02" }], schoolYear: SY }).ok).toBe(true);
  });

  it("2년 차이는 차단 — 초6 vs 중2는 다른 사람", () => {
    expect(evaluateBoardMapping({ grade: "초6", children: [{ date_birth: "2012-03-03" }], schoolYear: SY }).code).toBe(
      "grade_mismatch",
    );
  });

  it("계정이 여러 개면 **하나라도 안 맞으면** 차단 — 같은 학생 다계정은 전부 맞는다", () => {
    const same = [{ name: "이재용", date_birth: "2014-10-19" }, { name: "Lincoln", date_birth: "2014-10-19" }];
    expect(evaluateBoardMapping({ grade: "초6", children: same, schoolYear: SY }).ok).toBe(true);
    const mixed = [{ name: "박서준", date_birth: "2014-09-24" }, { name: "박서준", date_birth: "2011-09-19" }];
    expect(evaluateBoardMapping({ grade: "초6", children: mixed, schoolYear: SY }).code).toBe("grade_mismatch");
  });

  it("원아 생일이 없으면 차단 — 모호한 이름인데 확인할 수단이 없다(fail-closed)", () => {
    expect(evaluateBoardMapping({ grade: "초6", children: [{ name: "박서준" }], schoolYear: SY }).code).toBe(
      "mapping_unknown",
    );
  });

  it("eywa 학년이 없으면 차단 — 대조 기준이 없다", () => {
    expect(evaluateBoardMapping({ grade: null, children: [{ date_birth: "2014-01-01" }], schoolYear: SY }).code).toBe(
      "mapping_unknown",
    );
  });

  it("아무도 안 붙은 보드는 통과 — 오발송 대상이 없다", () => {
    expect(evaluateBoardMapping({ grade: "초6", children: [], schoolYear: SY }).ok).toBe(true);
  });
});

describe("evaluateBoardSafety", () => {
  it("보드 있고 비모호(mapping=null) → 통과 — **계정 수는 안 본다**", () => {
    // (수학)안은지는 계정 2개지만 같은 학생의 다계정이라 통과해야 한다(옛 계정 수 게이트의 오탐).
    const v = evaluateBoardSafety({ className: "(수학)안은지", boards });
    expect(v.ok).toBe(true);
    expect(v.boardId).toBe(2);
  });

  it("보드 없음 → 차단(no_board)", () => {
    expect(evaluateBoardSafety({ className: "(수학)없는애", boards }).code).toBe("no_board");
  });

  it("중복 보드명 → 차단(dup_board)", () => {
    expect(evaluateBoardSafety({ className: "(수학)쌍둥이", boards }).code).toBe("dup_board");
  });

  it("빈 className → 차단(no_class)", () => {
    expect(evaluateBoardSafety({ className: "", boards }).code).toBe("no_class");
  });

  it("⭐ 모호한 보드 + 매핑 불일치 → 차단", () => {
    const v = evaluateBoardSafety({
      className: "(수학)박서준",
      boards,
      mapping: { grade: "초6", children: [{ name: "박서준", date_birth: "2011-09-19" }], schoolYear: SY },
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("grade_mismatch");
    expect(v.boardId).toBe(1);
  });

  it("⭐ 모호한 보드 + 매핑 일치 → 통과", () => {
    const v = evaluateBoardSafety({
      className: "(수학)박서준",
      boards,
      mapping: { grade: "초6", children: [{ name: "박서준", date_birth: "2014-09-24" }], schoolYear: SY },
    });
    expect(v.ok).toBe(true);
  });

  it("⭐ 예외 등재 = 사람 탈출구 — 매핑이 안 맞아도 통과(확인해도 못 푸는 막다른 길 방지)", () => {
    const v = evaluateBoardSafety({
      className: "(수학)박서준",
      boards,
      allowlist: ["(수학)박서준"],
      mapping: { grade: "초6", children: [{ date_birth: "2011-09-19" }], schoolYear: SY },
    });
    expect(v.ok).toBe(true);
  });

  it("옛 `보드명|N` 입력이 남아 있어도 이름만 보고 동작(하위호환) — 계정 수 개념은 폐기됐다", () => {
    const v = evaluateBoardSafety({
      className: "(수학)박서준",
      boards,
      allowlist: [" (수학) 박서준 | 3 "],
      mapping: { grade: "초6", children: [{ date_birth: "2011-09-19" }], schoolYear: SY },
    });
    expect(v.ok).toBe(true);
  });

  it("보드 없음이 예외 등재보다 우선 — 없는 보드엔 못 보낸다", () => {
    expect(evaluateBoardSafety({ className: "(수학)없는애", boards, allowlist: ["(수학)없는애"] }).code).toBe("no_board");
  });
});

// ── 보드가 곧 매핑 — 이름이 달라도 그 보드의 원아가 이 학생이다(원장 2026-07-23) ────────────────
describe("acceptBoardMembers — 이름 매칭이 실패했을 때의 폴백", () => {
  const SY = 2026;

  it("실사례: 보드 `(수학)박서연E`의 원아가 «서연»이어도 생년이 맞으면 인정한다", () => {
    const v = acceptBoardMembers({
      members: [{ id: 5226347, name: "서연", date_birth: "2015-03-18" }],
      grade: "초5",
      schoolYear: SY,
    });
    expect(v.ok).toBe(true);
    expect(v.members).toHaveLength(1);
  });

  it("원아가 없으면 거부 — 이건 진짜 미배정이라 사실대로 말한다", () => {
    const v = acceptBoardMembers({ members: [], grade: "초5", schoolYear: SY });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("no_member");
    expect(v.reason).toContain("원아가 없습니다");
  });

  it("🔴 생년이 학년과 3년 어긋나면 거부 — 이름 검사를 뺀 자리를 생년이 지킨다(박서준 사고 경로)", () => {
    const v = acceptBoardMembers({
      members: [{ name: "박서준", date_birth: "2008-05-01" }],
      grade: "초6",
      schoolYear: SY,
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("grade_mismatch");
  });

  it("🔴 원아 생년이 없으면 거부 — 확인할 수 없으면 안 보낸다(모르면 거부)", () => {
    const v = acceptBoardMembers({ members: [{ name: "서연", date_birth: null }], grade: "초5", schoolYear: SY });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("mapping_unknown");
  });

  it("🔴 eywa 학년이 없어도 거부 — 대조 기준이 없으면 통과시키지 않는다", () => {
    const v = acceptBoardMembers({ members: [{ name: "서연", date_birth: "2015-03-18" }], grade: null, schoolYear: SY });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("mapping_unknown");
  });

  it("±1년(조기입학·유급·학부모 오입력)은 흡수", () => {
    expect(acceptBoardMembers({ members: [{ name: "서연", date_birth: "2014-11-02" }], grade: "초5", schoolYear: SY }).ok).toBe(true);
  });

  it("여러 원아(부모·본인 이중 계정) 중 **한 명이라도** 생년이 어긋나면 전원 거부 — 한 집만 아니어도 오발송이다", () => {
    const v = acceptBoardMembers({
      members: [
        { name: "서연", date_birth: "2015-03-18" },
        { name: "박서연", date_birth: "2011-01-05" },
      ],
      grade: "초5",
      schoolYear: SY,
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("grade_mismatch");
  });
});
