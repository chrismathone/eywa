import { describe, expect, it } from "vitest";
import { personKeys, phoneDigits, samePersonGroups, samePersonOf, type PersonRow } from "./same-person";

const row = (id: string, o: Partial<PersonRow>): PersonRow => ({ id, ...o });
const grouped = (rows: PersonRow[]) => {
  const g = samePersonGroups(rows);
  return (a: string, b: string) => g.get(a) === g.get(b);
};

describe("같은 학생 판정(신규 콜&상담)", () => {
  it("연락처는 숫자만 본다 — 하이픈·띄어쓰기·+82가 달라도 같은 번호", () => {
    expect(phoneDigits("010-1234-5678")).toBe("01012345678");
    expect(phoneDigits("+82 10 1234 5678")).toBe("01012345678");
    expect(phoneDigits("010 1234 5678 (모)")).toBe("01012345678");
  });

  it("해가 바뀌어 학년이 오르거나 학교 표기가 달라도, 이름·연락처가 같으면 같은 학생(2026-10-19 실측 87명)", () => {
    const same = grouped([
      row("a", { prospect_name: "김지우", prospect_school: "칠성초", prospect_grade: "4", parent_phone: "010-1234-5678" }),
      row("b", { prospect_name: "김 지우", prospect_school: "칠성초", prospect_grade: "5", parent_phone: "01012345678" }),
      row("c", { prospect_name: "김지우", prospect_school: "사대부초", parent_phone: "010 1234 5678" }),
    ]);
    expect(same("a", "b")).toBe(true);
    expect(same("a", "c")).toBe(true);
  });

  it("형제자매(연락처가 같고 이름이 다름)는 따로 · 이름만 같은 남남도 따로", () => {
    const same = grouped([
      row("a", { prospect_name: "김지우", parent_phone: "010-1234-5678" }),
      row("b", { prospect_name: "김지민", parent_phone: "010-1234-5678" }),
      row("c", { prospect_name: "김지우", parent_phone: "010-9999-0000" }),
      row("d", { prospect_name: "김지우" }),
    ]);
    expect(same("a", "b")).toBe(false);
    expect(same("a", "c")).toBe(false);
    expect(same("a", "d")).toBe(false);
  });

  it("연락처 열쇠는 휴대폰만 — 학원 대표번호 같은 일반전화로는 같은 이름의 다른 아이를 묶지 않는다", () => {
    const same = grouped([
      row("a", { prospect_name: "김민준", parent_phone: "053-333-0503" }),
      row("b", { prospect_name: "김민준", parent_phone: "0533330503" }),
    ]);
    expect(same("a", "b")).toBe(false);
  });

  it("학교·학년이 둘 다 없고 연락처도 없으면 열쇠가 없다 — '영어문의' 같은 접수 표기가 한 사람으로 묶이지 않는다", () => {
    expect(personKeys(row("a", { prospect_name: "영어문의" }))).toEqual([]);
    const same = grouped([row("a", { prospect_name: "영어문의" }), row("b", { prospect_name: "영어문의" })]);
    expect(same("a", "b")).toBe(false);
    expect(personKeys(row("x", { prospect_name: "김지우", parent_phone: "5678" }))).toEqual([]);
  });

  it("열쇠가 이어지면 한 묶음 — 원생 연결 ↔ 이름+연락처 ↔ 이름+학교+학년", () => {
    const rows = [
      row("linked", { student_id: "s1", prospect_name: "박서연", parent_phone: "010-2222-3333" }),
      row("phone", { prospect_name: "박서연", parent_phone: "01022223333", prospect_school: "경명여중", prospect_grade: "1" }),
      row("natural", { prospect_name: "박서연", prospect_school: "경명여중", prospect_grade: "1" }),
      row("other", { prospect_name: "박서연", prospect_school: "경명여중", prospect_grade: "2" }),
    ];
    const same = grouped(rows);
    expect(same("linked", "natural")).toBe(true);
    expect(same("linked", "other")).toBe(false);
    expect(samePersonOf(rows[2]!, rows).map((r) => r.id)).toEqual(["linked", "phone"]);
  });

  it("🔴 이름·학교·학년이 같아도 보호자 휴대폰이 서로 다르면 다른 아이 — #132 김근우", () => {
    const same = grouped([
      row("c1", { student_id: "s1", prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1", parent_phone: "010-1111-2222" }),
      row("c2", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1", parent_phone: "010-3333-4444" }),
      row("c3", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1" }),
    ]);
    expect(same("c1", "c2")).toBe(false);
    // 연락처를 안 적은 접수는 어느 아이 것인지 모른다 — 어느 쪽에도 붙이지 않는다(행 순서를 바꿔도 같다).
    expect(same("c1", "c3")).toBe(false);
    expect(same("c2", "c3")).toBe(false);
    const rows = [
      row("c1", { student_id: "s1", prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1", parent_phone: "010-1111-2222" }),
      row("c2", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1", parent_phone: "010-3333-4444" }),
      row("c3", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1" }),
    ];
    // 상세 두 곳(각자 자기가 맨 앞)이 같은 상담을 서로 제 것이라 하지 않는다.
    expect(samePersonOf(rows[0]!, rows)).toEqual([]);
    expect(samePersonOf(rows[1]!, [...rows].reverse())).toEqual([]);
    expect(samePersonOf(rows[2]!, rows)).toEqual([]);
  });

  it("후보가 한 아이뿐이면 연락처 없는 접수도 그 아이에게 붙는다", () => {
    const same = grouped([
      row("c3", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1" }),
      row("c1", { student_id: "s1", prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1", parent_phone: "010-1111-2222" }),
      row("c4", { prospect_name: "김근우", prospect_school: "대구일중", prospect_grade: "1" }),
    ]);
    expect(same("c1", "c3")).toBe(true);
    expect(same("c1", "c4")).toBe(true);
  });

  it("🔴 서로 다른 원생에 연결된 상담은 어떤 열쇠로도 잇지 않는다 · 같은 원생 연결은 연락처가 달라도 잇는다", () => {
    const same = grouped([
      row("a", { student_id: "s1", prospect_name: "이서준", prospect_school: "칠성초", prospect_grade: "5", parent_phone: "010-1234-5678" }),
      row("b", { student_id: "s2", prospect_name: "이서준", prospect_school: "칠성초", prospect_grade: "5", parent_phone: "010-1234-5678" }),
      row("c", { student_id: "s1", prospect_name: "이서준A", parent_phone: "010-9999-8888" }),
    ]);
    expect(same("a", "b")).toBe(false);
    expect(same("a", "c")).toBe(true);
  });

  it("묶음이 다른 원생과 이어졌으면 그 묶음엔 들어가지 않고 맞는 쪽으로 — 행 순서와 무관", () => {
    const rows = [
      row("x1", { student_id: "s1", prospect_name: "최유진", prospect_school: "경명여중", prospect_grade: "2", parent_phone: "010-1000-2000" }),
      row("x2", { student_id: "s2", prospect_name: "최유진", prospect_school: "경명여중", prospect_grade: "2", parent_phone: "010-3000-4000" }),
      row("new", { prospect_name: "최유진", prospect_school: "경명여중", prospect_grade: "2", parent_phone: "01030004000" }),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const same = grouped(order);
      expect(same("new", "x2")).toBe(true);
      expect(same("new", "x1")).toBe(false);
    }
  });

  it("같은 숫자만 늘어놓은 자리 채움 번호는 열쇠가 아니다", () => {
    expect(personKeys(row("a", { prospect_name: "김지우", parent_phone: "010-0000-0000" }))).toEqual([]);
    expect(personKeys(row("a", { prospect_name: "김지우", parent_phone: "010-1111-1111" }))).toEqual([]);
  });

  it("아직 저장 안 한 새 상담(id 없음)도 같은 규칙으로 찾는다", () => {
    const self = row("", { prospect_name: "김지우", parent_phone: "010-1234-5678" });
    const found = samePersonOf(self, [
      row("old", { prospect_name: "김지우", prospect_school: "칠성초", prospect_grade: "4", parent_phone: "010-1234-5678" }),
      row("sib", { prospect_name: "김지민", parent_phone: "010-1234-5678" }),
    ]);
    expect(found.map((r) => r.id)).toEqual(["old"]);
  });
});
