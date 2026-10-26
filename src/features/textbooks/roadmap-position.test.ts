import { describe, expect, it } from "vitest";
import { lessonNoOf, unitKey, type CatalogBook } from "./math-book-match";
import { latestPosition } from "./roadmap-position";

const book = (id: string, title: string, lessons: string[]): CatalogBook => ({
  id, title, lessons: lessons.map((progress, i) => ({ lessonNo: i + 1, progress })),
});
// 실제 가우스 차시표 모양 — 중3은 번호 뒤에 점이 없다(`1-3 무리수와 실수`).
const M3A = book("m3a", "가우스 중3-1 1권", [
  "1-1 제곱근의 뜻과 표현 / 1-2 제곱근의 성질",
  "1-3 무리수와 실수 / 1-4 제곱근의 곱셈과 나눗셈",
  "1-5 제곱근의 덧셈과 뺄셈 / 1-6 제곱근의 값",
  "실수와 그 계산(단원) 총괄",
  "2-1 다항식의 곱셈 / 2-2 다항식의 곱셈의 응용",
  "2-3 인수분해 / 2-4 인수분해의 응용",
]);
const M3B = book("m3b", "가우스 중3-1 2권", [
  "3-1 이차방정식과 그 해 / 3-2 인수분해를 이용한 이차방정식의 풀이",
  "3-3 제곱근을 이용한 이차방정식의 풀이 / 3-4 이차방정식의 근의 공식",
  "3-5 이차방정식의 응용 / 3-6 이차방정식의 활용(수, 실생활, 쏘아 올린 물체 등)",
  "3-7 이차방정식의 활용(도형) / 이차방정식(단원) 총괄",
  "4-1 이차함수 y=ax²의 그래프 / 4-2 이차함수 y=ax²+q, y=a(x-p)²의 그래프",
]);
const M2 = book("m2", "가우스 중2-2 3권", [
  "5-1. 이등변삼각형의 성질 / 5-2. 직각삼각형의 합동",
  "5-3. 삼각형의 외심 / 5-4. 삼각형의 내심",
]);
const M1C = book("m1c", "가우스 중1-2 3권", ["일차방정식의 활용"]);
const M1D = book("m1d", "가우스 중1-2 4권", ["대푯값과 산포도 / 줄기와 잎 그림"]);
const M3D = book("m3d", "가우스 중3-2 4권", ["6-1 원과 현", "7-1 대푯값 / 7-2 산포도와 표준편차"]);
const CATALOG = [M2, M3A, M3B, M1C, M1D, M3D];

describe("중3 차시표 ↔ eywa 커리큘럼 이름", () => {
  it("점 없는 번호 머리도 뗀다 · 하이픈 없는 맨 숫자는 그대로", () => {
    expect(unitKey("1-3 무리수와 실수")).toBe(unitKey("수학 무리수와 실수"));
    expect(unitKey("1 m보다 긴 길이")).toBe("1m보다긴길이");
  });
  it.each([
    ["수학 제곱근의 뜻과 성질", M3A, 1],
    ["수학 무리수와 실수", M3A, 2],
    ["수학 근호를 포함한 식의 계산", M3A, 3],
    ["수학 인수분해의 응용", M3A, 6],
    ["수학 이차방정식의 풀이", M3B, 2],
    ["수학 이차방정식의 근의 공식과 응용", M3B, 3],
    ["수학 이차방정식의 활용", M3B, 4],
    ["수학 이차함수와 그래프", M3B, 5],
  ])("%s → %s차시", (line, b, no) => {
    expect(lessonNoOf(line, b.lessons)).toBe(no);
  });
});

describe("latestPosition — 다른 책 복습은 진도 위치가 아니다", () => {
  it("중3을 나가다 다른 책으로 중2-2를 복습해도 현재는 중3", () => {
    const reports = [
      { date: "2026-10-16", textbook: "가우스 중3-1 2권", progress: "수학 무리수와 실수" },
      { date: "2026-10-20", textbook: "가우스 중3-1 2권", progress: "수학 이차방정식의 풀이" },
      { date: "2026-10-22", textbook: "중2-2 100발 100중", progress: "수학 삼각형의 외심" },
    ];
    const p = latestPosition("가우스", CATALOG, reports);
    expect(p?.title).toBe("가우스 중3-1 2권");
    expect(p?.lessonNo).toBe(2);
  });
  it("교재 칸이 비었거나 띄어 적은 시리즈는 센다", () => {
    expect(latestPosition("가우스", CATALOG, [{ date: "2026-10-01", textbook: null, progress: "삼각형의 내심" }])?.title)
      .toBe("가우스 중2-2 3권");
    expect(latestPosition("가우스", CATALOG, [{ date: "2026-10-01", textbook: "가 우스 중2-2", progress: "삼각형의 내심" }])?.title)
      .toBe("가우스 중2-2 3권");
  });
  it("한 기록이 두 권에 걸리면 교재 칸이 가리키는 권 — 중1이 중3으로 튀지 않는다", () => {
    const line = (textbook: string) => [{ date: "2026-10-01", textbook, progress: "대푯값과 산포도" }];
    expect(latestPosition("가우스", CATALOG, line("가우스 중1-2 4권"))?.title).toBe("가우스 중1-2 4권");
    expect(latestPosition("가우스", CATALOG, line("가우스 중1-2 3권"))?.title).toBe("가우스 중1-2 4권"); // 같은 학년·학기
    expect(latestPosition("가우스", CATALOG, line("가우스 중3-2 4권"))?.title).toBe("가우스 중3-2 4권");
    expect(latestPosition("가우스", CATALOG, line("가우스"))?.title).toBe("가우스 중3-2 4권"); // 근거 없으면 종전대로 뒤 권
  });
});
