import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/timetable" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const frame = vi.hoisted(() => ({ inFrame: false }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));
const save = vi.hoisted(() => vi.fn<(on: unknown) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })));
vi.mock("@/features/page-maximize/server/actions", () => ({ setMyPageMaximized: save }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import type React from "react";
import { PageHeader, PageHeaderSkeleton } from "@/components/page-header";
import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { PageMaximizeRoot } from "./page-maximize-root";
import { PageMaximizeFallbackBar } from "./page-maximize-button";

/**
 * 화면 최대화(원장 2026-10-01) — 같은 자리 토글 · 표식 · 저장 · 출구 보장.
 * 원장 *"화면 최대화 버튼과 최소화 버튼을 같은 위치에 놔둬야지 이거 위치 못찾겠는데? 그리고 파란색으로 버튼하고. 헤더 우측에 끼워넣어"*.
 * 숨기는 일은 CSS(globals.css)라 여기선 표식(`data-page-maximize`)·버튼·저장 호출을 본다(CSS 배선은 wiring 테스트).
 */
function Shell({
  windowMode = false,
  initial = false,
  actions,
  header = true,
}: {
  windowMode?: boolean;
  initial?: boolean;
  actions?: React.ReactNode;
  header?: boolean;
}) {
  return (
    <WorkspaceEnabledProvider enabled={windowMode}>
      <PageMaximizeRoot initial={initial}>
        <PageMaximizeFallbackBar />
        <main>{header ? <PageHeader eyebrow="수업 운영" title="시간표" description="수학 주간표" actions={actions} /> : <h1>자체 머리</h1>}</main>
      </PageMaximizeRoot>
    </WorkspaceEnabledProvider>
  );
}
const marker = (c: HTMLElement) => c.querySelector("[data-page-maximize]")?.getAttribute("data-page-maximize");
const toggles = (c: HTMLElement) => c.querySelectorAll("[data-page-maximize-toggle]");
/** 머리글의 토글 — 최대화 중엔 출구 줄도 DOM에 있어(머리글이 있으면 CSS가 끈다) 이름만으로는 둘이 잡힌다. */
const headerToggle = (name: string) => within(document.querySelector("header")!).getByRole("button", { name });

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ ok: true });
  toastError.mockReset();
  frame.inFrame = false;
  nav.pathname = "/timetable";
});
afterEach(() => vi.restoreAllMocks());

describe("버튼이 서는 곳", () => {
  it("창 모드가 꺼진 관리자 풀셸 = 머리글 오른쪽 끝에 파란 '화면 최대화'(데스크톱에서만 · 인쇄 안 됨)", () => {
    render(<Shell actions={<button type="button">편집</button>} />);
    const btn = screen.getByRole("button", { name: "화면 최대화" });
    expect(btn.className).toContain("bg-primary"); // 공용 <Button> 기본 = primary 파랑
    expect(btn.className).not.toContain("bg-transparent");
    expect(btn.className).toContain("h-(--control-h)"); // 머리글 동작 버튼과 같은 기본 높이(sm 아님)
    expect(btn.className).toContain("hidden");
    expect(btn.className).toContain("desk:inline-flex"); // 모바일 셸(좁은 폭·터치)에선 CSS가 숨긴다
    expect(btn.className).toContain("print:hidden");
    // 오른쪽 끝 = 동작들 뒤
    const right = btn.parentElement!;
    expect(right.lastElementChild).toBe(btn);
    expect(right.textContent).toBe("편집화면 최대화");
  });

  it("창 모드가 켜진 지점엔 없다 — 플로팅 창마다 제 최대화가 있다(저장값이 켜져 있어도 무시)", () => {
    const { container } = render(<Shell windowMode initial />);
    expect(toggles(container)).toHaveLength(0);
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
    const { container } = render(<Shell initial />);
    expect(toggles(container)).toHaveLength(0);
  });

  it("헤더 스켈레톤(loading)에도 같은 자리에 선다 — 로딩 동안 출구가 사라지거나 출구 줄이 깜빡이지 않게", () => {
    const { container } = render(
      <WorkspaceEnabledProvider enabled={false}>
        <PageMaximizeRoot initial>
          <PageHeaderSkeleton actions={<div className="h-8 w-20" />} />
        </PageMaximizeRoot>
      </WorkspaceEnabledProvider>,
    );
    const btn = screen.getByRole("button", { name: "화면 원래대로" });
    expect(btn.hasAttribute("data-page-maximize-button")).toBe(true);
    expect(container.querySelector("header")!.hasAttribute("aria-hidden")).toBe(false); // 누를 수 있는 버튼을 aria-hidden에 가두지 않는다
  });
});

