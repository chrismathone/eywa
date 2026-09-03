import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTE_POPOUT_H, NOTE_POPOUT_W, NoteCell } from "./note-cell";

afterEach(cleanup);

function renderCell(props: Partial<Parameters<typeof NoteCell>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <table>
      <tbody>
        <tr>
          <NoteCell
            defaultValue=""
            disabled={false}
            label="이지호A 특이사항"
            navCol="ecs-note"
            navRow={0}
            onChange={onChange}
            {...props}
          />
        </tr>
      </tbody>
    </table>,
  );
  return { onChange, box: screen.getByLabelText("이지호A 특이사항") as HTMLTextAreaElement };
}

describe("NoteCell — 특이사항 스티커 메모", () => {
  it("평소엔 열 폭 그대로(펼침 치수 없음)", () => {
    const { box } = renderCell();
    expect(box.style.width).toBe("");
    expect(box.style.height).toBe("");
  });

  it("적을 때(포커스) 스티커 메모로 펼쳐진다 — 오른쪽에 붙어 왼쪽으로", () => {
    const { box } = renderCell();
    fireEvent.focus(box);
    expect(box.style.width).toBe(`${NOTE_POPOUT_W}px`);
    expect(box.style.height).toBe(`${NOTE_POPOUT_H}px`);
    // 특이사항은 맨 오른쪽 열이라 오른쪽으로 펼치면 옆 요일 카드를 침범한다.
    expect(box.style.right).toBe("0px");
    expect(box.style.left).toBe("auto");
    // 🔴 바탕은 **인라인**이어야 한다 — 같은 축(background)을 클래스로 두 번 적으면 이기는 쪽을
    //    CSS 순서가 정하고([[#116]]), 지는 날엔 펼친 메모 뒤로 아랫줄이 그대로 비친다.
    //    (2026-09-03부터 SHEET_INPUT 자체가 bg-card라 접힌 상태도 흰색이지만, 펼침은 여전히 인라인.)
    expect(box.style.backgroundColor).toBe("var(--card)");
  });

  it("다 적고 닫으면(블러) 다시 접힌다 — 값은 그대로", () => {
    const { box } = renderCell({ defaultValue: "지난주 결석분 보강 안내 완료" });
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(box.style.width).toBe("");
    expect(box.value).toBe("지난주 결석분 보강 안내 완료");
  });

  it("접힌 상태에서 안 보이는 뒷부분은 마우스 오버로 읽는다", () => {
    const { box } = renderCell({ defaultValue: "학교 행사로 다음 주 화요일 결석 예정" });
    expect(box.title).toBe("학교 행사로 다음 주 화요일 결석 예정");
    // 펼쳐 놓고 툴팁까지 뜨면 글자를 가린다.
    fireEvent.focus(box);
    expect(box.title).toBe("");
  });

  it("툴팁은 지금 적고 있는 값을 따라간다(저장 왕복을 기다리지 않는다)", () => {
    const { box, onChange } = renderCell();
    fireEvent.change(box, { target: { value: "병원" } });
    fireEvent.blur(box);
    expect(box.title).toBe("병원");
    expect(onChange).toHaveBeenCalledWith("병원");
  });

  it("빈 칸엔 툴팁을 안 단다(빈 상자가 뜨지 않게)", () => {
    const { box } = renderCell();
    expect(box.title).toBe("");
  });

  it("잠긴 행은 펼쳐지지 않는다 — 세로 이동(grid-nav)이 건너뛸 수 있게 disabled 그대로", () => {
    const { box } = renderCell({ disabled: true });
    expect(box.disabled).toBe(true);
  });

  it("표 세로 이동이 이 칸을 찾을 수 있게 nav 표식을 단다", () => {
    const { box } = renderCell({ navCol: "ecs-note-2", navRow: 7 });
    expect(box.dataset.navCol).toBe("ecs-note-2");
    expect(box.dataset.navRow).toBe("7");
  });
});
