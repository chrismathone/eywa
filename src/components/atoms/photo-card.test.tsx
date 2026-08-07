import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoCard } from "./photo-card";

// next/image는 이 테스트의 관심사가 아니다(폭 규약만 본다) — 최적화 파이프라인 대신 <img>로.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- next/image 대역(mock)이라 최적화 규칙 대상 아님
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

afterEach(cleanup);

const fig = (c: HTMLElement) => c.querySelector("figure")!;

describe("PhotoCard — 폭 규약", () => {
  // 🔴 `w-full`이 빠지면 조용히 옆 칸을 덮는다. `aspect-ratio` 박스는 grid/flex 아이템일 때
  // `justify-self:normal`이 **start**로 동작해, 높이가 정해지면(호출부 `h-full` + `items-stretch`)
  // 폭을 높이×비율로 되계산한다 — 2026-08-07 실측 658px 열에 926px(우측 목록 253px 가림).
  // happy-dom엔 레이아웃 엔진이 없어 폭을 잴 수 없으므로 **클래스 존재**로 잠근다.
  it("figure는 항상 w-full — 없으면 높이가 정해진 칸에서 폭이 열을 넘는다", () => {
    const { container } = render(<PhotoCard src="/photos/x.webp" alt="" sizes="100vw" />);
    expect(fig(container).className.split(/\s+/)).toContain("w-full");
  });

  it("호출부 className은 뒤에 덧붙는다(높이 지정 등) — 기본 규약을 지우지 않는다", () => {
    const { container } = render(
      <PhotoCard src="/photos/x.webp" alt="" sizes="100vw" className="h-40 lg:h-full" />,
    );
    const cls = fig(container).className.split(/\s+/);
    expect(cls).toContain("w-full");
    expect(cls).toEqual(expect.arrayContaining(["h-40", "lg:h-full"]));
  });

  it("aspect는 폴백으로 남는다 — 높이를 안 주는 호출부에선 이 비율이 높이를 만든다", () => {
    const { container } = render(<PhotoCard src="/photos/x.webp" alt="" sizes="100vw" aspect="21/9" />);
    // 브라우저가 값을 정규화("21/9" → "21 / 9")하므로 공백을 지우고 비교한다.
    expect(fig(container).style.aspectRatio.replace(/\s/g, "")).toBe("21/9");
  });

  it("caption이 없으면 오버레이 자체를 그리지 않는다(순수 사진)", () => {
    const { container } = render(<PhotoCard src="/photos/x.webp" alt="" sizes="100vw" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