describe("같은 자리 토글 — '화면 최대화' ↔ '화면 원래대로'", () => {
  it("누르면 표식이 켜지고 계정에 저장 · **같은 버튼**이 '화면 원래대로'가 되어 머리글 줄에 남는다", async () => {
    const { container } = render(<Shell />);
    expect(marker(container)).toBe("off");
    const btn = screen.getByRole("button", { name: "화면 최대화" });
    fireEvent.click(btn);
    expect(marker(container)).toBe("on");
    await waitFor(() => expect(save).toHaveBeenCalledWith(true));
    const restore = headerToggle("화면 원래대로");
    expect(restore).toBe(btn); // 같은 DOM 요소 — 자리가 그대로다
    expect(restore.className).toContain("bg-primary"); // 두 상태 모두 파랑
    expect(restore.closest("[data-page-header-row]")).not.toBeNull(); // 머리글 줄 안
    expect(restore.className).not.toContain("fixed"); // 떠 있는 모서리 버튼은 없다
    // 출구 줄은 DOM엔 있어도 머리글 버튼 표식이 있어 CSS가 끈다(아래 '출구 보장')
    expect(container.querySelector("[data-page-maximize] [data-page-maximize-button]")).toBe(btn);
    fireEvent.click(restore);
    expect(marker(container)).toBe("off");
    expect(screen.getByRole("button", { name: "화면 최대화" })).toBe(btn);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(false));
  });

  it("메뉴를 옮겨도(주소가 바뀌어도) 최대화는 그대로다", () => {
    const { container, rerender } = render(<Shell initial />);
    expect(marker(container)).toBe("on");
    nav.pathname = "/students";
    rerender(<Shell initial />);
    expect(marker(container)).toBe("on");
    expect(headerToggle("화면 원래대로")).toBeTruthy();
  });

  it("빠르게 두 번 눌러도 누른 순서대로 저장한다(나중 값이 이긴다)", async () => {
    let release!: () => void;
    save.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "화면 최대화" }));
    fireEvent.click(headerToggle("화면 원래대로"));
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
    expect(html).not.toContain("화면 최대화");
    const off = renderToString(<Shell />);
    expect(off).toContain('data-page-maximize="off"');
    expect(off).toContain("화면 최대화");
    expect(off).not.toContain("data-maximize-fallback");
  });
});

describe("🔴 출구 보장 — PageHeader가 없는 화면", () => {
  it("최대화 중이면 본문 위 출구 줄에 같은 파란 '화면 원래대로'가 선다(머리글 버튼 표식은 없다 — CSS가 머리글 유무로 켜고 끈다)", async () => {
    const { container } = render(<Shell initial header={false} />);
    const bar = container.querySelector("[data-maximize-fallback]")!;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("hidden"); // 데스크톱 최대화 CSS만 켠다(모바일·인쇄엔 안 선다)
    expect(bar.className).toContain("print:hidden");
    expect(bar.hasAttribute("data-usage-chrome")).toBe(true);
    const restore = screen.getByRole("button", { name: "화면 원래대로" });
    expect(restore.className).toContain("bg-primary");
    expect(restore.hasAttribute("data-page-maximize-button")).toBe(false);
    fireEvent.click(restore);
    expect(marker(container)).toBe("off");
    expect(container.querySelector("[data-maximize-fallback]")).toBeNull();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(false));
  });

  it("최대화가 아니면 출구 줄은 DOM에도 없다", () => {
    const { container } = render(<Shell header={false} />);
    expect(container.querySelector("[data-maximize-fallback]")).toBeNull();
  });

  it("머리글이 있는 화면에선 출구 줄이 DOM엔 있어도 머리글 버튼 표식이 있어 CSS가 끈다", () => {
    const { container } = render(<Shell initial />);
    expect(container.querySelector("[data-maximize-fallback]")).not.toBeNull();
    expect(container.querySelector("[data-page-maximize] [data-page-maximize-button]")).not.toBeNull();
  });
});

describe("전환 뒤처리", () => {
  it("창 크기 이벤트를 한 번 쏘고(행 수를 창 높이로 정하는 목록), 포커스는 누른 그 버튼에 남는다", async () => {
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    try {
      render(<Shell />);
      const btn = screen.getByRole("button", { name: "화면 최대화" });
      fireEvent.click(btn);
      await waitFor(() => expect(resized).toHaveBeenCalled());
      await waitFor(() => expect(document.activeElement).toBe(btn));
      resized.mockClear();
      fireEvent.click(btn);
      await waitFor(() => expect(resized).toHaveBeenCalled());
      expect(document.activeElement).toBe(btn);
      expect(btn.textContent).toContain("화면 최대화");
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

describe("최대화 중 머리글 모양 — 숨는 조각 표식", () => {
  it("eyebrow·구분자·설명만 `data-page-header-extra`(숨김) — 제목·동작·버튼은 표식이 없어 남는다", () => {
    const { container } = render(<Shell initial actions={<button type="button">날짜 이동</button>} />);
    const extras = [...container.querySelectorAll("[data-page-header-extra]")].map((e) => e.textContent);
    expect(extras).toEqual(["수업", "-", "-수학 주간표", "-"]);
    const heading = screen.getByRole("heading", { name: "시간표" });
    expect(heading.closest("[data-page-header-extra]")).toBeNull();
    expect(screen.getByRole("button", { name: "날짜 이동" }).closest("[data-page-header-extra]")).toBeNull();
    expect(headerToggle("화면 원래대로").closest("[data-page-header-extra]")).toBeNull();
    // 머리글은 동작 유무와 상관없이 한 표식(옛 bare/tools 구분 없음 — 통째로 숨는 머리글이 없다)
    expect(container.querySelector("header")!.getAttribute("data-page-header")).toBe("");
  });
});
