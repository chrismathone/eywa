import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 이력서 삭제 뒤 이동 — 서버 액션 직후라 `router.push`가 아니라 풀 문서 이동이어야 한다(#102:
 * push는 액션 응답에 삼켜져 창에 방금 지운 이력서의 404가 남는다). 창 안이면 embed를 유지하고,
 * 지운 이력서 주소는 죽은 칸이라 `replace`로 덮는다(뒤로가기가 404에 걸리지 않게).
 */
const m = vi.hoisted(() => ({
  inFrame: true,
  deleteStaffResume: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("@/features/staff/resume/server/resume-actions", () => ({
  deleteStaffResume: (id: string) => m.deleteStaffResume(id),
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => m.inFrame }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));

import { DeleteResumeButton } from "./resume-buttons";

let replace: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.inFrame = true;
  m.deleteStaffResume.mockReset();
  m.push.mockReset();
  m.toastError.mockReset();
  m.toastSuccess.mockReset();
  replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** [삭제] → 확인 [삭제]까지 누른다(언어 공급자 없음 = 한국어). */
function confirmDelete() {
  render(<DeleteResumeButton id="res-1" name="홍길동" />);
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
}

describe("이력서 삭제 뒤 이동(#102)", () => {
  it("창 안: embed를 유지한 채 직원관리로 풀 문서 이동한다(router.push 아님, 읽을 수 없는 성공 토스트 없음)", async () => {
    m.deleteStaffResume.mockResolvedValue({ ok: true });
    confirmDelete();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/staff?embed=1"));
    expect(m.deleteStaffResume).toHaveBeenCalledWith("res-1");
    expect(m.push).not.toHaveBeenCalled();
    expect(m.toastSuccess).not.toHaveBeenCalled();
  });

  it("창 밖(최상위 문서): embed 없이 그 주소 그대로", async () => {
    m.inFrame = false;
    m.deleteStaffResume.mockResolvedValue({ ok: true });
    confirmDelete();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/staff"));
  });

  it("삭제가 실패하면 이동하지 않고 사유를 알린다", async () => {
    m.deleteStaffResume.mockResolvedValue({ error: "잠긴 이력서입니다" });
    confirmDelete();
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("잠긴 이력서입니다"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("액션 호출 자체가 실패(reject)해도 '처리 중'에 멈추지 않는다 — 한글 오류 + 버튼 복구", async () => {
    m.deleteStaffResume.mockRejectedValue(new Error("Failed to fetch"));
    confirmDelete();
    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith("삭제하지 못했습니다 — 연결을 확인하고 다시 눌러 주세요"),
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });
});
