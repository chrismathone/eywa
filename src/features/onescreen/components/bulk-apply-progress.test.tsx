import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkApplyPopover } from "./bulk-apply";
import { curriculumForGrade } from "../curriculum";

// 원장 제보 2026-10-26 *"수학 수업보고서에서 수업 진도에서 일괄 입력할 때 튕겨서 입력이 안 되고 맨 위는 복사가 된다"*
// — 일괄 입력 창 안에서 진도 선택 창(두 번째 팝오버)을 연 채로 바깥을 누르면 두 창이 다 닫히고 초기화가 고른 진도를 지웠다.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const U = curriculumForGrade("중3").find((x) => x.unit.includes("이차함수"))!;
const fields = { attitudes: ["좋음"], dailyEnabled: false, checkEnabled: false, allowTestMax: false, videoRows: 0, linkRows: 0, videoCheckRows: 0 };
const innerOpen = () => !!screen.queryByRole("textbox", { name: "단원·차시 검색" });

function Harness({ studyGrade, onApply }: { studyGrade: string; onApply: () => void }) {
  return (
    <div>
      <BulkApplyPopover
        targetCount={10} selectedCount={0} fields={fields}
        subjects={[{ key: "math", name: "수학", count: 10 }]} studyGrade={studyGrade}
        copySource={{ label: "가", belowCount: 9 }} attendance={null} onApply={onApply} onCopyFirstRow={vi.fn()}
      />
      <table><tbody><tr><td>표의 다른 칸</td></tr></tbody></table>
    </div>
  );
}

describe("일괄 입력 — 진도 선택 창", () => {
  it("진도를 고른 뒤 바깥을 눌러 선택 창을 닫아도 일괄 입력 창과 고른 진도가 남고, 적용하면 그 진도가 들어간다", async () => {
    vi.stubGlobal("confirm", () => true);
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<Harness studyGrade="중3" onApply={onApply} />);
    await user.click(screen.getByRole("button", { name: "일괄 입력" }));
    await user.click(screen.getByLabelText("일괄 진도"));
    await user.click(screen.queryAllByRole("button").find((b) => b.textContent?.includes(U.unit))!);
    await user.click(screen.getByRole("checkbox", { name: U.lessons[1]! }));
    await user.click(screen.getByText("표의 다른 칸")); // 행 진도 칸에서 하던 대로 '바깥'을 눌러 선택 창을 닫는다
    expect(innerOpen()).toBe(false);
    expect(screen.getByLabelText("일괄 진도").textContent).toContain(U.lessons[1]!);
    const apply = screen.getByRole("button", { name: "적용" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onApply.mock.calls[0])).toContain(U.lessons[1]!);
  });

  it("선택 창이 닫힌 뒤 바깥을 누르면 일괄 입력 창은 예전처럼 닫히고 초기화된다", async () => {
    const user = userEvent.setup();
    render(<Harness studyGrade="중3" onApply={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "일괄 입력" }));
    await user.click(screen.getByLabelText("일괄 진도"));
    await user.click(screen.queryAllByRole("button").find((b) => b.textContent?.includes(U.unit))!);
    await user.click(screen.getByRole("checkbox", { name: U.lessons[1]! }));
    await user.click(screen.getByText("표의 다른 칸")); // 선택 창만 닫힘
    await user.click(screen.getByText("표의 다른 칸")); // 이제 일괄 입력 창이 닫힘
    expect(screen.queryByLabelText("일괄 진도")).toBeNull();
    await user.click(screen.getByRole("button", { name: "일괄 입력" }));
    expect(screen.getByLabelText("일괄 진도").textContent).not.toContain(U.lessons[1]!);
  });

  it("반이 바뀌어 기본 진도 학년이 바뀌면 그 반 기준으로 연다(같은 반에서는 고른 학년 유지)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness studyGrade="초5" onApply={vi.fn()} />);
    rerender(<Harness studyGrade="초6" onApply={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "일괄 입력" }));
    await user.click(screen.getByLabelText("일괄 진도"));
    expect((screen.getByRole("combobox", { name: /학년/ }) as HTMLSelectElement).value).toBe("초6");
  });
});
