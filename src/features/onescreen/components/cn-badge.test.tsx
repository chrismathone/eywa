import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CnBadge } from "./cn-badge";

/**
 * ClassNote 반 매칭 아이콘의 그림 셋(원장 2026-10-06 *"활성화는 체크, 반배정 오류는 ? 오버레이"*).
 * 판정은 classnote-match.test.ts가 맡고, 여기는 그려진 결과(물음표 덮개 · 회색 · 읽어 주는 이름)를 본다.
 */
afterEach(cleanup);

const draw = (label: Parameters<typeof CnBadge>[0]["label"]) => {
  const { container } = render(<CnBadge label={label} />);
  const root = container.querySelector<HTMLElement>("[data-cn-state]");
  return { root, img: container.querySelector("img"), overlay: container.querySelector<HTMLElement>("[data-cn-overlay]") };
};

describe("ClassNote 반 매칭 아이콘", () => {
  it("이 반 보드에 배정됨 = 원래 색 그림(체크) — 덮개 없음", () => {
    const { root, img, overlay } = draw({ ok: true, match: { status: "ok", boardName: "B반", childNames: ["지호"], reasons: [] } });
    expect(root?.dataset.cnState).toBe("ok");
    expect(img?.className).not.toContain("grayscale");
    expect(overlay).toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 매칭됨");
  });

  it("🔴 연결은 됐는데 반 배정이 지금 반과 다름 = 원래 색 그림 위에 물음표 덮개", () => {
    const { root, img, overlay } = draw({ ok: false, match: null, elsewhere: ["A반"] });
    expect(root?.dataset.cnState).toBe("mismatch");
    expect(img?.className).not.toContain("grayscale");
    expect(overlay).not.toBeNull();
    // 덮개는 꾸밈이다 — 뜻은 이름표가 읽어 준다. 마우스를 가로채지 않는다(카드는 바깥 요소가 띄운다).
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.getAttribute("class")).toContain("pointer-events-none");
    // 물음표는 아이콘 한 벌의 글리프다(이 파일에 svg를 직접 그리지 않는다 — 아이콘 가드).
    expect(overlay?.querySelector('[data-aywa-icon="help"]')).not.toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 반 배정 확인 필요");
  });

  it("연결 자체가 확인되지 않음 = 회색 그림 — 덮개 없음(종전 그대로)", () => {
    const { root, img, overlay } = draw({ ok: false, match: null });
    expect(root?.dataset.cnState).toBe("none");
    expect(img?.className).toContain("grayscale");
    expect(overlay).toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("ClassNote 반 매칭 · 매칭 실패");
  });

  it("라벨 대상이 아닌 줄은 아무것도 그리지 않는다", () => {
    expect(draw(null).root).toBeNull();
  });
});
