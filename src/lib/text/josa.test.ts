import { describe, it, expect } from "vitest";
import { hasBatchim, pickJosa, JOSA_ALTERNATION } from "./josa";

describe("hasBatchim", () => {
  it("한글 음절의 종성을 본다", () => {
    expect(hasBatchim("김지우")).toBe(false); // 우
    expect(hasBatchim("김민수")).toBe(false); // 수
    expect(hasBatchim("박성혁")).toBe(true); // 혁
    expect(hasBatchim("이승민")).toBe(true); // 민
    expect(hasBatchim("가")).toBe(false);
    expect(hasBatchim("각")).toBe(true);
  });

  it("알파벳은 한국어 읽기 기준 — 동명이인 접미(A·B)가 붙어도 맞게 읽는다", () => {
    expect(hasBatchim("김태희A")).toBe(false); // 에이
    expect(hasBatchim("박서연B")).toBe(false); // 비
    expect(hasBatchim("이수빈L")).toBe(true); // 엘
    expect(hasBatchim("김나율M")).toBe(true); // 엠
    expect(hasBatchim("황지민N")).toBe(true); // 엔
    expect(hasBatchim("최준서R")).toBe(true); // 알
    expect(hasBatchim("a")).toBe(false); // 소문자도 동일
  });

  it("숫자는 한국어 수 읽기 기준", () => {
    expect(hasBatchim("1")).toBe(true); // 일
    expect(hasBatchim("2")).toBe(false); // 이
    expect(hasBatchim("3")).toBe(true); // 삼
    expect(hasBatchim("5")).toBe(false); // 오
    expect(hasBatchim("6")).toBe(true); // 육
  });

  it("읽는 법을 모르면 null — 호출부가 원문을 그대로 두게 한다", () => {
    expect(hasBatchim("★")).toBeNull();
    expect(hasBatchim("")).toBeNull();
    expect(hasBatchim(null)).toBeNull();
    expect(hasBatchim(undefined)).toBeNull();
  });
});

describe("pickJosa", () => {
  it("짝의 어느 쪽을 적었든 받침에 맞춰 고른다", () => {
    expect(pickJosa("김지우", "이")).toBe("가");
    expect(pickJosa("김지우", "가")).toBe("가");
    expect(pickJosa("박성혁", "가")).toBe("이");
    expect(pickJosa("박성혁", "이")).toBe("이");
  });

  it("은/는 · 을/를 · 과/와도 같은 규칙", () => {
    expect(pickJosa("김지우", "은")).toBe("는");
    expect(pickJosa("박성혁", "는")).toBe("은");
    expect(pickJosa("쎈", "를")).toBe("을");
    expect(pickJosa("가우스", "을")).toBe("를");
    expect(pickJosa("박성혁", "와")).toBe("과");
    expect(pickJosa("김지우", "과")).toBe("와");
  });

  it("으로/로는 ㄹ 받침이 예외다", () => {
    expect(pickJosa("연필", "으로")).toBe("로"); // ㄹ 받침 → 로
    expect(pickJosa("가방", "로")).toBe("으로"); // ㅇ 받침 → 으로
    expect(pickJosa("학교", "으로")).toBe("로"); // 받침 없음 → 로
  });

  it("모르는 조사·판정 불가는 적힌 그대로 둔다", () => {
    expect(pickJosa("김지우", "께서")).toBe("께서");
    expect(pickJosa("★", "이")).toBe("이");
    expect(pickJosa("", "이")).toBe("이");
  });
});

describe("JOSA_ALTERNATION", () => {
  it("긴 조사가 먼저 온다 — 정규식 대안에서 `이`가 `이랑`을 먼저 삼키지 않게", () => {
    const parts = JOSA_ALTERNATION.split("|");
    expect(parts.indexOf("이랑")).toBeLessThan(parts.indexOf("이"));
    expect(parts.indexOf("으로")).toBeLessThan(parts.indexOf("로"));
  });
});
