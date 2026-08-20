import { describe, expect, it } from "vitest";
import { groupSameNameStudents, sameNameKey, type SameNameInput } from "./same-name";

function student(over: Partial<SameNameInput> & { id: string; name: string }): SameNameInput {
  return { grade: null, school: null, parentPhone: null, ...over };
}

describe("sameNameKey — 화면에서 똑같이 보이는 이름은 같은 키", () => {
  it("앞뒤·중간 공백을 접는다", () => {
    expect(sameNameKey(" 이지호 ")).toBe(sameNameKey("이지호"));
    expect(sameNameKey("김  수아")).toBe(sameNameKey("김 수아"));
  });
  it("대소문자는 무시한다(기존 중복 의심 판정과 같은 규약)", () => {
    expect(sameNameKey("Florence")).toBe(sameNameKey("florence"));
  });
  it("🔴 접미사는 벗기지 않는다 — 이미 구분해 둔 이름을 다시 묶으면 영구 노이즈", () => {
    expect(sameNameKey("이지호A")).not.toBe(sameNameKey("이지호"));
    expect(sameNameKey("이지호A")).not.toBe(sameNameKey("이지호B"));
  });
});

describe("groupSameNameStudents — 학교·학년이 달라도 같은 이름이면 잡는다", () => {
  it("원장이 만난 그 상황: 같은 이름 · 다른 학교 · 다른 학년", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "이지호A", school: "옥산초", grade: "초4" }),
      student({ id: "b", name: "이지호A", school: "달성초", grade: "초1" }),
      student({ id: "c", name: "박서준", school: "달성초", grade: "초1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("이지호A");
    expect(groups[0]!.students.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("혼자면 그룹이 아니다 — 평소엔 0건이어야 한다", () => {
    expect(groupSameNameStudents([student({ id: "a", name: "이지호" })])).toEqual([]);
  });

  it("이름이 다르면 안 묶는다(접미사로 이미 구분한 두 사람)", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "이지호A" }),
      student({ id: "b", name: "이지호B" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("이름 칸의 공백 차이만 있는 두 행은 잡는다(화면에선 구분이 안 된다)", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "김수아", school: "수창초", grade: "초6" }),
      student({ id: "b", name: "김수아 ", school: "산격중", grade: "중1" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("🔴 이름+학년+학교가 같으면 여기서 뺀다 — 그건 통합 섹션의 몫", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "김수아", school: "수창초", grade: "초6" }),
      student({ id: "b", name: "김수아", school: "수창초", grade: "초6" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("🔴 이름+학년이 같고 학부모 연락처가 같아도 뺀다(표기가 달라도 숫자만 비교)", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "김수아", grade: "초6", school: "수창초", parentPhone: "010-1234-5678" }),
      student({ id: "b", name: "김수아", grade: "초6", school: "", parentPhone: "01012345678" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("연락처가 둘 다 비어 있으면 '같은 연락처'가 아니다 — 학교가 다르면 동명이인으로 남는다", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "김수아", grade: "초6", school: "수창초", parentPhone: null }),
      student({ id: "b", name: "김수아", grade: "초6", school: "산격초", parentPhone: "" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("⚠️ 공백 차이로 중복 의심이 **못 잡는** 쌍은 여기서 사라지면 안 된다(양쪽 실종 방지)", () => {
    // 중복 의심은 이름을 trim+소문자로만 보므로 `김  수아`(두 칸)와 `김 수아`는 **서로 다른 이름**이라
    // 안 잡힌다. 이쪽 정규화(공백 접기)로 "이미 잡혔다"고 판단하면 두 섹션 어디에도 안 남는다.
    const groups = groupSameNameStudents([
      student({ id: "a", name: "김  수아", grade: "초6", school: "수창초" }),
      student({ id: "b", name: "김 수아", grade: "초6", school: "수창초" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("공백 개수만 다른 이름은 같은 이름으로 본다(화면에서 구분이 안 된다)", () => {
    expect(sameNameKey("김  수아")).toBe(sameNameKey("김 수아"));
    // 반대로 **공백 유무**는 눈에 보이므로 다른 이름으로 둔다 — 여기서 더 지우면 접미사까지 위험해진다.
    expect(sameNameKey("김 수아")).not.toBe(sameNameKey("김수아"));
  });

  it("셋 중 한 쌍만 통합 대상이어도 그룹 전체를 뺀다 — 두 섹션이 같은 쌍을 두고 다투지 않는다", () => {
    const groups = groupSameNameStudents([
      student({ id: "a", name: "이지호", grade: "초4", school: "옥산초" }),
      student({ id: "b", name: "이지호", grade: "초4", school: "옥산초" }),
      student({ id: "c", name: "이지호", grade: "초1", school: "달성초" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("순서는 이름→id로 고정 — 조회 순서가 흔들려도 화면이 들썩이지 않는다", () => {
    const rows = [
      student({ id: "b2", name: "이지호", school: "달성초" }),
      student({ id: "a1", name: "이지호", school: "옥산초" }),
      student({ id: "z9", name: "강민수", school: "수창초" }),
      student({ id: "z1", name: "강민수", school: "산격중" }),
    ];
    const groups = groupSameNameStudents(rows);
    expect(groups.map((g) => g.name)).toEqual(["강민수", "이지호"]);
    expect(groups[1]!.students.map((s) => s.id)).toEqual(["a1", "b2"]);
    expect(groupSameNameStudents([...rows].reverse())).toEqual(groups);
  });

  it("이름이 공백뿐인 행은 판정 대상이 아니다", () => {
    expect(
      groupSameNameStudents([student({ id: "a", name: "  " }), student({ id: "b", name: " " })]),
    ).toEqual([]);
  });
});
