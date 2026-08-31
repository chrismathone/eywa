/**
 * 누적 미수 상위 — **몇 월분 미납인지** 라벨(원장 2026-08-31: *"26.08 이런식으로 월미납 붙여놓자"*
 * + *"26.08, 26.09 라벨이 붙는거지 2개월 합산액이면"*).
 * 이 카드 금액은 전 기간 합산이라, 달이 없으면 이번 달치로 읽힌다(실측: 윤나연 81.8만 = 3월+4월).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OutstandingCard } from "./outstanding-card";
import type { OutstandingItem } from "@/features/dashboard/server/queries";

afterEach(cleanup);

const item = (p: Partial<OutstandingItem> = {}): OutstandingItem => ({
  studentId: "s1",
  studentName: "윤나연",
  amount: 410500,
  status: "unpaid",
  periods: ["2026-03", "2026-04"],
  ...p,
});

describe("OutstandingCard — 월 라벨", () => {
  it("2개월 합산이면 두 달이 다 붙는다", () => {
    render(<OutstandingCard items={[item()]} canOpenStudents={false} />);
    expect(screen.getByText("26.03·26.04")).toBeTruthy();
    expect(screen.getByText("미납")).toBeTruthy();
  });

  it("한 달이면 그 달만", () => {
    render(<OutstandingCard items={[item({ periods: ["2026-09"] })]} canOpenStudents={false} />);
    expect(screen.getByText("26.09")).toBeTruthy();
  });

  it("석 달 이상은 두 개만 적고 나머지는 접는다(칸이 좁다)", () => {
    render(
      <OutstandingCard
        items={[item({ periods: ["2026-03", "2026-04", "2026-05"] })]}
        canOpenStudents={false}
      />,
    );
    expect(screen.getByText("26.03·26.04 외 1")).toBeTruthy();
  });

  it("🔴 달을 모르면 라벨을 만들지 않는다(빈 칸이지 거짓말이 아니다)", () => {
    render(<OutstandingCard items={[item({ periods: [] })]} canOpenStudents={false} />);
    expect(screen.queryByText(/^\d{2}\.\d{2}/)).toBeNull();
    expect(screen.getByText("미납")).toBeTruthy(); // 금액·상태는 그대로 뜬다
  });
});
