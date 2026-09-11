import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frame = vi.hoisted(() => ({ inFrame: true }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/help",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));
// 창(iframe) 안에선 데스크톱 판정이 거짓이다(창 안 링크의 기본은 드릴인) — 실제 셸과 같게.
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => !frame.inFrame }));

import { HelpBrowser } from "./_help-browser";

/**
 * 도움말은 스스로 **"메뉴를 누르면 창으로 열립니다"**라고 약속한다 — 그런데 링크가 맨 `<a href>`라
 * 창 안에서 누르면 도움말 창이 통째로 그 메뉴 화면(embed 없음 = 전체 셸)으로 바뀌었다(2026-09-11 전수검사).
 */

const QUICK = [
  { title: "학원 기본 설정하기", desc: "과목·학년을 정합니다.", href: "/owner", hrefLabel: "학원 설정" },
];
const MENUS = [
  { id: "timetable" as const, label: "시간표", href: "/timetable", description: "주간 시간표." },
  { id: "kiosk_settings" as const, label: "출석 키오스크", href: "/kiosk-settings", description: "키오스크." },
  { id: "dashboard" as const, label: "대시보드", href: "/dashboard", description: "배경 화면." },
];

const renderHelp = () => render(<HelpBrowser quickstart={QUICK} menus={MENUS} faq={[]} />);

/** 부모 작업면으로 가는 신호(`eywa-open-window`)를 가로챈다 — 창 안에서 부모 캔버스가 받는 그 메시지. */
const spyPost = () => vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

describe("도움말 메뉴 링크 — 창 안에서 누르면 새 창", () => {
  let post: ReturnType<typeof spyPost>;
  beforeEach(() => {
    frame.inFrame = true;
    post = spyPost();
  });
  afterEach(() => {
    post.mockRestore();
    cleanup();
  });

  const opened = (id: string, href: string) =>
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eywa-open-window", id, href }),
      window.location.origin,
    );

  it("🔴 빠른 시작 링크는 도움말 창을 바꾸지 않고 부모 작업면에 그 메뉴 창을 연다", () => {
    renderHelp();
    const link = screen.getByRole("link", { name: /학원 설정/ });
    expect(fireEvent.click(link)).toBe(false); // 도움말 창 안 이동(드릴인)을 막았다
    opened("owner", "/owner");
    // Ctrl+클릭(새 탭)은 최상위 문서라 창 표식(embed) 없는 원래 주소여야 한다.
    expect(link).toHaveAttribute("href", "/owner");
  });

  it("🔴 메뉴 안내 링크도 — 창 id는 사이드바·메뉴 판과 같은 규칙", () => {
    renderHelp();
    expect(fireEvent.click(screen.getByRole("link", { name: /시간표/ }))).toBe(false);
    opened("timetable", "/timetable");
  });

  it("🔴 사이드바에 없는 키오스크 설정도 제 창으로 연다 — 이 링크가 유일한 입구다", () => {
    renderHelp();
    expect(fireEvent.click(screen.getByRole("link", { name: /출석 키오스크/ }))).toBe(false);
    opened("kiosk-settings", "/kiosk-settings");
  });

  it("🔴 대시보드(이 창 뒤의 배경)는 창 안에서 링크를 걸지 않는다 — 걸면 배경 화면이 도움말 창 안에 뜬다", () => {
    renderHelp();
    expect(screen.getByText("대시보드")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /대시보드/ })).toBeNull();
  });

  it("🔴 창 안 Shift+클릭은 '새 창 한 벌 더' 신호를 싣는다 — 맨 클릭은 이미 떠 있는 창을 쓴다", () => {
    renderHelp();
    fireEvent.click(screen.getByRole("link", { name: /시간표/ }), { shiftKey: true });
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "timetable", newInstance: true }),
      window.location.origin,
    );
    fireEvent.click(screen.getByRole("link", { name: /시간표/ }));
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "timetable", newInstance: false }),
      window.location.origin,
    );
  });

  it("🔴 창으로 여는 링크는 hover 때 **창이 쓸 문서**(embed)를 예열한다 — 안 쓸 전체 셸 문서가 아니라", () => {
    vi.useFakeTimers();
    try {
      renderHelp();
      fireEvent.mouseEnter(screen.getByRole("link", { name: /시간표/ }));
      vi.advanceTimersByTime(200);
      const hrefs = [...document.head.querySelectorAll('link[rel="prefetch"]')].map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("/timetable?embed=1");
      expect(hrefs).not.toContain("/timetable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("최상위 프레임(폰·강사 미니셸) — 그대로 이동하는 링크", () => {
  beforeEach(() => {
    frame.inFrame = false;
  });
  afterEach(cleanup);

  it("링크 주소가 원래 주소 그대로다(창 표식 없음)", () => {
    renderHelp();
    expect(screen.getByRole("link", { name: /시간표/ })).toHaveAttribute("href", "/timetable");
    expect(screen.getByRole("link", { name: /대시보드/ })).toHaveAttribute("href", "/dashboard");
  });
});

describe("구조 — 도움말 안의 앱 화면 링크는 창 규약(WindowLink)을 탄다", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "src/app/(shell)/help", p), "utf8");

  it("🔴 맨 <a href>·next/link로 앱 화면을 걸지 않는다 — 창 안에서 embed가 빠져 전체 셸이 뜬다", () => {
    for (const f of ["_help-browser.tsx", "page.tsx"]) {
      const src = read(f);
      // 페이지 안 목차(#…)·전화(tel:)는 앱 화면이 아니라 괜찮다 — 막는 것은 동적 주소와 `/…` 주소.
      expect(src, f).not.toMatch(/<a\s[^>]*href=(\{|"\/)/);
      expect(src, f).not.toContain('from "next/link"');
    }
  });
});
