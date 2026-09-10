import { describe, expect, it } from "vitest";
import { compareSeatClassRef, sortSeatRowsByClass } from "./seat-day-order";

type Row = { classId: string; className: string; name: string };

const row = (name: string, classId: string, className: string): Row => ({ name, classId, className });
const self = (r: Row) => r;
const names = (rows: Row[]) => rows.map((r) => r.name);

describe("seat-day-order — 같은 반끼리 붙여 세운다", () => {
  // 원장 2026-09-10 제보 그대로의 화면(2026-09-10 16:20 타임) — 가나다뿐이라 반이 뒤섞였다.
  it("가나다로 섞인 합명단을 반별로 묶는다", () => {
    const mixed = [
      row("김근호", "c-med", "중등E_중1 MED"),
      row("김세영", "c-med", "중등E_중1 MED"),
      row("류지훈", "c-sky", "초등E_초6 SKY"),
      row("류혜정", "c-med", "중등E_중1 MED"),
      row("박서연D", "c-reg", "중등E_중2 정규 A"),
    ];
    expect(names(sortSeatRowsByClass(mixed, self))).toEqual([
      // 중등E_중1 MED < 중등E_중2 정규 A < 초등E_초6 SKY (ko 가나다)
      "김근호",
      "김세영",
      "류혜정",
      "박서연D",
      "류지훈",
    ]);
  });

  it("반 안에서는 넘어온 순서(가나다)를 그대로 지킨다 — 안정 정렬", () => {
    const rows = [
      row("가나", "c2", "중등E_중2 정규 A"),
      row("다라", "c1", "중등E_중1 MED"),
      row("마바", "c2", "중등E_중2 정규 A"),
      row("사아", "c1", "중등E_중1 MED"),
    ];
    expect(names(sortSeatRowsByClass(rows, self))).toEqual(["다라", "사아", "가나", "마바"]);
  });

  it("반 안의 순서가 가나다가 아니어도(퇴원=최신순) 그대로 이어진다", () => {
    // 퇴원 섹션은 `groupRosterRows`가 최신 종료일 먼저로 정렬해 넘긴다.
    const rows = [
      row("늦게나감", "c1", "중등E_중1 MED"),
      row("먼저나감", "c1", "중등E_중1 MED"),
      row("다른반", "c2", "중등E_중2 정규 A"),
    ];
    expect(names(sortSeatRowsByClass(rows, self))).toEqual(["늦게나감", "먼저나감", "다른반"]);
  });

  it("반을 모르는 줄은 빼지 않고 맨 뒤로", () => {
    const rows = [
      row("반없음", "c0", "   "),
      row("가나", "c2", "중등E_중2 정규 A"),
      row("다라", "c1", "중등E_중1 MED"),
    ];
    const sorted = sortSeatRowsByClass(rows, self);
    expect(names(sorted)).toEqual(["다라", "가나", "반없음"]);
    expect(sorted).toHaveLength(rows.length); // 사라지는 학생 금지
  });

  it("반을 모르는 줄이 여럿이면 원래 순서를 지킨다", () => {
    const rows = [row("둘째", "c0", ""), row("첫째", "c0", "")];
    expect(names(sortSeatRowsByClass(rows, self))).toEqual(["둘째", "첫째"]);
  });

  it("이름이 같은 다른 반은 id로 붙여 놓는다(섞이지 않는다)", () => {
    const rows = [
      row("A반학생", "cA", "중등E_중1 MED"),
      row("B반학생", "cB", "중등E_중1 MED"),
      row("A반학생2", "cA", "중등E_중1 MED"),
    ];
    expect(names(sortSeatRowsByClass(rows, self))).toEqual(["A반학생", "A반학생2", "B반학생"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    const rows = [row("가나", "c2", "중등E_중2 정규 A"), row("다라", "c1", "중등E_중1 MED")];
    const before = names(rows);
    sortSeatRowsByClass(rows, self);
    expect(names(rows)).toEqual(before);
  });

  it("정렬 키는 정본 이름이라 표시 언어와 무관하다", () => {
    // 표시(영문 전환)로 정렬하면 `MidE_…` < `ElemE_…`로 뒤집히는 짝.
    const a = { classId: "c1", className: "중등E_중1 MED" };
    const b = { classId: "c2", className: "초등E_초6 SKY" };
    expect(compareSeatClassRef(a, b)).toBeLessThan(0);
    expect(compareSeatClassRef(b, a)).toBeGreaterThan(0);
    expect(compareSeatClassRef(a, { ...a })).toBe(0);
  });
});
