import { describe, expect, it } from "vitest";
import {
  ONESCREEN_CARD_FRAME,
  ONESCREEN_CARD_GRID,
  ONESCREEN_EMPTY_SPAN,
  ONESCREEN_PREVIEW_BUTTON,
  ONESCREEN_PREVIEW_DIALOG_SCROLL,
  ONESCREEN_PREVIEW_SLOT,
  ONESCREEN_PREVIEW_WIDTH_PX,
  ONESCREEN_THREE_COL_MIN_PX,
  ONESCREEN_THREE_COL_TRACKS_PX,
  ONESCREEN_TWO_COL_MIN_PX,
} from "./onescreen-card-layout";
import { readOnescreenScreen } from "./onescreen-screen-source.test-util";

// 화면 + 옮겨 낸 훅·가운데 열(P3-O) — 보고서 카드 요소가 화면 전체에서 하나인지 본다.
const client = readOnescreenScreen();

describe("onescreen card layout", () => {
  it("fits two columns at 846 and three only once 1420 clears the 1406 tracks", () => {
    expect(ONESCREEN_TWO_COL_MIN_PX).toBe(846);
    expect(ONESCREEN_THREE_COL_TRACKS_PX).toBe(1406);
    expect(ONESCREEN_PREVIEW_WIDTH_PX).toBe(544);
    expect(ONESCREEN_THREE_COL_MIN_PX).toBeGreaterThanOrEqual(ONESCREEN_THREE_COL_TRACKS_PX);
    expect(ONESCREEN_THREE_COL_MIN_PX).toBe(1420);
  });

  it("switches on the oscard container, not a viewport min-width", () => {
    expect(ONESCREEN_CARD_FRAME.startsWith("@container/oscard")).toBe(true);
    expect(ONESCREEN_CARD_GRID).toContain("@min-[846px]/oscard:grid-cols-[300px_minmax(530px,1fr)]");
    expect(ONESCREEN_CARD_GRID).toContain(
      "@min-[1420px]/oscard:grid-cols-[300px_minmax(530px,1fr)_544px]",
    );
    expect(ONESCREEN_CARD_GRID).not.toContain("min-w-[");
    expect(ONESCREEN_CARD_GRID).toContain("min-w-0");
    expect(ONESCREEN_CARD_GRID).not.toContain("overflow-x");
    expect(ONESCREEN_CARD_FRAME).not.toContain("overflow-x");
    expect(ONESCREEN_PREVIEW_SLOT.startsWith("hidden ")).toBe(true);
    expect(ONESCREEN_CARD_FRAME).toContain("lg:flex-1");
    expect(ONESCREEN_CARD_FRAME).not.toMatch(/(^|\s)flex-1(\s|$)/);
    expect(ONESCREEN_PREVIEW_SLOT).toContain("@min-[1420px]/oscard:block");
    expect(ONESCREEN_PREVIEW_BUTTON).toBe("@min-[1420px]/oscard:hidden");
    expect(ONESCREEN_EMPTY_SPAN).toBe("@min-[1420px]/oscard:col-span-2");
    expect(ONESCREEN_PREVIEW_DIALOG_SCROLL).toContain("overflow-x-auto");
    expect(ONESCREEN_PREVIEW_DIALOG_SCROLL).not.toContain("overflow-x-scroll");
  });

  it("keeps one report card inside the zoom box and duplicates only the preview", () => {
    expect(client.includes("lg:min-w-[1420px]")).toBe(false);
    expect(client.split("<ReportCard").length - 1).toBe(1);
    // 인라인 열, 표 보기 상세(뷰가 카드가 아닐 때만), 좁은 폭 대화상자. 보고서 카드는 한 요소다.
    expect(client.split("renderPreview()").length - 1).toBe(3);
    const frameAt = client.indexOf("className={ONESCREEN_CARD_FRAME}");
    const zoomAt = client.lastIndexOf("zoom: fontZoom", frameAt);
    expect(frameAt).toBeGreaterThan(-1);
    expect(zoomAt).toBeGreaterThan(-1);
    expect(frameAt).toBeGreaterThan(zoomAt);
    expect(client).toContain('t("os.preview.title")');
    expect(client).toContain("setPreviewOpen(false)");
    expect(client).toContain("lg:grid-cols-[minmax(530px,1fr)_544px]");
    expect(client).not.toContain("overflow-x-scroll");
    const scrolls = client.split("overflow-x-auto").length - 1;
    expect(scrolls).toBe(0);
  });
});
