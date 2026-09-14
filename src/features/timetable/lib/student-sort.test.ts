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
  it("재원 안에서 신규 → 준신입 → 전입(반이동) → 기존 순", () => {
    const list = [
      S("기존나"),
      S("전입가", { isTransferredIn: true }),
      S("신규가", { isNew: true }),
      S("기존가"),
      S("준신입가", { isRecent: true }),
      S("신규나", { isNew: true }),
    ];
    // 신규(가나다) → 준신입 → 전입 → 기존(가나다)
    expect(order(list)).toEqual(["신규가", "신규나", "준신입가", "전입가", "기존가", "기존나"]);
  });

  it("반이동 학생(신규+전입 동시)은 '전입'으로 분류 — 신규 그룹에 안 섞임", () => {
    const list = [
      S("진짜신규", { isNew: true }),
      S("반이동", { isNew: true, isTransferredIn: true }), // 둘 다 true
      S("기존"),
    ];
    // 반이동은 전입(2)이라 진짜신규(0) 뒤, 기존(3) 앞
    expect(order(list)).toEqual(["진짜신규", "반이동", "기존"]);
  });

  it("전입 + 준신입이 동시에 붙어도 '전입'으로 분류(색과 같은 우선순위)", () => {
    const list = [S("준신입", { isRecent: true }), S("전입도준신입", { isRecent: true, isTransferredIn: true })];
    expect(order(list)).toEqual(["준신입", "전입도준신입"]);
  });

  // 원장 2026-09-14 *"30일 이하 → 60일 이하 → 반이동"*. 이름이 사전순과 **반대**라(하 > 가) 가나다로
  // 떨어지면 바로 깨진다 — isRecent가 타입에서 빠져 있던 옛 코드가 정확히 그랬다.
  it("준신입(31~60일)은 기존 가나다에 안 섞이고 신규 바로 뒤에 선다", () => {
    const list = [S("가기존"), S("하준신입", { isRecent: true }), S("나신규", { isNew: true })];
    expect(order(list)).toEqual(["나신규", "하준신입", "가기존"]);
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
