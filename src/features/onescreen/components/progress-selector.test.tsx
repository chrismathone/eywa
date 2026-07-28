import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressSelector } from "./progress-selector";
import { curriculumForGrade } from "../curriculum";

afterEach(cleanup);

const GRADE = "중3";
const units = curriculumForGrade(GRADE);
const FIRST_UNIT = units[0]!;
const SECOND_UNIT = units[1]!;

/** 대단원 헤더 버튼 — 단원명은 ".", "(" 등을 포함하므로 정규식 대신 문자열 포함으로 찾는다. */
const unitHeader = (unit: string) =>
  screen.queryAllByRole("button").find((b) => b.textContent?.includes(unit)) ?? null;

/** 차시 체크박스 — 트리거에도 같은 텍스트가 보이므로 **체크박스 role**로 좁혀야 한다(getByText는 중복 매치). */
const lessonBox = (lesson: string) => screen.queryByRole("checkbox", { name: lesson });

/** 팝오버를 연 상태로 렌더(base-ui Popover는 열려야 내용이 마운트된다). */
function open(props: Partial<React.ComponentProps<typeof ProgressSelector>> = {}) {
  const onChange = vi.fn();
  render(
    <ProgressSelector
      value=""
      onChange={onChange}
      studyGrade={GRADE}
      onStudyGrade={vi.fn()}
      studentGrade={GRADE}
      {...props}
    />,
  );
  fireEvent.click(screen.getByLabelText("진도 선택"));
  return { onChange };
}

describe("대단원 아코디언 — 기본 접힘(원장 2026-07-28)", () => {
  it("열자마자는 대단원 헤더만 보이고 차시는 안 펼쳐진다", () => {
    open();
    expect(unitHeader(FIRST_UNIT.unit)).toHaveAttribute("aria-expanded", "false");
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeNull();
  });

  it("대단원을 누르면 그 단원만 펼쳐진다", () => {
    open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeTruthy();
    expect(lessonBox(SECOND_UNIT.lessons[0]!)).toBeNull();
  });

  it("다시 누르면 접힌다", () => {
    open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeNull();
  });

  it("이미 고른 차시가 있는 단원은 열 때 펼쳐져 있다 — 접힘 때문에 '내가 뭘 골랐지'를 못 보면 안 된다", () => {
    open({ value: SECOND_UNIT.lessons[0]! });
    expect(lessonBox(SECOND_UNIT.lessons[0]!)).toBeChecked();
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeNull(); // 안 고른 단원은 그대로 접힘
  });

  it("접힌 단원에도 '선택 N' 배지가 남는다(선택이 조용히 숨지 않음)", () => {
    open({ value: `${FIRST_UNIT.lessons[0]}\n${FIRST_UNIT.lessons[1]}` });
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!); // 접기
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeNull();
    expect(unitHeader(FIRST_UNIT.unit)!.textContent).toContain("선택 2");
  });

  it("검색 중에는 접힘과 무관하게 전부 펼쳐진다 — 결과가 접힌 채면 검색이 무의미하다", () => {
    open();
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeNull();
    fireEvent.change(screen.getByLabelText("단원·차시 검색"), {
      target: { value: FIRST_UNIT.lessons[0]!.slice(0, 4) },
    });
    expect(lessonBox(FIRST_UNIT.lessons[0]!)).toBeTruthy();
  });
});

describe("진도 없이 제출 — 특수 상태 알약", () => {
  it("네 상태가 모두 알약으로 노출된다", () => {
    open();
    for (const s of ["월말평가", "모의고사", "내신대비", "시험대비"]) {
      expect(screen.getByRole("button", { name: s })).toBeTruthy();
    }
  });

  it("상태를 고르면 그 라벨이 진도값이 된다", () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "모의고사" }));
    expect(onChange).toHaveBeenCalledWith("모의고사");
  });

  it("상태 선택 중엔 차시 고르기가 통째로 잠긴다(검색 비활성 + 체크리스트가 접근성 트리에서 빠짐)", () => {
    open({ value: "월말평가" });
    expect(screen.getByLabelText("단원·차시 검색")).toBeDisabled();
    expect(screen.getByLabelText("진도 학년 선택")).toBeDisabled();
    expect(unitHeader(FIRST_UNIT.unit)).toBeNull(); // aria-hidden 컨테이너 안
    expect(screen.getByRole("button", { name: "월말평가" })).toHaveAttribute("aria-pressed", "true");
  });

  it("같은 상태를 다시 누르면 해제된다", () => {
    const { onChange } = open({ value: "월말평가" });
    fireEvent.click(screen.getByRole("button", { name: "월말평가" }));
    expect(onChange).toHaveBeenCalledWith(""); // 이 인스턴스는 직전 차시를 모르므로 빈 값
  });

  it("차시를 고른 상태에서 상태로 넘어갔다가 해제하면 차시가 복원된다", () => {
    const lesson = FIRST_UNIT.lessons[0]!;
    let value = lesson;
    const onChange = vi.fn((v: string) => {
      value = v;
    });
    const { rerender } = render(
      <ProgressSelector
        value={value}
        onChange={onChange}
        studyGrade={GRADE}
        onStudyGrade={vi.fn()}
        studentGrade={GRADE}
      />,
    );
    fireEvent.click(screen.getByLabelText("진도 선택"));
    fireEvent.click(screen.getByRole("button", { name: "월말평가" }));
    expect(value).toBe("월말평가");

    rerender(
      <ProgressSelector
        value={value}
        onChange={onChange}
        studyGrade={GRADE}
        onStudyGrade={vi.fn()}
        studentGrade={GRADE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "월말평가" })); // 해제
    expect(value).toBe(lesson); // 고르기 전 차시로 복원
  });
});
