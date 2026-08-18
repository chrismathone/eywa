import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkPresentButton } from "./bulk-present-button";

afterEach(cleanup);

const btn = () => screen.getByRole("button");

describe("BulkPresentButton — 라벨·대상 수·비활성", () => {
  it("대상 수를 라벨에 밝힌다(눌러보기 전에 몇 칸인지 안다)", () => {
    render(<BulkPresentButton count={12} alreadyMarked={3} busy={false} onApply={vi.fn()} />);
    expect(btn().textContent).toBe("일괄 출석 12");
    expect(btn().hasAttribute("disabled")).toBe(false);
    expect(btn().getAttribute("title")).toContain("12칸");
    // 비파괴 계약을 툴팁이 말한다 — 이게 확인창을 없앤 근거다.
    expect(btn().getAttribute("title")).toContain("그대로 둡니다");
  });

  it("🔴 대상이 0이면 비활성 — 이미 전원 기록된 이유까지 밝힌다", () => {
    const onApply = vi.fn();
    render(<BulkPresentButton count={0} alreadyMarked={8} busy={false} onApply={onApply} />);
    expect(btn().textContent).toBe("일괄 출석"); // 0은 숫자를 안 붙인다(0을 보여줄 이유가 없다)
    expect(btn().hasAttribute("disabled")).toBe(true);
    expect(btn().getAttribute("title")).toBe("이 목록은 이미 전원 출결이 기록됐습니다");
    fireEvent.click(btn());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("찍을 수 있는 학생 자체가 없으면 '이미 기록됨'이라 말하지 않는다(거짓 안내 금지)", () => {
    render(<BulkPresentButton count={0} alreadyMarked={0} busy={false} onApply={vi.fn()} />);
    expect(btn().getAttribute("title")).toBe("출결을 기록할 수 있는 학생이 없습니다");
  });

  it("저장 중이면 잠기고 '기록 중…'으로 — 연타로 같은 칸을 두 번 보내지 않는다", () => {
    const onApply = vi.fn();
    render(<BulkPresentButton count={5} alreadyMarked={0} busy onApply={onApply} />);
    expect(btn().textContent).toBe("기록 중…");
    expect(btn().hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("누르면 호출부의 핸들러가 그대로 돈다 — 확인창을 끼우지 않는다(ECS에서 확정)", () => {
    const onApply = vi.fn();
    render(<BulkPresentButton count={4} alreadyMarked={1} busy={false} onApply={onApply} />);
    fireEvent.click(btn());
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
