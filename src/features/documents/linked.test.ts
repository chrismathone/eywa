import { describe, it, expect } from "vitest";
import { isLinkedSource, quoteDoc, textbookOrderDoc } from "./linked";

describe("isLinkedSource", () => {
  it("연동 키만 통과 — 서식 분류·임의 값은 거부", () => {
    expect(isLinkedSource("textbooks")).toBe(true);
    expect(isLinkedSource("quotes")).toBe(true);
    expect(isLinkedSource("billing")).toBe(false); // DocumentCategory와 미충돌
    expect(isLinkedSource("")).toBe(false);
  });
});

describe("textbookOrderDoc", () => {
  const base = {
    id: "o1",
    bookName: "쎈 수학 중2-1",
    bookDetail: "3. 함수",
    studentName: "이윤건",
    teacherName: "김강사",
    price: 15000,
    status: "paid",
    requestDate: "2026-07-01",
    createdAt: "2026-06-30T09:00:00Z",
  };

  it("제목 = 학생 — 교재명, 클릭 = 인쇄 카드(A4 창)", () => {
    const d = textbookOrderDoc(base);
    expect(d.title).toBe("이윤건 — 쎈 수학 중2-1");
    expect(d.href).toBe("/textbook/o1/print");
    expect(d.printId).toBe("print/textbook/o1");
    expect(d.typeLabel).toBe("교재 요청서");
  });

  it("설명 = 상세 · 가격 · 상태 한글 라벨", () => {
    expect(textbookOrderDoc(base).description).toBe("3. 함수 · 15,000원 · 납부");
    expect(textbookOrderDoc({ ...base, bookDetail: null, status: "requested" }).description).toBe(
      "15,000원 · 신청",
    );
  });

  it("등록일 = 요청일 우선, 없으면 행 생성 시각 폴백 / 학생 미매칭 표시", () => {
    expect(textbookOrderDoc(base).createdAt).toBe("2026-07-01");
    expect(textbookOrderDoc({ ...base, requestDate: null }).createdAt).toBe("2026-06-30T09:00:00Z");
    expect(textbookOrderDoc({ ...base, studentName: null }).title).toBe("학생 미지정 — 쎈 수학 중2-1");
  });

  it("미등록 상태 코드는 원문 그대로(깨짐 방지)", () => {
    expect(textbookOrderDoc({ ...base, status: "delivered" }).description).toContain("delivered");
  });
});

describe("quoteDoc", () => {
  const base = {
    id: "q1",
    studentName: "박신입",
    school: "경명여중",
    grade: "중1",
    courseCount: 2,
    totalAmount: 350000,
    consultant: "원장",
    createdAt: "2026-07-02T09:00:00Z",
  };

  it("제목·딥링크(계산기 qid)·설명(학교학년 압축 표기)", () => {
    const d = quoteDoc(base);
    expect(d.title).toBe("박신입 — 수강료 견적서");
    expect(d.href).toBe("/billing?tab=calculator&qid=q1");
    expect(d.printId).toBeNull();
    expect(d.description).toBe("경명여중1 · 과목 2 · 350,000원"); // schoolGradeLabel 압축(전역 규칙)
    expect(d.byName).toBe("원장");
  });

  it("학교·과목 없으면 해당 조각 생략", () => {
    const d = quoteDoc({ ...base, school: null, grade: null, courseCount: 0 });
    expect(d.description).toBe("350,000원");
  });
});
