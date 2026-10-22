import { describe, expect, it } from "vitest";
import { bookKey, inferBookFromReports, matchCatalogBook, bookPosition, type CatalogBook } from "./math-book-match";
import { bookSequence } from "./book-sequence";
import { validGradeTerm } from "./grade-term";

const book = (id: string, title: string, gradeTerm: string | null, lessons: string[]): CatalogBook => ({
  id, title, gradeTerm, lessons: lessons.map((progress, i) => ({ lessonNo: i + 1, progress })),
});

// 실제 교재목록·makeedu 단가표 이름 그대로(2026-10-22).
const M32 = book("m32", "가우스 중3-2 4권", "중3-2", ["원주각"]);
const H11a = book("h1", "가우스 공통수학1 01. 다항식~ 02.방정식과 부등식(1)", "고1-1", ["다항식의 덧셈과 뺄셈 / 다항식의 곱셈", "복소수"]);
const H11b = book("h2", "가우스 공통수학1 02. 방정식과 부등식(2)", "고1-1", ["이차방정식의 판별식", "이차함수의 최대 최소"]);
const H11c = book("h3", "가우스 공통수학1 03. 경우의 수~04. 행렬", "고1-1", ["합의 법칙과 곱의 법칙"]);
const H12a = book("h4", "가우스 공통수학2 01. 도형의 방정식", "고1-2", ["두 점 사이의 거리"]);
const E31 = book("e1", "초3-1 발전 1권 (22개정)", "초3-1", ["덧셈"]);
const E32 = book("e2", "초3-1 발전 2권 (22개정)", "초3-1", ["나눗셈"]);
const E21 = book("e0", "초2-1 발전", "초2-1", ["세 자리 수"]);
const CATALOG = [M32, H11a, H11b, H11c, H12a, E31, E32, E21];

describe("validGradeTerm", () => {
  it.each([["고1-1", "고1-1"], [" 중2-2 ", "중2-2"], ["초6-2", "초6-2"], ["고1", null], ["고1-3", null], ["중0-1", null], ["", null], [null, null]])(
    "%s → %s", (v, want) => expect(validGradeTerm(v)).toBe(want),
  );
});

describe("bookKey — 학년·학기가 있으면 그 값으로", () => {
  it("고등은 단원 번호가 권", () => {
    expect(bookKey(H11a)).toBe("가우스|고1-1|1");
    expect(bookKey(H11b)).toBe("가우스|고1-1|2");
    expect(bookKey(H11c)).toBe("가우스|고1-1|3");
    expect(bookKey(H12a)).toBe("가우스|고1-2|1");
  });
  it("초등 발전은 시리즈 '발전', 권 없는 책은 1권", () => {
    expect(bookKey(E31)).toBe("발전|초3-1|1");
    expect(bookKey(E32)).toBe("발전|초3-1|2");
    expect(bookKey(E21)).toBe("발전|초2-1|1");
  });
  it("학년이 없으면 제목에서(종전 그대로)", () => {
    expect(bookKey({ title: "가우스 중2-2 3권" })).toBe("가우스|중2-2|3");
    expect(bookKey({ title: "가우스 공통수학1 01. 다항식" })).toBeNull();
  });
});

describe("bookSequence — 중3 다음은 고등 과목으로 잇는다", () => {
  it("중3-2 4권 → 공통수학1 세 권 → 공통수학2", () => {
    const seq = bookSequence("가우스|중3-2|4", CATALOG, 5);
    expect(seq.map((b) => b.key)).toEqual(["가우스|중3-2|4", "가우스|고1-1|1", "가우스|고1-1|2", "가우스|고1-1|3", "가우스|고1-2|1"]);
    // 고등엔 중등 관례(1·2권 / 3·4권)를 얹지 않는다 — 없는 권이 '미등록'으로 서지 않게.
    expect(seq.every((b) => b.catalog)).toBe(true);
  });
  it("초등은 학기마다 1·2권만", () => {
    const seq = bookSequence("발전|초3-1|1", CATALOG, 3);
    expect(seq.map((b) => b.key)).toEqual(["발전|초3-1|1", "발전|초3-1|2"]);
  });
});

describe("교재 칸 매칭", () => {
  it("makeedu 주문명(제목 그대로)은 그 권", () => {
    expect(matchCatalogBook("가우스 공통수학1 02. 방정식과 부등식(2)", CATALOG)?.id).toBe("h2");
    expect(matchCatalogBook("초3-1 발전 2권 (22개정)", CATALOG)?.id).toBe("e2");
    expect(matchCatalogBook("초3-1 발전 2권", CATALOG)?.id).toBe("e2");
  });
  it("과목 이름만이면 권을 모른다(null) — 진도로 가른다", () => {
    expect(matchCatalogBook("가우스 공통수학1", CATALOG)).toBeNull();
    const lines = [{ date: "2026-10-20", textbook: "가우스 공통수학1", progress: "이차방정식의 판별식" }];
    expect(inferBookFromReports(lines, CATALOG)?.id).toBe("h2");
    expect(bookPosition(H11b, lines, CATALOG, true)?.lessonNo).toBe(1);
    // 다른 권의 진도는 이 권 차시로 세지 않는다.
    expect(bookPosition(H11a, lines, CATALOG, true)).toBeNull();
  });
  it("제목 그대로 + 흔들린 표기로 두 권이 적힌 칸은 고르지 않는다", () => {
    expect(matchCatalogBook("가우스 중3-2 4권, 초3-1-2권 발전", CATALOG)).toBeNull();
  });
  it("다른 과목이 섞인 칸은 고르지 않는다", () => {
    const lines = [{ date: "2026-10-20", textbook: "가우스 공통수학1, 가우스 공통수학2", progress: "복소수" }];
    expect(bookPosition(H11a, lines, CATALOG, true)).toBeNull();
  });
});
