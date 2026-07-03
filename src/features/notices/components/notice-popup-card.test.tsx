import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoticePopupCard } from "./notice-popup-card";
import type { ActivePopup } from "../server/queries";

// React 19 createRoot + act(): act 환경 플래그(테스트 라이브러리 없이 직접 렌더).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POPUP: ActivePopup = {
  id: "test-popup-1",
  title: "테스트 공지",
  body: "본문",
  imageSrc: "http://localhost/test-image.png",
  linkUrl: null,
  linkLabel: null,
  width: 380,
  position: "center",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

const modals = () =>
  [...document.body.children].filter((n) => n.getAttribute?.("aria-modal") === "true");

describe("NoticePopupCard — 이미지 원본 크기 라이트박스", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("썸네일 이미지는 확대 버튼이고, 클릭하면 body 포털에 원본 라이트박스가 열린다", async () => {
    await act(async () => {
      root.render(<NoticePopupCard popup={POPUP} />);
    });

    // 썸네일 = 확대 버튼(같은 w-full 이미지 유지)
    const btn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이미지 원본 크기로 보기"]',
    );
    expect(btn).toBeTruthy();
    const thumb = btn!.querySelector("img");
    expect(thumb?.getAttribute("src")).toBe(POPUP.imageSrc);
    expect(thumb?.className).toContain("w-full"); // 카드 안 썸네일은 그대로 카드폭
    expect(modals()).toHaveLength(0);

    // 클릭 → 라이트박스(body 포털)
    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(modals()).toHaveLength(1);
    const modal = modals()[0] as HTMLElement;
    // happy-dom엔 Tailwind가 없어 computed style 대신 클래스로 검증(fixed 전면 오버레이 + 레이어 z-55 위)
    expect(modal.className).toContain("fixed");
    expect(modal.className).toContain("z-[100]");
    // body 포털이라 레이어 print:hidden 미상속 → 오버레이 자체에 print:hidden(인쇄물 위 오버레이 찍힘 방지)
    expect(modal.className).toContain("print:hidden");
    const big = modal.querySelector("img");
    expect(big?.getAttribute("src")).toBe(POPUP.imageSrc);
    // 화면에 꽉 차게(원본보다 크게 확대 안 함) — max-h/max-w cap + object-contain
    expect(big?.className).toContain("max-h-[92vh]");
    expect(big?.className).toContain("object-contain");
    expect(modal.querySelector('button[aria-label="닫기"]')).toBeTruthy();

    // Esc → 닫힘(useEffect의 window keydown 리스너, 포털 위임과 무관하게 확실)
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(modals()).toHaveLength(0);
  });

  it("이미지가 없는 팝업은 확대 버튼을 렌더하지 않는다", async () => {
    await act(async () => {
      root.render(<NoticePopupCard popup={{ ...POPUP, imageSrc: null }} />);
    });
    expect(
      container.querySelector('button[aria-label="이미지 원본 크기로 보기"]'),
    ).toBeNull();
    expect(modals()).toHaveLength(0);
  });
});
