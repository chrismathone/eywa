import { describe, expect, it } from "vitest";
import { isRecordedVia, RECORDED_VIA_LABEL, resolveStaffVia } from "./recorded-via";

describe("resolveStaffVia", () => {
  it("그 반을 가르치면 강사 — 역할이 데스크여도 자기 반은 강사로 굳는다", () => {
    expect(resolveStaffVia(true)).toBe("teacher");
  });

  it("그 반 담당이 아니면 데스크", () => {
    expect(resolveStaffVia(false)).toBe("desk");
  });
});

describe("isRecordedVia", () => {
  it("허용 값만 통과 — 빈 값·모르는 값은 미상", () => {
    expect(isRecordedVia("teacher")).toBe(true);
    expect(isRecordedVia("desk")).toBe(true);
    expect(isRecordedVia("seat")).toBe(true);
    expect(isRecordedVia("kiosk")).toBe(true);
    expect(isRecordedVia(null)).toBe(false);
    expect(isRecordedVia("admin")).toBe(false);
  });

  it("라벨은 한글 — raw 코드를 화면에 안 쓴다", () => {
    expect(RECORDED_VIA_LABEL.teacher).toBe("강사");
    expect(RECORDED_VIA_LABEL.desk).toBe("데스크");
  });
});
