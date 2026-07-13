import { describe, expect, it } from "vitest";
import { classCode, classInvoiceAmount, type LineItemLike } from "./class-amount";

describe("classCode", () => {
  it("접두사 달라도 마지막 영숫자 토큰 = 코드", () => {
    expect(classCode("개별(초등M) 초5 BS2C")).toBe("BS2C");
    expect(classCode("중등M 중1 BS3C")).toBe("BS3C");
    expect(classCode("중등M 개별 JJ3K")).toBe("JJ3K");
  });
  it("-숫자 접미사 제거", () => {
    expect(classCode("중등M 중2 PS2S-1")).toBe("PS2S");
  });
  it("한글 서술명은 코드 없음(null)", () => {
    expect(classCode("중등E_초5 의치대")).toBeNull();
    expect(classCode("고3 공통과목 (토)")).toBeNull();
    expect(classCode("중등E_중1 정규 B")).toBeNull();
  });
});

const li = (description: string, amount: number): LineItemLike => ({ description, amount });

describe("classInvoiceAmount", () => {
  it("코드 매칭 — 그 반 라인만 합산(학생 청구서 전체 아님)", () => {
    // 강수정: BS2C 192,150 + EiE 40,000 + 강아 30,000 + JJ1H 85,000 = 청구서 347,150. 반 참고액은 BS2C만.
    const items = [
      li("[EiE] PHONICS&ROOKIES 40,000", 40000),
      li("[강아] 강의하는아이들 (김민주)", 30000),
      li("초등M 개별 JJ1H 수", 85000),
      li("초등M 초5 BS2C 월목", 192150),
    ];
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", items)).toBe(192150);
  });

  it("같은 반 라인 2줄이면 합산(분할 청구)", () => {
    // 김수민: BS2C가 21,250 + 148,750 두 줄 → 170,000
    const items = [
      li("초등M 초5 BS2C 월목", 21250),
      li("중등E_초등 브릿지 A Jane 화수금", 288000),
      li("초등M 초5 BS2C 월목", 148750),
    ];
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", items)).toBe(170000);
  });

  it("코드 부분문자열 오매칭 방지 — JJ3J는 JJ3K와 다름", () => {
    const items = [li("중등M 개별 JJ3J 수", 96000), li("중등M 개별 JJ3K 수", 90000)];
    expect(classInvoiceAmount("중등M 개별 JJ3K", items)).toBe(90000);
  });

  it("-1 접미사 반 = 접미사 없는 수납명과 매칭", () => {
    const items = [li("중등M 중2 PS2S 화금", 216000), li("[과학] 중2과학 내신대비반", 25000)];
    expect(classInvoiceAmount("중등M 중2 PS2S-1", items)).toBe(216000);
  });

  it("코드 없는 반(영어 서술명) = 반명 포함 매칭", () => {
    const items = [
      li("[강아] 강의하는아이들 (이수진)", 30000),
      li("중등E_초5 의치대 Yoojin 화금 15:00-17:00", 337500),
    ];
    expect(classInvoiceAmount("중등E_초5 의치대", items)).toBe(337500);
  });

  it("매칭 라인 0개면 null(미상 — 지어내지 않음)", () => {
    const items = [li("고등E_고3 정규 Charlie 토 10:00", 300000)];
    expect(classInvoiceAmount("고3 공통과목 (토)", items)).toBeNull();
  });

  it("빈 line_items = null", () => {
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", [])).toBeNull();
  });
});
