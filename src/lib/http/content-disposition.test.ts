import { describe, expect, it } from "vitest";
import { attachmentFilename } from "./content-disposition";

describe("attachmentFilename (RFC 5987, 한글 파일명 안전)", () => {
  it("한글 파일명을 filename*(UTF-8 percent-encoded)로 인코딩한다", () => {
    const out = attachmentFilename("수학_시간표_2026-06-26.xlsx");
    // 한글은 ASCII 폴백에서 _로, filename*에는 percent-encoding으로
    expect(out).toContain("filename*=UTF-8''");
    expect(out).toContain(encodeURIComponent("수학_시간표_2026-06-26.xlsx"));
    // 결과 헤더 값은 전부 ASCII(ByteString 안전) — 비ASCII 코드포인트 0개
    expect([...out].every((ch) => ch.charCodeAt(0) <= 255)).toBe(true);
  });

  it("ASCII 폴백 filename을 함께 제공한다(따옴표 없음)", () => {
    const out = attachmentFilename("수납_2026-06.xlsx");
    expect(out).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(out).toContain("2026-06.xlsx"); // ASCII 부분은 보존
  });

  it("순수 ASCII 파일명도 안전하게 처리", () => {
    const out = attachmentFilename("report.xlsx");
    expect(out).toContain('filename="report.xlsx"');
    expect(out).toContain("filename*=UTF-8''report.xlsx");
  });

  it("*'() 등 RFC 5987 비-attr-char를 추가 인코딩한다", () => {
    const out = attachmentFilename("a'b(c)*.xlsx");
    expect(out).toContain("%27"); // '
    expect(out).toContain("%28"); // (
    expect(out).toContain("%29"); // )
    expect(out).toContain("%2A"); // *
  });
});
