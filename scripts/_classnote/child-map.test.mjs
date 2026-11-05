import { describe, expect, it } from "vitest";
import { phoneKey, planChildMap, resolveChildStudent } from "./child-map.mjs";

const YEAR = 2026; // 2026학년도 — 초6 = 2014년생

const students = [
  { id: "s-min", name: "김민준", grade: "초6", phones: ["010-1111-2222"] },
  { id: "s-seo", name: "김서연", grade: "중2", phones: ["010-1111-2222"] }, // 위와 같은 집(형제)
  { id: "s-solo", name: "박지호", grade: "고1", phones: ["010-3333-4444"] },
  { id: "s-nophone", name: "최특이", grade: "중1", phones: [] },
  { id: "s-dupA", name: "이서준", grade: "초3", phones: [] },
  { id: "s-dupB", name: "이서준C", grade: "중3", phones: [] },
];

describe("phoneKey", () => {
  it("표기가 달라도 같은 번호로 접는다", () => {
    expect(phoneKey("010-1111-2222")).toBe(phoneKey("01011112222"));
    expect(phoneKey("+82-10-1111-2222")).toBe("01011112222");
  });
  it("비교 불가한 값은 빈 문자열(대조에서 빠진다)", () => {
    for (const v of ["", null, undefined, "1234", "번호없음"]) expect(phoneKey(v)).toBe("");
  });
});

