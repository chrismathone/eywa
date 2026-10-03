import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentReportNotice } from "./sent-report-notice";
import { SENT_NOTICE_KEY, setSentNoticeHidden, useSentNoticeHidden } from "./use-sent-notice";

function Restore() {
  const hidden = useSentNoticeHidden();
  return <button onClick={() => setSentNoticeHidden(false)}>{hidden ? "restore" : "visible"}</button>;
}
beforeEach(() => { localStorage.clear(); setSentNoticeHidden(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); setSentNoticeHidden(false); });

describe("발송 설명 배너의 브라우저별 다시 보지 않기", () => {
  it("숨긴 뒤 다른 날짜·새 마운트에서도 숨기고 설정에서 복구할 수 있다", () => {
    const first = render(<><SentReportNotice count={5} /><Restore /></>);
    fireEvent.click(screen.getByRole("button", { name: "다시 보지 않기" }));
    expect(localStorage.getItem(SENT_NOTICE_KEY)).toBe("1");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "restore" })).toBeTruthy();
    first.unmount();
    render(<><SentReportNotice count={8} /><Restore /></>);
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(screen.getByRole("complementary")).toHaveTextContent("발송 완료 8건");
    expect(localStorage.getItem(SENT_NOTICE_KEY)).toBeNull();
  });
  it("다른 탭의 숨김·저장소 초기화를 반영한다", () => {
    render(<SentReportNotice count={5} />);
    act(() => {
      localStorage.setItem(SENT_NOTICE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: SENT_NOTICE_KEY }));
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(screen.getByRole("complementary")).toBeTruthy();
  });
  it("저장소 접근이 막혀도 화면이 깨지지 않고 현재 창에서 숨기기·복구한다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<><SentReportNotice count={5} /><Restore /></>);
    fireEvent.click(screen.getByRole("button", { name: "다시 보지 않기" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(screen.getByRole("complementary")).toBeTruthy();
  });
  it("발송이 없으면 안내를 그리지 않는다", () => {
    render(<SentReportNotice count={0} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
