import { describe, expect, it, vi } from "vitest";
import { applyFrameVisibility, effectiveVisibility } from "./frame-visibility";

/** 창 iframe 흉내 — contentWindow·contentDocument만 있으면 된다(부모가 만지는 건 그 둘뿐). */
function fakeFrame(href = "http://localhost:3000/attendance?embed=1") {
  const doc = document.implementation.createHTMLDocument("창");
  const cw = { location: { href }, Document: window.Document, Event: window.Event };
  const frame = {} as HTMLIFrameElement;
  Object.defineProperty(frame, "contentWindow", { value: cw });
  Object.defineProperty(frame, "contentDocument", { value: doc });
  const changes = vi.fn();
  doc.addEventListener("visibilitychange", changes);
  return { frame, doc, changes };
}

describe("effectiveVisibility", () => {
  it("창이 숨었거나 탭이 숨었으면 hidden", () => {
    expect(effectiveVisibility(false, "visible")).toBe("visible");
    expect(effectiveVisibility(true, "visible")).toBe("hidden");
    expect(effectiveVisibility(false, "hidden")).toBe("hidden");
    expect(effectiveVisibility(true, "hidden")).toBe("hidden");
  });
});

describe("applyFrameVisibility — 창 문서의 Page Visibility를 창 단위로", () => {
  it("🔴 숨기면 visibilityState·hidden이 바뀌고 visibilitychange가 한 번 뜬다 — 폴링이 스스로 멈춘다", () => {
    const { frame, doc, changes } = fakeFrame();
    applyFrameVisibility(frame, true);
    expect(doc.visibilityState).toBe("hidden");
    expect(doc.hidden).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("같은 값이면 조용하다(이벤트 폭주 없음) · 다시 보이면 visible + 이벤트", () => {
    const { frame, doc, changes } = fakeFrame();
    applyFrameVisibility(frame, true);
    applyFrameVisibility(frame, true);
    expect(changes).toHaveBeenCalledTimes(1);
    applyFrameVisibility(frame, false);
    expect(doc.visibilityState).toBe("visible");
    expect(doc.hidden).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("처음부터 보이는 창에 '보임'을 걸면 이벤트가 없다(값이 안 바뀌었다)", () => {
    const { frame, changes } = fakeFrame();
    applyFrameVisibility(frame, false);
    expect(changes).not.toHaveBeenCalled();
  });

  it("아직 라우트를 싣기 전(about:blank)엔 손대지 않는다 · 접근 불가 프레임도 조용히", () => {
    const { frame, doc, changes } = fakeFrame("about:blank");
    const before = doc.visibilityState;
    applyFrameVisibility(frame, true);
    expect(doc.visibilityState).toBe(before);
    expect(Object.getOwnPropertyDescriptor(doc, "visibilityState")).toBeUndefined(); // 덮지 않았다
    expect(changes).not.toHaveBeenCalled();

    const blocked = {} as HTMLIFrameElement;
    Object.defineProperty(blocked, "contentWindow", {
      get() {
        throw new Error("cross-origin");
      },
    });
    expect(() => applyFrameVisibility(blocked, true)).not.toThrow();
    expect(() => applyFrameVisibility(null, true)).not.toThrow();
  });
});
