import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frame = vi.hoisted(() => ({ inFrame: true }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/help",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => !frame.inFrame }));

import { HelpFaq } from "./_help-browser";
import { HelpAllowProvider } from "./_components/help-text";

const FAQ = [{ q: "시간표는 어디서 보나요?", a: "[[timetable|시간표]]에서 봅니다." }];

describe("도움말 FAQ 링크 — 창 안에서 누르면 새 창", () => {
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    frame.inFrame = true;
    post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  });
  afterEach(() => {
    post.mockRestore();
    cleanup();
  });

  it("본문의 화면 이름은 부모 작업면에 그 메뉴 창을 연다", () => {
    render(
      <HelpAllowProvider slugs={["timetable"]}>
        <HelpFaq items={FAQ} />
      </HelpAllowProvider>,
    );
    fireEvent.click(screen.getByText("시간표는 어디서 보나요?"));
    const link = screen.getByRole("link", { name: "시간표" });
    expect(link).toHaveAttribute("href", "/timetable");
    expect(fireEvent.click(link)).toBe(false);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eywa-open-window", id: "timetable", href: "/timetable" }),
      window.location.origin,
    );
  });
});

describe("구조 — 도움말 안의 앱 화면 링크는 창 규약(WindowLink)을 탄다", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "src/app/(shell)/help", p), "utf8");

  it("🔴 맨 <a href>·next/link로 앱 화면을 걸지 않는다", () => {
    for (const f of [
      "_help-browser.tsx",
      "page.tsx",
      "posts/[id]/page.tsx",
      "_components/help-text.tsx",
      "_components/post-form.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/<a\s[^>]*href=(\{|"\/)/);
      expect(src, f).not.toContain('from "next/link"');
    }
  });

  it("화면별 설명서 라우트 `/help/[slug]` 는 걷었다", () => {
    expect(existsSync(join(process.cwd(), "src/app/(shell)/help/[slug]/page.tsx"))).toBe(false);
  });

  it("허브에 F1 겹침 키가 있다", () => {
    expect(read("page.tsx")).toContain('helpAttr("help-search")');
    expect(read("page.tsx")).toContain('helpAttr("help-icons")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-faq")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-f1")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-board")');
  });
});
