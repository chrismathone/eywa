import { describe, expect, it } from "vitest";
import { bookPosition, catalogBookKey, inferBookFromReports, lessonNoOf, matchCatalogBook, unitKey, type CatalogBook } from "./math-book-match";

const book = (id: string, title: string, lessons: string[]): CatalogBook => ({
  id, title, lessons: lessons.map((progress, i) => ({ lessonNo: i + 1, progress })),
});
const G1 = book("g1", "가우스 중2-1 발전 1권", ["유리수와 소수 / 순환소수 / 순환소수의 분수 표현", "순환소수를 포함한 식의 계산 / 지수법칙"]);
const G2 = book("g2", "가우스 중2-1 발전 2권", ["미지수가 2개인 연립일차방정식 / 연립방정식의 풀이"]);
const G3 = book("g3", "가우스 중2-2 발전 3권", [
  "5-1. 이등변삼각형의 성질 / 5-2. 직각삼각형의 합동",
  "5-3. 삼각형의 외심 / 5-4. 삼각형의 내심",
  "삼각형의 성질(단원) 총괄 / 5-5. 평행사변형의 성질",
  "5-6. 평행사변형이 되는 조건 / 5-7. 여러 가지 사각형(직사각형, 마름모, 정사각형)",
]);
const G4 = book("g4", "가우스 중2-2 발전 4권", ["7-1. 삼각형과 평행선 / 7-2. 삼각형의 각의 이등분선"]);
const CATALOG = [G1, G2, G3, G4];

describe("catalogBookKey", () => {
  it("교재목록 제목을 열쇠로", () => {
    expect(catalogBookKey("가우스 중2-1 발전 1권")).toBe("가우스|중2-1|1");
    expect(catalogBookKey("가우스 중2-2 발전 3권")).toBe("가우스|중2-2|3");
  });
});

describe("matchCatalogBook — 보고서 교재 칸의 표기 흔들림", () => {
  it.each([
    ["가우스 중2-1-1권", "g1"],
    ["가우스 중2-1 1권", "g1"],
    ["가우스중2-1-2", "g2"],
    ["가우스 중2-1-2권,쎈 연산. 백발백중 2-1", "g2"],
    ["가우스 중2-2 3권", "g3"],
    ["가우스 중2-2-3권", "g3"],
    ["가우스 중2-2 4권,일품 1-2", "g4"],
    ["가우스 중 2-2-4권", "g4"],
  ])("%s → %s", (text, id) => {
    expect(matchCatalogBook(text, CATALOG)?.id).toBe(id);
  });
  it.each([
    "가우스 2-2-3권", // 학교급이 없다 — 초등 교재와 구분 불가
    "가우스 중1-1 2권", // 목록에 없는 교재
    "쎈 중2-1",
    "",
  ])("%s → 맞추지 않음", (text) => {
    expect(matchCatalogBook(text, CATALOG)).toBeNull();
  });
  it("두 권이 함께 적히면 고르지 않는다", () => {
    expect(matchCatalogBook("가우스 중2-2 3권\n가우스 중2-2 4권", CATALOG)).toBeNull();
  });
});

