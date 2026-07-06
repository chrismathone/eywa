import { describe, expect, it } from "vitest";
import { compareStudentLines, type SortableStudentLine } from "./student-sort";

const S = (name: string, extra: Partial<SortableStudentLine> = {}): SortableStudentLine => ({
  name,
  status: "active",
  ...extra,
});

/** 셀 표시 순서를 이름 배열로. */
const order = (arr: SortableStudentLine[]) => [...arr].sort(compareStudentLines).map((s) => s.name);

describe("compareStudentLines", () => {
  it("재원 안에서 신규 → 전입(반이동) → 기존 순", () => {
    const list = [
      S("기존나"),
      S("전입가", { isTransferredIn: true }),
      S("신규가", { isNew: true }),
      S("기존가"),
      S("신규나", { isNew: true }),
    ];
    // 신규(가나다) → 전입 → 기존(가나다)
    expect(order(list)).toEqual(["신규가", "신규나", "전입가", "기존가", "기존나"]);
  });

  it("반이동 학생(신규+전입 동시)은 '전입'으로 분류 — 신규 그룹에 안 섞임", () => {
    const list = [
      S("진짜신규", { isNew: true }),
      S("반이동", { isNew: true, isTransferredIn: true }), // 둘 다 true
      S("기존"),
    ];
    // 반이동은 전입(1)이라 진짜신규(0) 뒤, 기존(2) 앞
    expect(order(list)).toEqual(["진짜신규", "반이동", "기존"]);
  });

  it("상태 순위: 재원 → 대기 → 퇴원", () => {
    const list = [
      S("퇴원", { status: "withdrawn", endDate: "2026-06-01" }),
      S("대기", { status: "hold" }),
      S("재원", { status: "active" }),
    ];
    expect(order(list)).toEqual(["재원", "대기", "퇴원"]);
  });

  it("퇴원은 최신 종료일(endDate desc) 순", () => {
    const list = [
      S("먼저퇴원", { status: "withdrawn", endDate: "2026-05-01" }),
      S("나중퇴원", { status: "withdrawn", endDate: "2026-06-20" }),
    ];
    expect(order(list)).toEqual(["나중퇴원", "먼저퇴원"]);
  });

  it("같은 그룹은 이름 가나다(ko)", () => {
    expect(order([S("다"), S("가"), S("나")])).toEqual(["가", "나", "다"]);
  });
});
