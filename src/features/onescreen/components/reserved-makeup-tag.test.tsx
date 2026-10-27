import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservedMakeupTag } from "./reserved-makeup-tag";

/** 원장 2026-10-27 — 권민서A(BS2P 정규 16:20~18:10 뒤 18:20~19:15 보강)가 16:24 출석에 '보강 완료'로 보였다. */
const minseo = [{ start: "18:20", end: "19:15", absenceDate: "2026-10-02", mode: "merge" as const, done: true, date: "2026-10-27" }];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderAt(utc: string, list = minseo) {
  vi.setSystemTime(new Date(utc));
  render(<ReservedMakeupTag list={list} />);
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
}

describe("ReservedMakeupTag — 끝 시각 전엔 '보강 예약'", () => {
  it("🔴 16:24 KST(이행됨 · 끝 전) = '보강 예약' + 시수 미리 반영 안내", async () => {
    await renderAt("2026-10-27T07:24:00Z");
    const tag = screen.getByText("보강 예약 18:20~19:15");
    expect(tag.getAttribute("title")).toContain("미리 반영");
  });

  it("같은 16:24에 정규 앞 보강(박지호 15:25~16:20)은 이미 끝나 '보강 완료' — 시계가 실제로 돈다", async () => {
    await renderAt("2026-10-27T07:24:00Z", [{ ...minseo[0]!, start: "15:25", end: "16:20" }]);
    expect(screen.getByText("보강 완료 15:25~16:20")).toBeTruthy();
  });

  it("19:20 KST(끝 뒤) = '보강 완료' · 안내 없음", async () => {
    await renderAt("2026-10-27T10:20:00Z");
    const tag = screen.getByText("보강 완료 18:20~19:15");
    expect(tag.getAttribute("title")).not.toContain("미리 반영");
  });

  it("빈 목록이면 아무것도 그리지 않는다", () => {
    const { container } = render(<ReservedMakeupTag list={[]} />);
    expect(container.textContent).toBe("");
  });
});