describe("lessonNoOf — 진도 → 차수", () => {
  it("번호 머리·과목 라벨·띄어쓰기 무시", () => {
    expect(unitKey("수학 이등변삼각형의 성질")).toBe(unitKey("5-1. 이등변삼각형의 성질"));
    expect(lessonNoOf("수학 삼각형의 내심", G3.lessons)).toBe(2);
    expect(lessonNoOf("1.순환소수", G1.lessons)).toBe(1);
  });
  it("시트와 eywa가 다르게 부르는 소단원은 별칭으로", () => {
    expect(lessonNoOf("수학 직사각형, 마름모, 정사각형", G3.lessons)).toBe(4);
    expect(lessonNoOf("삼각형에서 평행선 사이의 선분의 길이의 비", G4.lessons)).toBe(1);
  });
  it("로마 숫자 · 교재식 이름 ↔ 커리큘럼 이름(중1-1 · 초등 발전)", () => {
    expect(unitKey("수학 일차식의 뜻Ⅱ")).toBe(unitKey("일차식의 뜻 2"));
    expect(unitKey("수학 문자의 사용과 식의 값")).toBe(unitKey("문자의 사용과 식의 계산"));
    expect(unitKey("2-4-1 (1보다 작은 소수)×(자연수)의 계산")).toBe(unitKey("4-1. (소수)×(자연수)의 계산(1)"));
    expect(unitKey("2-3-4 쌓은 모양과 쌓기나무의 개수 알아보기 (3)")).toBe(unitKey("3-4. 위에서 본 모양에 수를 적는 방법"));
    const E52 = book("e52", "초5-2 발전 2권", ["4-1. (소수)×(자연수)의 계산(1) / 4-2. (소수)×(자연수)의 계산(2)", "4-7. 곱의 소수점 위치"]);
    expect(lessonNoOf("수학 2-4-7 곱의 소수점의 위치", E52.lessons)).toBe(2);
    // 받아올림 두 소단원이 한 커리큘럼 이름으로 묶이면 그 묶음의 뒤 차수
    const E31 = book("e31", "초3-1 발전 1권", ["1-1-1 받아올림이 없는 (세 자리 수)+(세 자리 수)", "1-1-2 받아올림이 한 번 있는 (세 자리 수)+(세 자리 수)"]);
    expect(lessonNoOf("1-1-1 받아올림이 없는, 한 번 있는 (세 자리 수)+(세 자리 수)", E31.lessons)).toBe(2);
  });
  it("여러 줄이면 가장 뒤 차수", () => {
    expect(lessonNoOf("1.이등변삼각형의 성질\n2.삼각형의 외심", G3.lessons)).toBe(2);
  });
  it("총괄도 그 차수", () => {
    expect(lessonNoOf("삼각형의 성질(단원) 총괄", G3.lessons)).toBe(3);
  });
  it("모르는 진도는 null", () => {
    expect(lessonNoOf("수학 내신대비", G3.lessons)).toBeNull();
  });
});

describe("bookPosition / inferBookFromReports", () => {
  const reports = [
    { date: "2026-10-01", textbook: "가우스 중2-2 3권", progress: "수학 이등변삼각형의 성질" },
    { date: "2026-10-08", textbook: "가우스 중2-2 3권", progress: "수학 평행사변형의 성질" },
    { date: "2026-10-15", textbook: "가우스 중2-2 3권", progress: "수학 내신대비" },
  ];
  it("최신 기록의 교재를 추정", () => {
    expect(inferBookFromReports(reports, CATALOG)?.id).toBe("g3");
  });
  it("진도가 걸리는 가장 최근 기록의 차수", () => {
    expect(bookPosition(G3, reports, CATALOG)).toEqual({ lessonNo: 3, total: 4, date: "2026-10-08", unit: "평행사변형의 성질" });
  });
  it("여러 줄이면 그 차수를 준 줄을 표시", () => {
    const r = [{ date: "2026-10-20", textbook: "가우스 중2-2 3권", progress: "수학 삼각형의 내심\n이등변삼각형의 성질" }];
    expect(bookPosition(G3, r, CATALOG)).toMatchObject({ lessonNo: 2, unit: "삼각형의 내심" });
  });
  it("교재 칸까지 요구하면 다른 책 기록은 건너뛴다", () => {
    const mixed = [...reports, { date: "2026-10-16", textbook: "쎈 중2-2", progress: "수학 직사각형, 마름모, 정사각형" }];
    expect(bookPosition(G3, mixed, CATALOG)?.lessonNo).toBe(4);
    expect(bookPosition(G3, mixed, CATALOG, true)?.lessonNo).toBe(3);
  });
});
