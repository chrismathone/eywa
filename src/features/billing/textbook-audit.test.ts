import { describe, expect, it } from "vitest";

import {
  TEXTBOOK_CHECK_LABEL,
  describeTextbookChanges,
  diffTextbookOrder,
  textbookAuditTarget,
} from "./textbook-audit";

describe("교재 신청 변경 감사 — 바뀐 칸만", () => {
  it("금액 수정을 사람이 읽는 글자로 남긴다(원장이 못 찾던 그것)", () => {
    const changes = diffTextbookOrder({ price: 22500 }, { price: 23500 });
    expect(changes).toEqual([{ label: "금액", from: "22,500원", to: "23,500원" }]);
  });

  it("숫자 컬럼이 문자열로 와도 같은 값이면 변경이 아니다", () => {
    expect(diffTextbookOrder({ price: "22500" }, { price: 22500 })).toEqual([]);
  });

  it("안 보낸 칸은 '안 바꾼 것'이라 기록하지 않는다", () => {
    const changes = diffTextbookOrder({ bookName: "초5-2 발전 2권 (22개정)", notes: "급해요" }, { price: 100 });
    expect(changes).toEqual([{ label: "금액", from: "(없음)", to: "100원" }]);
  });

  it("비운 칸은 기록한다(null·빈 문자열)", () => {
    expect(diffTextbookOrder({ notes: "급해요" }, { notes: null })).toEqual([
      { label: "메모", from: "급해요", to: "(없음)" },
    ]);
    expect(diffTextbookOrder({ bookDetail: "발전" }, { bookDetail: "  " })).toEqual([
      { label: "상세", from: "발전", to: "(없음)" },
    ]);
  });

  it("금액이 맨 앞에 온다(무엇이 문제였나가 첫 줄)", () => {
    const changes = diffTextbookOrder(
      { bookName: "가", price: 1000 },
      { bookName: "나", price: 2000 },
    );
    expect(changes.map((c) => c.label)).toEqual(["금액", "교재명"]);
  });

  it("바뀐 게 없으면 빈 배열", () => {
    expect(diffTextbookOrder({ price: 100, bookName: "가" }, { price: 100, bookName: "가" })).toEqual([]);
  });
});

describe("감사 목록 한 줄", () => {
  it("칸 이름과 전후 값을 잇는다", () => {
    expect(
      describeTextbookChanges([
        { label: "금액", from: "22,500원", to: "23,500원" },
        { label: "교재명", from: "가", to: "나" },
      ]),
    ).toBe("금액 22,500원 → 23,500원 · 교재명 가 → 나");
  });

  it("많으면 '외 N'으로 접는다", () => {
    const many = ["금액", "교재명", "상세", "학생"].map((label) => ({ label, from: "a", to: "b" }));
    expect(describeTextbookChanges(many)).toBe("금액 a → b · 교재명 a → b · 상세 a → b 외 1");
  });

  it("없으면 null(빈 문장 금지)", () => {
    expect(describeTextbookChanges([])).toBeNull();
    expect(describeTextbookChanges(null)).toBeNull();
  });
});

describe("대상 라벨", () => {
  it("학생 · 교재명", () => {
    expect(textbookAuditTarget({ studentName: "정하운", bookName: "초5-2 발전 2권 (22개정)" })).toBe(
      "정하운 · 초5-2 발전 2권 (22개정)",
    );
  });

  it("둘 다 없으면 대체 문구(빈 라벨 금지)", () => {
    expect(textbookAuditTarget({})).toBe("교재 신청");
    expect(textbookAuditTarget({ studentName: "  ", bookName: null })).toBe("교재 신청");
  });
});

describe("체크 항목 라벨", () => {
  it("등록·주문·납부 한국어(raw 키 노출 금지)", () => {
    expect(TEXTBOOK_CHECK_LABEL.registered).toBe("등록");
    expect(TEXTBOOK_CHECK_LABEL.ordered).toBe("주문");
    expect(TEXTBOOK_CHECK_LABEL.paid).toBe("납부");
  });
});
