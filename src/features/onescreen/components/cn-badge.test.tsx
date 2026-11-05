import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { CnBadge } from "./cn-badge";

/**
 * ClassNote 반 매칭 아이콘의 그림 셋(원장 2026-10-06 체크·물음표·회색 → 2026-11-04 *"? 아이콘이 배경없애고 그냥 ? 만 선명하게"*).
 * 판정은 classnote-match.test.ts가 맡고, 여기는 그려진 결과(물음표 글자 · 회색 · 읽어 주는 이름)를 본다.
 */
afterEach(cleanup);

const draw = (label: Parameters<typeof CnBadge>[0]["label"]) => {
  const { container } = render(<CnBadge label={label} />);
  const root = container.querySelector<HTMLElement>("[data-cn-state]");
  return { root, img: container.querySelector("img"), glyph: container.querySelector<HTMLElement>("[data-cn-glyph]"), container };
};

describe("ClassNote 반 매칭 아이콘", () => {
  it("이 반 보드에 배정됨 = 원래 색 그림(체크) — 물음표 없음", () => {
    const { root, img, glyph } = draw({ ok: true, match: { status: "ok", boardName: "B반", childNames: ["지호"], reasons: [] } });
    expect(root?.dataset.cnState).toBe("ok");
    expect(img?.className).not.toContain("grayscale");
    expect(glyph).toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 매칭됨");
  });

  it("🔴 연결은 됐는데 반 배정이 지금 반과 다름 = 노트 그림·원 배경 없이 주의 색 '?' 하나", () => {
    const { root, img, glyph, container } = draw({ ok: false, match: null, elsewhere: ["A반"] });
    expect(root?.dataset.cnState).toBe("mismatch");
    // 그림도 덮개 원도 없다 — 글자 하나.
    expect(img).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(glyph?.textContent).toBe("?");
    for (const cls of TONE_TEXT.caution.split(" ")) expect(glyph?.classList.contains(cls)).toBe(true);
    expect(glyph?.className).not.toMatch(/\bbg-|rounded/);
    // 글자는 꾸밈이다 — 뜻은 이름표가 읽어 준다. 18px 상자(다른 두 그림과 같은 자리).
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(root?.className).toContain("size-4.5");
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 반 배정 확인 필요");
  });

  it("연결 자체가 확인되지 않음 = 회색 그림 — 물음표 없음(종전 그대로)", () => {
    const { root, img, glyph } = draw({ ok: false, match: null });
    expect(root?.dataset.cnState).toBe("none");
    expect(img?.className).toContain("grayscale");
    expect(glyph).toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 매칭 실패");
  });

  it("라벨 대상이 아닌 줄은 아무것도 그리지 않는다", () => {
    expect(draw(null).root).toBeNull();
  });
});
