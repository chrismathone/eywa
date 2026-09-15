import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { tipText } from "@/components/hover-tip/tip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceCheck } from "./attendance-check";

/**
 * 원장 2026-08-18: *"영어 강사 시트에도 지각/결석 팝업 시에 **시간 혹은 사유 적는 란**(수학처럼)"*.
 *
 * 지켜야 할 계약 넷:
 *  ① 지각·결석을 고르면 사유 폼이 **따라 열린다**(출석·선택 안 함은 안 연다).
 *  ② 상태는 **창이 뜨기 전에 이미 저장**된다 = 안 적고 넘어가도 기록은 남는다(필수 입력 아님).
 *  ③ 이미 적힌 사유는 **채워서** 연다(빈칸으로 열면 저장 시 조용히 지워진다).
 *  ④ 수정 기간(7일)이 지나도 **사유는** 고칠 수 있다(서버 `noteOnly` 면제를 화면이 막지 않는다).
 */
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const base = {
  studentName: "김학생",
  canMark: true,
  onSet: vi.fn(),
  onClear: vi.fn(),
  onNote: vi.fn(),
};

/** 사유 폼이 떠 있나 — 수학(원스크린)과 같은 폼이라 라벨도 같은 낱말이다. */
const noteBox = () => screen.queryByPlaceholderText(/학원버스 지연/);

describe("ECS 출결 체크 — 지각·결석 사유 창", () => {
  it("① 기록 없음 → 클릭(=출석)은 사유 창을 열지 않는다", () => {
    const onSet = vi.fn();
    render(<AttendanceCheck {...base} status={null} note={null} onSet={onSet} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSet).toHaveBeenCalledWith("present");
    expect(noteBox()).toBeNull();
  });

  it("①② 출석 → 클릭(=결석)이면 **먼저 저장하고** 사유 창을 연다", () => {
    const onSet = vi.fn();
    const { rerender } = render(
      <AttendanceCheck {...base} status="present" note={null} onSet={onSet} />,
    );
    fireEvent.click(screen.getByRole("button"));
    // 저장이 먼저 — 사유를 안 적고 닫아도 결석은 남는다(필수 입력 금지).
    expect(onSet).toHaveBeenCalledWith("absent");
    // 부모가 낙관 갱신으로 새 상태를 되돌려준 뒤에도 창은 열려 있다.
    rerender(<AttendanceCheck {...base} status="absent" note={null} onSet={onSet} />);
    expect(noteBox()).not.toBeNull();
  });

  it("③ 이미 적힌 사유는 채워서 연다 — 저장하면 그 상태 그대로 사유만 바뀐다", () => {
    const onSet = vi.fn();
    render(<AttendanceCheck {...base} status="late" note="버스 지연" onSet={onSet} />);
    // 우클릭 = 상태를 바꾸지 않는 보조 경로.
    fireEvent.contextMenu(screen.getByRole("button"));
    const box = noteBox() as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    expect(box.value).toBe("버스 지연");
    fireEvent.change(box, { target: { value: "10분 지각" } });
    fireEvent.click(screen.getByText("저장"));
    expect(onSet).toHaveBeenCalledWith("late", "10분 지각");
  });

  it("③ 사유를 비우면 null로 저장된다(빈 문자열이 남지 않는다)", () => {
    const onSet = vi.fn();
    render(<AttendanceCheck {...base} status="absent" note="병결" onSet={onSet} />);
    fireEvent.contextMenu(screen.getByRole("button"));
    fireEvent.change(noteBox() as HTMLTextAreaElement, { target: { value: "   " } });
    fireEvent.click(screen.getByText("저장"));
    expect(onSet).toHaveBeenCalledWith("absent", null);
  });

  it("④ 수정 기간이 지나도(canMark=false) 사유는 고칠 수 있다 — noteOnly 경로", () => {
    const onNote = vi.fn();
    const onSet = vi.fn();
    render(
      <AttendanceCheck
        {...base}
        status="absent"
        note="병결"
        canMark={false}
        canNote
        onSet={onSet}
        onNote={onNote}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(noteBox() as HTMLTextAreaElement, { target: { value: "부모 연락" } });
    fireEvent.click(screen.getByText("저장"));
    expect(onNote).toHaveBeenCalledWith("부모 연락");
    // 🔴 상태는 절대 안 건드린다(돈에 닿는 값이라 기간 면제 대상이 아니다).
    expect(onSet).not.toHaveBeenCalled();
  });

  it("④ 기록이 없는 잠긴 칸은 그대로 읽기 전용 — 메모를 붙이려고 없는 출결을 지어내지 않는다", () => {
    render(<AttendanceCheck {...base} status={null} note={null} canMark={false} canNote />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("권한이 아예 없으면(canNote=false) 잠긴 칸은 버튼조차 아니다", () => {
    render(<AttendanceCheck {...base} status="late" note="버스" canMark={false} canNote={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    // 🔴 툴팁은 **카드**다(원장 2026-09-15) — 상태는 카드 머리, 사유는 '사유' 줄이다.
    expect(tipText(screen.getByText("지각").getAttribute("data-tip"))).toMatch(/지각 · 사유 버스/);
  });

  it("사유가 있으면 칸에 점(●) 표식 — 열어보지 않아도 보인다", () => {
    const { container } = render(<AttendanceCheck {...base} status="late" note="버스" />);
    expect(container.textContent).toContain("●");
    cleanup();
    const bare = render(<AttendanceCheck {...base} status="late" note={null} />);
    expect(bare.container.textContent).not.toContain("●");
  });

  it("조퇴·공결 같은 3종 밖 상태는 raw enum이 아니라 한글로 보여만 준다", () => {
    render(<AttendanceCheck {...base} status="early_leave" note={null} />);
    expect(screen.getByText("조퇴")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("보강 + onRemoveMakeup이면 칸이 버튼이고, 확인 후에만 뺀다", () => {
    const onRemoveMakeup = vi.fn();
    window.confirm = vi.fn(() => true);
    render(
      <AttendanceCheck {...base} status="makeup" note={null} onRemoveMakeup={onRemoveMakeup} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "김학생 보강 취소" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onRemoveMakeup).toHaveBeenCalledTimes(1);
  });

  it("보강인데 확인을 취소하면 아무 일도 없다", () => {
    const onRemoveMakeup = vi.fn();
    window.confirm = vi.fn(() => false);
    render(
      <AttendanceCheck {...base} status="makeup" note={null} onRemoveMakeup={onRemoveMakeup} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "김학생 보강 취소" }));
    expect(onRemoveMakeup).not.toHaveBeenCalled();
  });
});
