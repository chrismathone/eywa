import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("계약서 글자 추출은 Claude 전용", () => {
  it("텍스트 PDF와 스캔 OCR 호출 모두 allowedProviders로 Anthropic만 허용한다", () => {
    const source = readFileSync(join(process.cwd(), "src/features/staff/contract/server/contract-extract-actions.ts"), "utf8");
    expect(source.match(/allowedProviders:\s*\["anthropic"\]/g)).toHaveLength(2);
    for (const feature of ["staff_contract_pdf_ocr", "staff_contract_pdf"]) {
      const at = source.indexOf(`feature: "${feature}"`);
      expect(at, feature).toBeGreaterThan(0);
      expect(source.slice(Math.max(0, at - 500), at), feature).toContain('allowedProviders: ["anthropic"]');
    }
  });
});
