import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/timetable" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
const frame = vi.hoisted(() => ({ inFrame: false }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));
const save = vi.hoisted(() => vi.fn<(on: unknown) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })));
vi.mock("@/features/page-maximize/server/actions", () => ({ setMyPageMaximized: save }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
// 메뉴 제목 개명은 이 테스트의 관심 밖(내비 설정 공급자가 필요하다) — 받은 제목 그대로.
vi.mock("@/features/owner/menu-page-title", () => ({ MenuPageTitle: ({ title }: { title: string }) => title }));

import type React from "react";
import { PageHeader } from "@/components/page-header";
import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { PageMaximizeRoot } from "./page-maximize-root";

/**
 * 화면 최대화(원장 2026-10-01) — 버튼이 서는 곳 · 표식 · 저장 · '화면 원래대로'로만 해제.
 * 숨기는 일은 CSS(globals.css)라 여기선 표식(`data-page-maximize`)과 버튼·저장 호출을 본다(CSS 배선은 wiring 테스트).
 */
function Shell({ windowMode = false, initial = false, actions }: { windowMode?: boolean; initial?: boolean; actions?: React.ReactNode }) {
  return (
    <WorkspaceEnabledProvider enabled={windowMode}>
      <PageMaximizeRoot initial={initial}>
        <PageHeader eyebrow="수업 운영" title="시간표" description="수학 주간표" actions={actions} />
      </PageMaximizeRoot>
    </WorkspaceEnabledProvider>
  );
}
const marker = (c: HTMLElement) => c.querySelector("[data-page-maximize]")?.getAttribute("data-page-maximize");

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ ok: true });
  toastError.mockReset();
  frame.inFrame = false;
  nav.pathname = "/timetable";
});
afterEach(() => vi.restoreAllMocks());

describe("화면 최대화 버튼이 서는 곳", () => {
  it("창 모드가 꺼진 관리자 풀셸 = 헤더 오른쪽에 '화면 최대화'(데스크톱에서만 보이게 CSS)", () => {
    render(<Shell />);
    const btn = screen.getByRole("button", { name: "화면 최대화" });
    expect(btn.className).toContain("hidden");
    expect(btn.className).toContain("desk:inline-flex"); // 모바일 셸(좁은 폭·터치)에선 CSS가 숨긴다
  });

  it("창 모드가 켜진 지점엔 없다 — 플로팅 창마다 제 최대화가 있다(저장값이 켜져 있어도 무시)", () => {
    const { container } = render(<Shell windowMode initial />);
    expect(screen.queryByRole("button", { name: "화면 최대화" })).toBeNull();
    expect(screen.queryByRole("button", { name: "화면 원래대로" })).toBeNull();
    expect(marker(container)).toBe("off");
  });

  it("공급자가 없는 셸(창 안·강사 미니셸·슈퍼관리자)엔 없다 — 오른쪽 빈 칸도 남지 않는다(empty:hidden)", () => {
    const { container } = render(<PageHeader eyebrow="수업 운영" title="시간표" description="수학 주간표" />);
    expect(screen.queryByRole("button", { name: "화면 최대화" })).toBeNull();
    const right = container.querySelector("[data-page-header-row] > div:last-child");
    expect(right?.childElementCount).toBe(0);
    expect(right?.className).toContain("empty:hidden");
  });

  it("창(iframe) 안으로 풀셸이 새어 들어와도 없다", () => {
    frame.inFrame = true;
    render(<Shell />);
    expect(screen.queryByRole("button", { name: "화면 최대화" })).toBeNull();
  });
});

describe("최대화 → 원래대로", () => {
  it("누르면 표식이 켜지고 계정에 저장 · '화면 원래대로'를 눌러야만 돌아온다", async () => {
    const { container } = render(<Shell />);
    expect(marker(container)).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: "화면 최대화" }));
    expect(marker(container)).toBe("on");
    await waitFor(() => expect(save).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("button", { name: "화면 최대화" })).toBeNull(); // 최대화 중엔 헤더 줄에 끼지 않는다
    const restore = screen.getByRole("button", { name: "화면 원래대로" });
    expect(restore.className).toContain("fixed");
    expect(restore.className).toContain("desk:inline-flex");
    fireEvent.click(restore);
    expect(marker(container)).toBe("off");
    expect(screen.queryByRole("button", { name: "화면 원래대로" })).toBeNull();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(false));
  });

  it("메뉴를 옮겨도(주소가 바뀌어도) 최대화는 그대로다", () => {
    const { container, rerender } = render(<Shell initial />);
    expect(marker(container)).toBe("on");
    nav.pathname = "/students";
    rerender(<Shell initial />);
    expect(marker(container)).toBe("on");
    expect(screen.getByRole("button", { name: "화면 원래대로" })).toBeTruthy();
  });

  it("빠르게 두 번 눌러도 누른 순서대로 저장한다(나중 값이 이긴다)", async () => {
    let release!: () => void;
    save.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "화면 최대화" }));
    fireEvent.click(screen.getByRole("button", { name: "화면 원래대로" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => release());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("저장이 실패하면 한글로 알린다(화면은 누른 대로)", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "x" });
    const { container } = render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "화면 최대화" }));
    expect(marker(container)).toBe("on");
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain("저장하지 못했습니다");
  });

  it("🔴 첫 HTML부터 정해진다 — 서버가 켜짐을 넘기면 서버 렌더에 표식·'화면 원래대로'가 이미 있다(깜빡임 없음)", () => {
    const html = renderToString(<Shell initial />);
    expect(html).toContain('data-page-maximize="on"');
    expect(html).toContain("화면 원래대로");
    const off = renderToString(<Shell />);
    expect(off).toContain('data-page-maximize="off"');
    expect(off).toContain("화면 최대화");
  });
});

