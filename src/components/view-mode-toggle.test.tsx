/**
 * 사이드바 '강사뷰로 전환' — **눌렀는데 아무 일도 안 일어나는** 상태를 없앤다 (2026-09-11 전수검사).
 *
 * 전환이 거절되면 버튼이 잠깐 흐려졌다 풀리고 화면이 그대로였다 — 사용자는 고장인지 권한인지 알 길이 없다.
 * 거절·실패 모두 한글로 알리고, 거절이면 사이드바를 다시 그려 더는 설 수 없는 버튼을 거둔다.
 * ⚠️ 거절 안내는 **원인을 단정하지 않는다** — 액션의 null은 세션 없음·자격 없음·조회 실패를 가르지 않는다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeacherViewToggle } from "./view-mode-toggle";

const h = vi.hoisted(() => ({
  switchToTeacherView: vi.fn<() => Promise<string | null>>(),
  toastError: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/features/shell/view-actions", () => ({ switchToTeacherView: h.switchToTeacherView }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.switchToTeacherView.mockReset();
  h.toastError.mockReset();
  h.refresh.mockReset();
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  assign.mockRestore();
});

function click() {
  render(<TeacherViewToggle expanded motion={false} />);
  fireEvent.click(screen.getByRole("button", { name: "강사뷰로 전환" }));
}

describe("'강사뷰로 전환' 버튼 — 조용히 멈추지 않는다", () => {
  it("통과하면 착지 경로로 풀 문서 이동 — 알림 없음", async () => {
    h.switchToTeacherView.mockResolvedValue("/ecs");
    click();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/ecs"));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("🔴 거절되면 원인을 단정하지 않는 한글 안내를 띄우고, 사이드바를 다시 그려 버튼을 거둔다", async () => {
    h.switchToTeacherView.mockResolvedValue(null);
    click();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const msg = String(h.toastError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("강사뷰");
    // null은 세션 없음·자격 없음·조회 실패를 가르지 않는다 — 원인을 적으면 틀린 말이 될 수 있다(리뷰 2026-09-11).
    expect(msg).not.toMatch(/담당 반|위임/);
    // 거절 뒤 화면이 이미 다시 그려진다(아래 refresh) — "새로고침하라"고 시키면 누를 버튼이 없는 사람에게 헛된 지시가 된다.
    expect(msg).not.toContain("새로고침");
    expect(msg).toContain("다시 불러왔");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("서버 액션이 실패해도(네트워크 등) 한글로 알린다 — 원문 에러는 화면에 내보내지 않는다", async () => {
    h.switchToTeacherView.mockRejectedValue(new Error("fetch failed"));
    click();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const msg = String(h.toastError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("강사뷰");
    expect(msg).not.toContain("fetch failed");
    expect(assign).not.toHaveBeenCalled();
  });
});
