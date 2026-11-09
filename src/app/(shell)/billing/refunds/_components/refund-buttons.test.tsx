import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 환불 요청서 삭제 뒤 이동 — 서버 액션 직후라 `router.push`가 아니라 풀 문서 이동이어야 한다(#102:
 * push는 액션 응답에 삼켜져 창에 방금 지운 요청서의 404가 남는다). 창 안이면 embed를 유지하고,
 * 지운 요청서 주소는 죽은 칸이라 `replace`로 덮는다(뒤로가기가 404에 걸리지 않게).
 */
const m = vi.hoisted(() => ({
  inFrame: true,
  deleteRefundRequest: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("@/features/billing/server/refund-actions", () => ({
  deleteRefundRequest: (id: string) => m.deleteRefundRequest(id),
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => m.inFrame }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));

import { DeleteRefundButton } from "./refund-buttons";

let replace: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.inFrame = true;
  m.deleteRefundRequest.mockReset();
  m.push.mockReset();
  m.toastError.mockReset();
  m.toastSuccess.mockReset();
  replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** [삭제] → 확인 [삭제]까지 누른다. */
function confirmDelete() {
  render(<DeleteRefundButton id="r1" name="홍길동" />);
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
}

describe("환불 요청서 삭제 뒤 이동(#102)", () => {
  it("창 안: embed를 유지한 채 환불 면으로 풀 문서 이동한다(router.push 아님, 읽을 수 없는 성공 토스트 없음)", async () => {
    m.deleteRefundRequest.mockResolvedValue({ ok: true });
    confirmDelete();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/billing?tab=refunds&embed=1"));
    expect(m.deleteRefundRequest).toHaveBeenCalledWith("r1");
    expect(m.push).not.toHaveBeenCalled();
    expect(m.toastSuccess).not.toHaveBeenCalled();
  });

  it("창 밖(최상위 문서): embed 없이 그 주소 그대로", async () => {
    m.inFrame = false;
    m.deleteRefundRequest.mockResolvedValue({ ok: true });
    confirmDelete();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/billing?tab=refunds"));
  });

  it("삭제가 실패하면 이동하지 않고 사유를 알린다", async () => {
    m.deleteRefundRequest.mockResolvedValue({ error: "권한이 없습니다" });
    confirmDelete();
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("권한이 없습니다"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("액션 호출 자체가 실패(reject)해도 '처리 중'에 멈추지 않는다 — 한글 오류 + 버튼 복구", async () => {
    m.deleteRefundRequest.mockRejectedValue(new Error("Failed to fetch"));
    confirmDelete();
    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith("삭제하지 못했습니다 — 연결을 확인하고 다시 눌러 주세요"),
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });
});

describe("삭제 확인 줄 — 긴 확인 글 옆에서도 단추가 꺾이지 않는다(리뷰 r3 R3-m3)", () => {
  it("'삭제'·'취소'·물음 글은 줄어들지 않고 한 줄 · 확인 글만 줄어든다", () => {
    render(<DeleteRefundButton id="r1" name="홍길동" confirmText={"취소된 퇴원 요청에 이어진 요청서입니다 — ".repeat(5)} />);
    fireEvent.click(screen.getByRole("button", { name: /삭제/ }));
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) expect(b.className).toMatch(/\bshrink-0\b.*\bwhitespace-nowrap\b|\bwhitespace-nowrap\b.*\bshrink-0\b/);
    expect(screen.getByText("홍길동 요청서 삭제?").className).toMatch(/\bshrink-0\b/);
    expect(screen.getByRole("note").className).toMatch(/\bmin-w-0\b/);
  });
});
