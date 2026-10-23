import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { decodeTip } from "@/components/hover-tip/tip";
import type { ReportRating } from "@/features/report-admin/report-rating";
import { RatingCell } from "./rating-cell";

afterEach(cleanup);

const rating = (over: Partial<ReportRating> = {}): ReportRating => ({
  points: 3.4,
  items: [{ label: "따뜻함", score: 4, note: "다정한 말투" }],
  parentFeeling: "아이를 잘 봐 주시네요",
  suggestion: null,
  claim: null,
  claimReason: null,
  ratedOn: "2026-10-22",
  ...over,
});

describe("보고서 목록 평점 칸", () => {
  it("평점이 없으면 '—'(새 보고서)", () => {
    const { container } = render(<RatingCell rating={null} />);
    expect(container.textContent).toBe("—");
    expect(container.querySelector("[data-tip]")).toBeNull();
  });

  it("소수 한 자리 + 근거는 카드로 — 같은 값에 title을 겹쳐 달지 않는다", () => {
    const { container } = render(<RatingCell rating={rating()} />);
    expect(screen.getByText("3.4")).toBeTruthy();
    const tipEl = container.querySelector("[data-tip]")!;
    expect(decodeTip(tipEl.getAttribute("data-tip"))?.rows).toEqual([["따뜻함 4", "다정한 말투"]]);
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("3.0 미만만 주의 색, 검증에서 남은 클레임만 '!' 표식", () => {
    const { container, rerender } = render(<RatingCell rating={rating({ points: 2.8, claim: "confirmed", claimReason: "어긋남" })} />);
    expect(screen.getByText("2.8").className).toContain("text-amber");
    expect(screen.getByRole("img", { name: "클레임 위험 확정" }).className).toContain("text-danger");

    rerender(<RatingCell rating={rating({ claim: "cleared", claimReason: "풀림" })} />);
    expect(screen.getByText("3.4").className).not.toContain("text-amber");
    expect(container.querySelector('[role="img"]')).toBeNull();
  });
});
