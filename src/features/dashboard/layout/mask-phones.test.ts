import { describe, expect, it } from "vitest";
import { maskPhones } from "./mask-phones";

describe("전화번호 가림", () => {
  it("전화번호만 가리고 날짜·시각은 둔다", () => {
    expect(maskPhones("박민수 010-9876-5432 입테")).toBe("박민수 010-****-5432 입테");
    expect(maskPhones("01098765432")).toBe("010-****-5432");
    expect(maskPhones("연락 9876-5432")).toBe("연락 ****-5432");
    // 사람이 손으로 적는 다른 표기(리뷰에서 가려지지 않던 것들)
    expect(maskPhones("010 - 1234 - 5678")).toBe("010-****-5678");
    expect(maskPhones("010 1234  5678")).toBe("010-****-5678");
    expect(maskPhones("010/1234/5678")).toBe("010-****-5678");
    expect(maskPhones("010–1234–5678")).toBe("010-****-5678");
    expect(maskPhones("010.1234.5678")).toBe("010-****-5678");
    expect(maskPhones("+82 10 1234 5678")).toBe("+82-10-****-5678");
    expect(maskPhones("8210-1234-5678")).toBe("82-10-****-5678");
    expect(maskPhones("02-123-4567")).toBe("02-****-4567");
    expect(maskPhones("053)123-4567")).toBe("053-****-4567");
    expect(maskPhones("(010)1234-5678")).toBe("(010-****-5678");
    expect(maskPhones("0505-1234-5678")).toBe("0505-****-5678");
    expect(maskPhones("1234  5678")).toBe("****-5678");
    // 시각 범위·연도 범위는 그대로
    expect(maskPhones("월 1500-1700 수업")).toBe("월 1500-1700 수업");
    expect(maskPhones("2025-2026학년도")).toBe("2025-2026학년도");
    expect(maskPhones("초5 1234-5678")).toBe("초5 ****-5678");
    // 가린 번호 뒤에 숫자가 이어져도 그 숫자를 먹지 않는다(한 번의 훑기)
    expect(maskPhones("010-1234-5678 2026-10-02")).toBe("010-****-5678 2026-10-02");
    expect(maskPhones("010-1234-5678 / 2026-10-02")).toBe("010-****-5678 / 2026-10-02");
    expect(maskPhones("2026-10-01 15:30 김철수 초5")).toBe("2026-10-01 15:30 김철수 초5");
    expect(maskPhones("10월 3일 레벨테스트")).toBe("10월 3일 레벨테스트");
  });
});
