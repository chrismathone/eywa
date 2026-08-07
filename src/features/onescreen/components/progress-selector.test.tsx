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

// 원장 2026-08-07: *"진도 선택시에 드래그로 주르륵 선택할 수는 없나? 지금은 일일이 클릭해야되네"*
describe("드래그로 연속 선택", () => {
  const lessons = FIRST_UNIT.lessons;

  it("누른 채 지나간 차시가 전부 선택된다", () => {
    const { onChange } = open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    fireEvent.pointerDown(lessonBox(lessons[0]!)!, { button: 0 });
    fireEvent.pointerEnter(lessonBox(lessons[1]!)!);
    fireEvent.pointerEnter(lessonBox(lessons[2]!)!);
    // 🔴 부모가 value를 되돌려주기 전에도 누적돼야 한다(작업본을 ref로 들고 다니는 이유).
    expect(onChange).toHaveBeenLastCalledWith(`${lessons[0]}\n${lessons[1]}\n${lessons[2]}`);
  });

  it("켜진 차시에서 시작하면 지나간 칸을 끈다(방향은 첫 칸이 정한다)", () => {
    const { onChange } = open({ value: `${lessons[0]}\n${lessons[1]}` });
    fireEvent.pointerDown(lessonBox(lessons[0]!)!, { button: 0 });
    fireEvent.pointerEnter(lessonBox(lessons[1]!)!);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("손을 뗀 뒤 지나가는 건 아무 일도 없다", () => {
    const { onChange } = open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    fireEvent.pointerDown(lessonBox(lessons[0]!)!, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.pointerEnter(lessonBox(lessons[1]!)!);
    expect(onChange).toHaveBeenLastCalledWith(lessons[0]); // 첫 칸까지만
  });

  // 같은 칸에 다시 들어와도 방금 한 일이 뒤집히면 안 된다(손이 흔들리는 것은 정상이다).
  it("같은 칸을 다시 지나가도 뒤집히지 않는다", () => {
    const { onChange } = open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    fireEvent.pointerDown(lessonBox(lessons[0]!)!, { button: 0 });
    fireEvent.pointerEnter(lessonBox(lessons[1]!)!);
    fireEvent.pointerEnter(lessonBox(lessons[0]!)!);
    fireEvent.pointerEnter(lessonBox(lessons[1]!)!);
    expect(onChange).toHaveBeenLastCalledWith(`${lessons[0]}\n${lessons[1]}`);
  });

  it("키보드(스페이스)로도 고를 수 있다 — 드래그가 마우스 전용 기능이 되지 않게", () => {
    const { onChange } = open();
    fireEvent.click(unitHeader(FIRST_UNIT.unit)!);
    fireEvent.keyDown(lessonBox(lessons[0]!)!, { key: " " });
    expect(onChange).toHaveBeenLastCalledWith(lessons[0]);
  });
});

// 원장 2026-08-07: *"내신대비 기간이라 한시간은 선행, 한시간은 현행 하고 싶을 수도 있으니까"*
describe("여러 학년에 걸친 선택", () => {
  const OTHER = "중2";
  const otherLesson = curriculumForGrade(OTHER)[0]!.lessons[0]!;

  it("다른 학년에서 고른 차시는 지워지지 않고 밴드로 밝혀진다", () => {
    open({ value: otherLesson });
    // 지금 학년 목록엔 없는 선택이라, 이 밴드가 없으면 강사 눈엔 "고른 게 사라진" 것이 된다.
    const band = screen.getByText(/함께 선택됨/);
    expect(band.textContent).toContain(otherLesson);
  });

  it("'다른 학년만 해제'는 지금 학년 선택은 남긴다", () => {
    const mine = FIRST_UNIT.lessons[0]!;
    const { onChange } = open({ value: `${otherLesson}\n${mine}` });
    fireEvent.click(screen.getByRole("button", { name: "다른 학년만 해제" }));
    expect(onChange).toHaveBeenLastCalledWith(mine);
  });

  it("같은 학년만 고르면 밴드가 안 뜬다", () => {
    open({ value: FIRST_UNIT.lessons[0]! });
    expect(screen.queryByText(/다른 학년/)).toBeNull();
  });
});

// 원장 2026-08-07: *"문제풀이가 없으니까 그냥 진도를 적고 문제풀이를 했다고해도 진도를 나갔다고 멘트가 나오더라고"*
describe("오늘 수업 성격 — 복습·문제풀이", () => {
  it("두 알약이 노출되고 고르면 값이 올라간다", () => {
    const onMode = vi.fn();
    open({ onMode });
    fireEvent.click(screen.getByRole("button", { name: "복습" }));
    expect(onMode).toHaveBeenCalledWith("복습");
  });

  it("같은 것을 다시 누르면 해제된다(되돌릴 문)", () => {
    const onMode = vi.fn();
    open({ mode: "문제풀이", onMode });
    fireEvent.click(screen.getByRole("button", { name: "문제풀이" }));
    expect(onMode).toHaveBeenCalledWith(null);
  });

  // 🔴 시험 친 날은 나간 차시가 없으니 그 차시의 복습도 성립하지 않는다.
  it("진도 없이 제출을 고르면 성격 알약이 사라진다", () => {
    open({ value: "월말평가", onMode: vi.fn() });
    expect(screen.queryByRole("button", { name: "복습" })).toBeNull();
  });

  it("onMode를 안 주는 화면(읽기 전용 등)에는 아예 안 그린다", () => {
    open();
    expect(screen.queryByRole("button", { name: "복습" })).toBeNull();
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
