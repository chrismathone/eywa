import { describe, expect, it } from "vitest";
import { ONBOARDING_ITEMS } from "@/features/newcomers/onboarding-items";
import {
  careCellMatches,
  careCellByKey,
  type CareRow,
} from "@/features/newcomers/care-cells";
import { careStatus } from "./care";

const preCall = ONBOARDING_ITEMS.find((i) => i.key === "pre_call")!;
const row = (
  firstClassOn: string,
  checks: Record<string, string | null> = {},
): CareRow => ({ enrolledOn: "2026-09-01", firstClassOn, checks });

describe("student-level care from subject rows", () => {
  it("does not borrow the earlier subject's first class date", () => {
    const student: CareRow = {
      ...row("2026-09-10"),
      subjects: [
        row("2026-09-10", { pre_call: "2026-09-08" }),
        row("2026-09-20"),
      ],
    };
    expect(careStatus(preCall, student, "2026-09-10")).toBe("upcoming");
    expect(
      careCellMatches(careCellByKey("pre_call")!, student, "2026-09-10"),
    ).toBe(false);
  });
  it("counts a student once when multiple subjects need attention", () => {
    const student: CareRow = {
      ...row("2026-09-10"),
      subjects: [row("2026-09-10"), row("2026-09-11")],
    };
    expect(careStatus(preCall, student, "2026-09-10")).toBe("overdue");
    expect(
      careCellMatches(careCellByKey("pre_call")!, student, "2026-09-10"),
    ).toBe(true);
  });
  it("requires every subject to be complete and preserves missing-date states", () => {
    expect(
      careStatus(
        preCall,
        {
          ...row("2026-09-20"),
          subjects: [
            row("2026-09-20", { pre_call: "2026-09-10" }),
            row("2026-09-21", { pre_call: "2026-09-10" }),
          ],
        },
        "2026-09-10",
      ),
    ).toBe("done");
    expect(
      careStatus(
        preCall,
        { ...row("2026-09-20"), firstClassOn: null },
        "2026-09-10",
      ),
    ).toBe("pending");
  });
});
