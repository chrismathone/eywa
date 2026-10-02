import { describe, expect, it } from "vitest";
import { transferDateError } from "./bulk-transfer";

describe("반 이동 기간 사전 검증", () => {
  it("단일·단체 이동은 같은 적용일을 사용한다", () => {
    expect(transferDateError([{}, { startDate: "2026-10-02" }], "2026-10-02", "2026-10-02")).toBeNull();
  });
  it.each(["2026-10-01", "2026-10-03"])("도착 시작일 %s가 이동일과 다르면 저장 전에 막는다", (startDate) => {
    expect(transferDateError([{ startDate }], "2026-10-02", "2026-10-02")).toContain("새 반 시작일");
  });
  it("존재하지 않는 날짜와 과거 날짜를 거절한다", () => {
    expect(transferDateError([], "2026-02-30", "2026-01-01")).toContain("올바른 이동일");
    expect(transferDateError([], "2026-10-01", "2026-10-02")).toContain("오늘 이후");
  });
});