describe("전환 뒤처리", () => {
  it("창 크기 이벤트를 한 번 쏘고(행 수를 창 높이로 정하는 목록), 포커스를 반대쪽 버튼으로 옮긴다", async () => {
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    try {
      render(<Shell />);
      fireEvent.click(screen.getByRole("button", { name: "화면 최대화" }));
      await waitFor(() => expect(resized).toHaveBeenCalled());
      await waitFor(() => expect(document.activeElement?.textContent).toContain("화면 원래대로"));
      resized.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "화면 원래대로" }));
      await waitFor(() => expect(resized).toHaveBeenCalled());
      await waitFor(() => expect(document.activeElement?.textContent).toContain("화면 최대화"));
    } finally {
      window.removeEventListener("resize", resized);
    }
  });

  it("서버 초기값으로 켜진 첫 렌더에선 아무것도 쏘지 않는다(사람이 누른 전환만)", async () => {
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    try {
      render(<Shell initial />);
      await new Promise((r) => setTimeout(r, 50));
      expect(resized).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("resize", resized);
    }
  });
});

describe("'화면 원래대로' 자리 — 밑에 누를 것이 있으면 비킨다", () => {
  it("오른쪽 위 밑에 버튼(시간표 '편집')이 있으면 오른쪽 아래로", async () => {
    const edit = document.createElement("button");
    edit.textContent = "편집";
    document.body.appendChild(edit);
    const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const original = document.elementsFromPoint;
    const originalOne = document.elementFromPoint;
    document.elementsFromPoint = (_x: number, y: number) => (y < 100 ? [edit] : [document.body]);
    // 버튼 위에 아무것도 없다(맨 위 = 버튼 자신)
    document.elementFromPoint = () => document.querySelector("[data-maximize-restore]");
    try {
      render(<Shell initial />);
      const restore = screen.getByRole("button", { name: "화면 원래대로" });
      await waitFor(() => expect(restore.getAttribute("data-corner")).toBe("bottom-right"));
    } finally {
      document.elementsFromPoint = original;
      document.elementFromPoint = originalOne;
      rects.mockRestore();
      edit.remove();
    }
  });

  it("다이얼로그 배경이 버튼을 덮고 있으면 재지 않는다 — 덮인 동안 오른쪽 위로 돌아갔다가 닫힌 뒤 '편집'을 가리지 않게", async () => {
    const backdrop = document.createElement("div");
    document.body.appendChild(backdrop);
    const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const original = document.elementsFromPoint;
    const originalOne = document.elementFromPoint;
    const probe = vi.fn(() => [document.body]);
    document.elementsFromPoint = probe;
    document.elementFromPoint = () => backdrop;
    try {
      render(<Shell initial />);
      await new Promise((r) => setTimeout(r, 100));
      expect(probe).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "화면 원래대로" }).getAttribute("data-corner")).toBe("top-right");
    } finally {
      document.elementsFromPoint = original;
      document.elementFromPoint = originalOne;
      rects.mockRestore();
      backdrop.remove();
    }
  });
});

describe("한 줄 헤더(원장 2026-10-01 *\"3행이 아니라 1행으로\"*)", () => {
  it("eyebrow - 제목 - 설명이 한 줄(같은 줄 상자)에 선다 · 구분자는 뒤 항목과 한 덩어리(줄 끝에 홀로 남지 않게)", () => {
    const { container } = render(<Shell />);
    const title = container.querySelector("[data-page-header-title]")!;
    expect(title.className).toContain("flex-wrap");
    expect(title.textContent).toBe("수업 운영-시간표-수학 주간표");
    expect(title.querySelectorAll("[aria-hidden]")).toHaveLength(2); // 구분자 둘은 읽지 않는다
    const heading = screen.getByRole("heading", { name: "시간표" });
    expect(heading.parentElement!.textContent).toBe("-시간표");
  });

  it("최대화 표식: 동작·스탯이 없으면 bare(통째로 숨음), 있으면 tools(제목만 숨고 동작은 남는다)", () => {
    const { container, unmount } = render(<Shell />);
    expect(container.querySelector("header")!.getAttribute("data-page-header")).toBe("bare");
    unmount();
    const withActions = render(<Shell actions={<button type="button">날짜 이동</button>} />);
    expect(withActions.container.querySelector("header")!.getAttribute("data-page-header")).toBe("tools");
  });
});
