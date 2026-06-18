import { describe, expect, it } from "vitest";
import { decideCheckinAction } from "./checkin-logic";

describe("decideCheckinAction", () => {
  it("레코드 없음 → 등원", () => {
    expect(decideCheckinAction(null)).toBe("check_in");
  });
  it("등원시각만 비어 있으면 → 등원", () => {
    expect(decideCheckinAction({ checkedInAt: null, checkedOutAt: null })).toBe("check_in");
  });
  it("등원만 했으면 → 하원", () => {
    expect(decideCheckinAction({ checkedInAt: "2026-06-18T09:00:00Z", checkedOutAt: null })).toBe(
      "check_out",
    );
  });
  it("등원+하원 모두 했으면 → noop", () => {
    expect(
      decideCheckinAction({
        checkedInAt: "2026-06-18T09:00:00Z",
        checkedOutAt: "2026-06-18T12:00:00Z",
      }),
    ).toBe("noop");
  });
});
