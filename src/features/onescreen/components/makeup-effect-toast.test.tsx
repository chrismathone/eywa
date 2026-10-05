import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { notifyMakeupEffect } from "./makeup-effect-toast";

const message = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { message } }));
vi.mock("@/components/embed-link", () => ({ EmbedAnchor: ({ href, children }: { href: string; children: ReactNode }) => <a href={`${href}?embed=1`}>{children}</a> }));
describe("보강 반영 후속 안내", () => {
  it("저장 성공 안내에 복구 링크를 담고 일괄 저장에서도 한 안내를 갱신한다", () => {
    message.mockClear();
    notifyMakeupEffect({ state: "pending", queued: true });
    notifyMakeupEffect({ state: "unknown", queued: false });
    expect(message).toHaveBeenCalledTimes(2);
    const options = message.mock.calls.map(call => call[1]);
    expect(options[0].id).not.toBe(options[1].id);
    notifyMakeupEffect({ state: "unknown", queued: false });
    expect(message.mock.calls[2][1].id).toBe(options[1].id);
    render(options[1].description);
    expect(screen.getByRole("link", { name: "대사·복구 열기" })).toHaveAttribute("href", "/makeups/reconciliation?embed=1");
  });
  it("반영 대기가 없으면 안내하지 않는다", () => {
    message.mockClear();
    notifyMakeupEffect(undefined);
    expect(message).not.toHaveBeenCalled();
  });
});