describe("resolveChildStudent — 3겹 확정", () => {
  it("전화가 한 명만 가리키면 그대로 확정", () => {
    const r = resolveChildStudent({ childId: 1, name: "박지호", phones: ["01033334444"] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-solo", by: "phone" });
  });

  it("형제가 번호를 공유하면 이름으로 가른다", () => {
    const r = resolveChildStudent({ childId: 2, name: "김서연", phones: ["01011112222"] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-seo", by: "phone+name" });
  });

  it("전화가 맞아도 이름이 아무와도 안 맞으면 확정하지 않는다", () => {
    const r = resolveChildStudent({ childId: 3, name: "전혀다른아이", phones: ["01011112222"] }, students, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
    expect(r.why).toContain("사람이 확인");
  });

  it("전화가 없어도 이름이 유일하면 확정", () => {
    const r = resolveChildStudent({ childId: 4, name: "최특이", phones: [] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-nophone", by: "name" });
  });

  // 🔴 접미사(A~G)는 같은 이름의 다른 사람이다 — 이름만으로 붙이면 남의 집 연락이 간다.
  it("접미사 형제(이서준·이서준C)는 이름만으로 확정하지 않고 생년으로 가른다", () => {
    const noBirth = resolveChildStudent({ childId: 5, name: "이서준", phones: [] }, students, { schoolYear: YEAR });
    expect(noBirth.studentId).toBeNull();
    // 2026학년도 기준 초3 = 2017년생(중3은 2011년생) → 생년이 초3 쪽만 가리킨다.
    const withBirth = resolveChildStudent({ childId: 5, name: "이서준", birth: "2017-05-02", phones: [] }, students, {
      schoolYear: YEAR,
    });
    expect(withBirth).toEqual({ studentId: "s-dupA", by: "name+birth" });
  });

  it("생년이 어느 학년과도 안 맞으면 확정하지 않는다", () => {
    const r = resolveChildStudent({ childId: 6, name: "이서준", birth: "1999-01-01", phones: [] }, students, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
  });
});

// 🔴 원장 2026-11-05 *"형제 원아 연결이 뒤바뀐건 크리티컬함. 아주 섬세한 가드로 매칭해야함"* — 전화 후보가 한 명이어도 이름을 본다.
describe("resolveChildStudent — 형제 원아 가드(2026-11-05)", () => {
  it("🔴 전화 후보가 한 명이어도 원아 이름이 그 학생과 안 이어지면 붙이지 않는다(실측: 명부 '한도현' → 같은 번호 유일 학생 '한민호')", () => {
    const r = resolveChildStudent({ childId: 30, name: "한도현", phones: ["01055556666"] }, [{ id: "s-minho", name: "한민호", grade: "초6", phones: ["010-5555-6666"] }], { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
    expect(r.why).toContain("형제 계정");
  });
  it("이름만 적은 계정(`지호` ⊂ `박지호`)은 포함 관계로 인정한다", () => {
    const r = resolveChildStudent({ childId: 31, name: "지호", phones: ["01033334444"] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-solo", by: "phone" });
  });
  it("🔴 전화 후보는 한 명이지만 그 학생의 다른 번호로 이어진 형제와 이름이 정확히 같으면 붙이지 않는다(`김하`·`김하늘`)", () => {
    const fam = [
      { id: "s-ha", name: "김하", grade: "초3", phones: ["010-7777-0001", "010-7777-0002"] },
      { id: "s-haneul", name: "김하늘", grade: "초5", phones: ["010-7777-0002"] },
    ];
    // 원아 보호자 전화 0001은 김하만 가진 번호 — 원아 '김하늘'은 김하와 포함 관계일 뿐, 같은 집 김하늘과 정확히 같다
    const r = resolveChildStudent({ childId: 32, name: "김하늘", phones: ["01077770001"] }, fam, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
    expect(r.why).toContain("같은 집 다른 아이");
  });
  it("같은 아이의 중복 기록(퇴원 기록 + 재원 기록)은 형제로 보지 않는다", () => {
    const dup = [
      { id: "s-old", name: "이재윤", grade: "중1", phones: ["010-8888-0001"] },
      { id: "s-now", name: "이재윤", grade: "중1", phones: ["010-8888-0001"] },
    ];
    // 전화·이름으로 두 기록이 다 맞는다 — 종전처럼 확정하지 않는다(사람 몫) · 형제 사유로 바뀌지 않는다
    const r = resolveChildStudent({ childId: 33, name: "이재윤", phones: ["01088880001"] }, dup, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
    expect(r.why).toContain("전화후보 2명");
  });
});

describe("planChildMap — 멱등·다계정", () => {
  it("이미 링크된 원아는 계획에 넣지 않는다", () => {
    const { plan } = planChildMap([{ childId: 1, name: "박지호", phones: ["01033334444"] }], students, {
      schoolYear: YEAR,
      linkedChildIds: [1],
    });
    expect(plan).toEqual([]);
  });

  // 🔴 실데이터에서 16쌍 32명이 이 모양이었다(수학·영어 따로 가입). 한쪽만 붙이면 나머지 계정으로 들어온
  //    연락이 학생을 못 찾아 그 아이가 출결 명단에서 통째로 빠진다.
  it("같은 아이의 계정이 여럿이면 **전부** 같은 학생에 붙인다", () => {
    const { plan, skipped } = planChildMap(
      [
        { childId: 10, name: "박지호", phones: ["01033334444"] },
        { childId: 11, name: "박지호", phones: ["01033334444"] },
      ],
      students,
      { schoolYear: YEAR },
    );
    expect(plan).toEqual([
      { childId: 10, studentId: "s-solo", by: "phone" },
      { childId: 11, studentId: "s-solo", by: "phone" },
    ]);
    expect(skipped).toEqual([]);
  });

  it("이름 표기가 달라도(영어 별칭) 전화가 같으면 같은 학생에 붙는다", () => {
    const { plan } = planChildMap([{ childId: 13, name: "Jay(박지호)", phones: ["01033334444"] }], students, {
      schoolYear: YEAR,
    });
    expect(plan).toEqual([{ childId: 13, studentId: "s-solo", by: "phone" }]);
  });

  it("확정된 것만 계획에 담는다", () => {
    const { plan, skipped } = planChildMap(
      [
        { childId: 20, name: "김민준", phones: ["01011112222"] },
        { childId: 21, name: "알수없는아이", phones: [] },
      ],
      students,
      { schoolYear: YEAR },
    );
    expect(plan).toEqual([{ childId: 20, studentId: "s-min", by: "phone+name" }]);
    expect(skipped).toHaveLength(1);
  });
});

describe("🔴 형제가 aywa에 서로 다른 번호로 적힌 경우(적대적 리뷰 2026-11-05 반례 김하·김하늘)", () => {
  const MOM = "010-1111-2222";
  const DAD = "010-3333-4444";
  const sibs = [
    { id: "ha", name: "김하", grade: "초4", phones: [MOM] },
    { id: "haneul", name: "김하늘", grade: "초3", phones: [DAD] },
  ];
  it("원아 '김하늘'(엄마 번호)을 전화 후보 하나뿐인 김하에게 붙이지 않는다 — 지점에 이름이 똑같은 김하늘이 있다", () => {
    const r = resolveChildStudent({ childId: 77, name: "김하늘", birth: "2017-04-01", phones: [MOM] }, sibs, { schoolYear: 2026 });
    expect(r.studentId).toBeNull();
  });
  it("반대 방향 — 원아 '김하'(아빠 번호)를 김하늘에게 붙이지 않는다", () => {
    const r = resolveChildStudent({ childId: 78, name: "김하", birth: "2016-04-01", phones: [DAD] }, sibs, { schoolYear: 2026 });
    expect(r.studentId).toBeNull();
  });
  it("이름이 정확히 같으면 그대로 붙는다(지점 전체 확인은 포함 관계·다른 학생 이름에만)", () => {
    const r = resolveChildStudent({ childId: 79, name: "김하늘", birth: "2017-04-01", phones: [DAD] }, sibs, { schoolYear: 2026 });
    expect(r.studentId).toBe("haneul");
  });
  // 재리뷰 2026-11-05 반례 — 원아 이름이 형제 이름을 **담고** 있으면(정확히 같지 않아도) 포함 관계로만 이어진 김하에게 붙이지 않는다.
  for (const nm of ["김하늘이", "김하늘(둘째)", "Sky(김하늘)"]) {
    it(`원아 '${nm}'(엄마 번호)을 김하에게 붙이지 않는다 · 미확정 사유는 '다른 학생 이름'`, () => {
      const r = resolveChildStudent({ childId: 80, name: nm, birth: "2017-04-01", phones: [MOM] }, sibs, { schoolYear: 2026 });
      expect(r.studentId).toBeNull();
      expect(r.why).toContain("다른 학생 이름과 똑같거나 그 이름을 담고 있음");
    });
  }
  it("그 원아의 주인(김하늘 · 아빠 번호)에게는 그대로 붙는다", () => {
    const r = resolveChildStudent({ childId: 81, name: "김하늘이", birth: "2017-04-01", phones: [DAD] }, sibs, { schoolYear: 2026 });
    expect(r).toEqual({ studentId: "haneul", by: "phone" });
  });
});
