import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUARDIAN2_FIELD_NAMES, Guardian2Field, type Guardian2Value } from "./guardian2-field";
import { GUARDIAN_RELATIONS } from "./student-form-field";

afterEach(cleanup);

const EMPTY: Guardian2Value = { name: null, phone: null, relation: null };

function renderInForm(initial: Guardian2Value, phoneError?: string) {
  const onInput = vi.fn();
  const utils = render(
    <form data-testid="form" onInput={onInput}>
      <Guardian2Field initial={initial} phoneError={phoneError} />
    </form>,
  );
  const form = utils.getByTestId("form") as HTMLFormElement;
  const values = () => GUARDIAN2_FIELD_NAMES.map((n) => String(new FormData(form).get(n)));
  return { ...utils, form, onInput, values };
}

describe("원생 폼 보호자2 줄(s2_0024)", () => {
  it("값이 없으면 닫혀 있고 '+ 보호자 추가'로 연다 — 닫힌 줄도 빈 값으로 실린다", () => {
    const { values } = renderInForm(EMPTY);
    expect(screen.getByLabelText("보호자2 이름")).not.toBeVisible();
    expect(values()).toEqual(["", "", ""]);
    fireEvent.click(screen.getByRole("button", { name: "+ 보호자 추가" }));
    expect(screen.getByLabelText("보호자2 이름")).toBeVisible();
    expect(screen.getByLabelText("보호자2 이름")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "+ 보호자 추가" })).toBeNull();
  });

  it("값이 있으면 처음부터 열려 있다 · 관계 선택지는 보호자1과 같은 목록", () => {
    const { values } = renderInForm({ name: "김어머니", phone: "010-1234-5678", relation: "모" });
    expect(screen.getByLabelText("보호자2 연락처")).toBeVisible();
    expect(values()).toEqual(["김어머니", "010-1234-5678", "모"]);
    expect(screen.queryByRole("button", { name: "+ 보호자 추가" })).toBeNull();
    const options = [...(screen.getByLabelText("보호자2 관계") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["", ...GUARDIAN_RELATIONS]);
  });

  it("'삭제'는 세 칸을 비우고 닫는다 + 폼에 input 이벤트(미저장 경고·초안이 바뀐 것을 안다)", () => {
    const { values, onInput } = renderInForm({ name: "김어머니", phone: "010-1234-5678", relation: "모" });
    fireEvent.click(screen.getByRole("button", { name: "보호자2 삭제" }));
    expect(values()).toEqual(["", "", ""]);
    expect(screen.getByLabelText("보호자2 이름")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "+ 보호자 추가" })).toBeVisible();
    expect(onInput).toHaveBeenCalled();
  });

  it("폼 리셋(제출 뒤 연 때 값으로)이면 지운 줄이 연 때 값과 함께 다시 보인다 — 숨은 채 옛 값을 싣지 않게", () => {
    const { form, values } = renderInForm({ name: "김어머니", phone: "010-1234-5678", relation: "모" });
    fireEvent.click(screen.getByRole("button", { name: "보호자2 삭제" }));
    act(() => {
      form.reset(); // React 19가 제출 뒤 부르는 것과 같은 리셋(브라우저는 이때 reset 이벤트를 낸다)
      form.dispatchEvent(new Event("reset"));
    });
    // 입력칸은 연 때 값으로 돌아온다. 관계(select)는 시험 환경(happy-dom)이 리셋을 안 해서, 브라우저가 되돌릴 기준(defaultSelected)만 본다.
    expect(values().slice(0, 2)).toEqual(["김어머니", "010-1234-5678"]);
    const relation = screen.getByLabelText("보호자2 관계") as HTMLSelectElement;
    expect([...relation.options].filter((o) => o.defaultSelected).map((o) => o.value)).toEqual(["모"]);
    expect(screen.getByLabelText("보호자2 이름")).toBeVisible();
  });

  it("초안 되살리기가 닫힌 줄에 값을 넣으면 줄을 연다 — 보이지 않는 값이 저장되지 않게", () => {
    renderInForm(EMPTY);
    const phone = screen.getByLabelText("보호자2 연락처") as HTMLInputElement;
    phone.value = "010-3333-4444";
    fireEvent.input(phone);
    expect(phone).toBeVisible();
  });

  it("연락처 오류는 닫힌 줄도 열어 보여 준다 · '삭제'를 누르면 닫힌다", () => {
    renderInForm(EMPTY, "연락처 형식을 확인해주세요");
    expect(screen.getByText("연락처 형식을 확인해주세요")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "보호자2 삭제" }));
    expect(screen.getByLabelText("보호자2 연락처")).not.toBeVisible();
  });
});
