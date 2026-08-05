import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendancePills, SessionUnitsField } from "./attendance-pills";

afterEach(cleanup);

describe("AttendancePills", () => {
  it("출석은 사유가 없으니 클릭 즉시 기록한다", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.click(screen.getByRole("button", { name: /^출석/ }));
    expect(onSet).toHaveBeenCalledWith("present");
  });

  it("지각·결석은 **바로 저장하지 않고** 사유 창을 연다(2026-08-05 원장 요청)", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.click(screen.getByRole("button", { name: /^결석/ }));
    expect(onSet).not.toHaveBeenCalled(); // 창이 뜨는 단계 — 아직 기록 안 됨
    expect(screen.getByPlaceholderText(/학원버스 지연/)).toBeTruthy();
  });

  it("사유를 적고 저장하면 상태와 메모가 한 번에 넘어간다", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.click(screen.getByRole("button", { name: /^지각/ }));
    fireEvent.change(screen.getByPlaceholderText(/학원버스 지연/), { target: { value: " 버스 지연 " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSet).toHaveBeenCalledWith("late", { note: "버스 지연" }); // 앞뒤 공백 정리
  });

  it("사유를 비우고 저장하면 메모는 null(빈 문자열을 남기지 않는다)", () => {
    const onSet = vi.fn();
    render(<AttendancePills value="absent" note="옛 사유" pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.click(screen.getByRole("button", { name: /^결석/ }));
    fireEvent.change(screen.getByPlaceholderText(/학원버스 지연/), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSet).toHaveBeenCalledWith("absent", { note: null });
  });

  it("이미 찍힌 지각 라벨에 마우스를 올리면 사유 창이 열려 고칠 수 있다", () => {
    const onSet = vi.fn();
    render(<AttendancePills value="late" note="버스 지연" pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^지각/ }));
    const box = screen.getByPlaceholderText(/학원버스 지연/) as HTMLTextAreaElement;
    expect(box.value).toBe("버스 지연"); // 기존 사유가 채워져 있다
  });

  it("hover로 열리는 건 **활성 라벨만** — 안 찍힌 pill은 지나가도 안 열린다", () => {
    render(<AttendancePills value="late" pending={false} onSet={vi.fn()} studentName="학원이" />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^결석/ }));
    expect(screen.queryByPlaceholderText(/학원버스 지연/)).toBeNull();
  });

  it("pill은 기본적으로 수업타임을 그리지 않는다(표=전용 열 · 카드=옆 필드로 분리, 2026-08-05)", () => {
    render(<AttendancePills value="present" pending={false} onSet={vi.fn()} studentName="학원이" />);
    expect(screen.queryByLabelText("학원이 수업타임")).toBeNull();
  });

  it("권한이 없으면 버튼을 아예 내보내지 않는다(눌러도 서버가 거절하던 거짓 약속 차단)", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" readOnly />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTitle(/출결 입력 권한이 없습니다/)).toBeTruthy();
  });

  it("권한이 없어도 이미 기록된 출결은 한글로 보인다(정보는 숨기지 않는다)", () => {
    render(<AttendancePills value="late" pending={false} onSet={vi.fn()} studentName="학원이" readOnly />);
    expect(screen.getByText("지각")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("기록이 없으면 '출결 —'로 비어 있음을 알린다", () => {
    render(<AttendancePills value={null} pending={false} onSet={vi.fn()} studentName="학원이" readOnly />);
    expect(screen.getByText("출결 —")).toBeTruthy();
  });

  it("조퇴·공결 등 3종 밖 상태는 pill로 되쓰지 못하게 배지만 보여준다", () => {
    render(<AttendancePills value="early_leave" pending={false} onSet={vi.fn()} studentName="학원이" />);
    expect(screen.getByText("조퇴")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("SessionUnitsField", () => {
  const base = { pending: false, studentName: "학원이" as const };

  it("기본은 1이고, 고쳐서 빠져나오면 시수가 넘어간다", () => {
    const onSet = vi.fn();
    render(<SessionUnitsField {...base} units={null} status="present" onSet={onSet} />);
    const input = screen.getByLabelText("학원이 수업타임") as HTMLInputElement;
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input, { target: { value: "2" } });
    expect(onSet).toHaveBeenCalledWith("present", { units: "2" });
  });

  it("값이 그대로면 왕복하지 않는다", () => {
    const onSet = vi.fn();
    render(<SessionUnitsField {...base} units={2} status="present" onSet={onSet} />);
    const input = screen.getByLabelText("학원이 수업타임") as HTMLInputElement;
    expect(input.value).toBe("2");
    fireEvent.blur(input, { target: { value: "2" } });
    expect(onSet).not.toHaveBeenCalled();
  });

  it("출결이 비어 있어도 적으면 '출석'으로 함께 기록된다(무반응 금지)", () => {
    const onSet = vi.fn();
    render(<SessionUnitsField {...base} units={null} status={null} onSet={onSet} />);
    fireEvent.blur(screen.getByLabelText("학원이 수업타임"), { target: { value: "1.5" } });
    expect(onSet).toHaveBeenCalledWith("present", { units: "1.5" });
  });

  it("결석 — 인라인(md)은 아예 안 그리고, 전용 열(lg)은 왜 못 적는지 밝힌다(빈 칸 금지)", () => {
    const { container } = render(<SessionUnitsField {...base} units={null} status="absent" onSet={vi.fn()} />);
    expect(container.textContent).toBe("");
    cleanup();
    render(<SessionUnitsField {...base} units={null} status="absent" onSet={vi.fn()} size="lg" />);
    expect(screen.queryByLabelText("학원이 수업타임")).toBeNull();
    expect(screen.getByTitle(/결석은 수업타임/)).toBeTruthy();
  });

  it("라벨을 주면 앞에 붙고, 안 주면 입력칸만 나온다(전용 열은 머리글이 이미 '타임')", () => {
    const { rerender } = render(<SessionUnitsField {...base} units={null} status="present" onSet={vi.fn()} label="수업타임" />);
    expect(screen.getByText("수업타임")).toBeTruthy();
    rerender(<SessionUnitsField {...base} units={null} status="present" onSet={vi.fn()} size="lg" />);
    expect(screen.queryByText("수업타임")).toBeNull();
  });

  it("전용 열(lg)이 인라인(md)보다 크다 — 원장 '타임이 너무 작다' 대응이 회귀하지 않게", () => {
    const { container: md } = render(<SessionUnitsField {...base} units={null} status="present" onSet={vi.fn()} />);
    const mdCls = md.querySelector("input")!.className;
    cleanup();
    const { container: lg } = render(<SessionUnitsField {...base} units={null} status="present" onSet={vi.fn()} size="lg" />);
    const lgCls = lg.querySelector("input")!.className;
    expect(mdCls).toContain("text-[13px]");
    expect(lgCls).toContain("text-[15px]");
    // 예전 크기(10px·18px 높이)로 되돌아가지 않는다.
    expect(`${mdCls} ${lgCls}`).not.toContain("text-[10px]");
    expect(`${mdCls} ${lgCls}`).not.toContain("h-[18px]");
  });
});
