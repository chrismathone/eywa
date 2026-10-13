/**
 * 값 일괄 적용의 휴원일 확인(원장 2026-10-13) — 10/9 한글날에 금요일 반 19명이 이 길로 '출석'이 됐다.
 * 휴원일에도 수업하는 날이 있어 막지는 않는다: 출결을 실을 때만 같은 확인창에 한 줄을 더한다.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planBulkAttendance } from "../bulk-attendance";
import { BulkApplyPopover } from "./bulk-apply";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubConfirm(answer: boolean) {
  const ask = vi.fn<(message?: string) => boolean>(() => answer);
  vi.stubGlobal("confirm", ask);
  return ask;
}

const ROWS = ["s1", "s2", "s3"].map((studentId) => ({ studentId, classId: "c1", isMakeup: false, raw: null }));

function open(holidayName: string | null) {
  const onApply = vi.fn();
  render(
    <BulkApplyPopover
      targetCount={3}
      selectedCount={3}
      fields={{ attitudes: [], dailyEnabled: false, checkEnabled: false, allowTestMax: false, videoRows: 0, linkRows: 0, videoCheckRows: 0 }}
      subjects={[]}
      studyGrade=""
      copySource={null}
      attendance={{ plan: (status, onlyEmpty) => planBulkAttendance(ROWS, status, { onlyEmpty }), holidayName }}
      onApply={onApply}
      onCopyFirstRow={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "일괄 입력" }));
  return onApply;
}

describe("값 일괄 적용 — 휴원일 출결 확인", () => {
  it("휴원일에 출결을 실으면 휴일 이름과 칸 수를 묻고, 취소하면 아무것도 적용하지 않는다", () => {
    const confirm = stubConfirm(false);
    const onApply = open("한글날");
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("학원 휴원일(한글날)");
    expect(confirm.mock.calls[0][0]).toContain("출결 3건");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("확인하면 그대로 적용한다 — 휴원일에도 입력은 막지 않는다", () => {
    stubConfirm(true);
    const onApply = open("한글날");
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][3]).toBe("present");
  });

  it("휴원일이 아니면 종전대로 묻지 않는다", () => {
    const confirm = stubConfirm(true);
    const onApply = open(null);
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("휴원일이어도 출결을 싣지 않는 적용(특이사항만)은 묻지 않는다", () => {
    const confirm = stubConfirm(true);
    const onApply = open("한글날");
    fireEvent.change(screen.getByRole("textbox", { name: "일괄 특이사항" }), { target: { value: "메모" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][3]).toBeNull();
  });
});
