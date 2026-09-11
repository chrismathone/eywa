import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * 수업 평가 삭제 뒤 이동이 창(iframe) 안에서 embed=1을 지킨다 — 전수검사(2026-09-11) `$[6].findings[1]`.
 * 같은 모양의 원생 삭제(`delete-student-button.tsx`)는 이미 `inFrame ? withEmbed(href) : href`를 쓴다 —
 * 안 실으면 창 안 문서가 **전체 셸**로 새로 그려진다(창 전용 부품이 빠지고 공지 팝업·팰릿이 창 안에 들어온다).
 */
const frame = vi.hoisted(() => ({ inFrame: true }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));
vi.mock("@/features/class-review/server/actions", () => ({
  deleteClassReview: vi.fn(async () => ({ ok: true })),
}));

import { DeleteReviewButton } from "./delete-review-button";

let assign: MockInstance<(url: string | URL) => void>;
beforeEach(() => {
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  assign.mockRestore();
});

function deleteIt() {
  render(<DeleteReviewButton docId="d1" teacherName="김강사" date="2026-09-11" submittedCount={0} />);
  fireEvent.click(screen.getByRole("button", { name: /평가 삭제/ }));
  fireEvent.click(screen.getByRole("button", { name: "삭제 확정" }));
}

describe("수업 평가 삭제 뒤 목록 이동", () => {
  it("🔴 창 안이면 embed=1을 싣는다(원생 삭제와 같은 규칙)", async () => {
    frame.inFrame = true;
    deleteIt();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/class-review?embed=1"));
  });

  it("최상위(폰·배경)면 주소 그대로", async () => {
    frame.inFrame = false;
    deleteIt();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/class-review"));
  });
});
