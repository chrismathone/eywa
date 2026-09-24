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

  // 🔴 본문 글자는 **설명서**로 간다(실제 화면이 아니라) — 읽던 사람을 업무 화면으로 튕기지 않는다.
  // 실제 화면은 목록의 `↗`와 설명서 머리의 '이 화면 열기'가 맡는다. 09-15에 한 번 화면으로 보냈다가 되돌렸다.
  it("본문의 화면 이름은 그 화면의 설명서로 간다", () => {
    render(
      <HelpAllowProvider slugs={["timetable"]}>
        <HelpFaq items={FAQ} />
      </HelpAllowProvider>,
    );
    fireEvent.click(screen.getByText("시간표는 어디서 보나요?"));
    const link = screen.getByRole("link", { name: "시간표" });
    // `?embed=1`은 창 안 이동이 셸을 다시 끌고 오지 않게 하는 안전망이다([[#133]]) — 떨어지면 안 된다.
    expect(link).toHaveAttribute("href", "/help/timetable?embed=1");
    // 🔴 실제로 되돌림을 잠그는 건 **위 href 단언 하나**다. `frameTarget="window"`를 다시 붙이면
    // `opensWindowFromFrame`이 true가 되어 `?embed=1`이 떨어지므로 그 줄이 깨진다.
    // ⚠️ "창을 새로 열지 않는다"를 postMessage 음성 단언으로 적지 말 것 — 이 환경은 `useIsDesktop=false`라
    //    postMessage가 **애초에 한 번도 안 불린다**. 무엇을 넣어도 통과하는 공허한 단언이 된다(적대적 리뷰 2026-09-15).
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
      // 별도 탭에 여는 인쇄 문서는 창 안 업무 화면 탐색과 관계없다.
      expect(src, f).not.toMatch(/<Link\s+href="\/(?!print\/)/);
    }
  });

  // 🔴 09-15 오전엔 이 라우트를 걷었다가 같은 날 원장 지시로 되살렸다(*"현재 도움말 탭을 고도화하는게 좋을듯"*).
  // 목록이 제목을 누르면 여기로 온다 — 다시 걷으면 목록의 링크가 전부 죽는다.
  it("화면별 설명서 라우트 `/help/[slug]` 가 있다", () => {
    expect(existsSync(join(process.cwd(), "src/app/(shell)/help/[slug]/page.tsx"))).toBe(true);
  });

  it("허브에 F1 겹침 키가 있다", () => {
    expect(read("page.tsx")).toContain('helpAttr("help-search")');
    expect(read("page.tsx")).toContain('helpAttr("help-icons")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-faq")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-f1")');
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-board")');
    // 설명서 목록 구역(2026-09-15 되살림) — 빠지면 그 구역만 F1 번호가 안 선다.
    expect(read("_help-browser.tsx")).toContain('helpAttr("help-guides")');
  });
});
