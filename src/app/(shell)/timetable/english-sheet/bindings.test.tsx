import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ClassBindings } from "./class-bindings";
import { TeacherBindings } from "./teacher-bindings";
import type {
  MasterInput,
  MasterPreview,
} from "@/features/timetable/import/master/types";

afterEach(cleanup);
const member = (studentId: string, name: string) => ({
  studentId,
  name,
  school: "침산초",
  grade: "초2",
  status: "enrolled",
  onHold: false,
});
function fixture() {
  const common = member("common", "김하윤C");
  const added = member("added", "새학생");
  const existingOnly = member("existing", "김하윤C");
  const preview = {
    effectiveDate: "2026-10-01",
    mappings: [
      {
        sheetName: "LE1",
        classId: "same-name",
        currentName: "LE1",
        suggestedId: "prior",
        suggestedName: "LS6",
        evidence: "명단 2명 중 1명 일치",
        explicit: false,
        method: "name",
        manualReason: null,
      },
    ],
    classes: [
      { id: "same-name", name: "LE1" },
      { id: "prior", name: "LS6" },
    ],
    rosterReview: {
      sheet: [
        {
          sheetName: "LE1",
          declared: 2,
          members: [common, added].map((s) => ({
            name: s.name,
            school: s.school,
            grade: s.grade,
            raw: s.name,
            student: s,
            candidates: [],
            needsConfirmation: false,
          })),
        },
      ],
      existing: [
        { classId: "prior", className: "LS6", members: [common, existingOnly] },
        { classId: "same-name", className: "LE1", members: [] },
      ],
    },
    teachers: [{ id: "teacher", name: "송지혜 (Song)" }],
    teacherMappings: [
      {
        sheetName: "Jennifer",
        header: "Jennifer 송지혜 304",
        teacherId: null,
        suggestedId: "teacher",
        suggestedName: "송지혜",
        method: "unmapped",
        manualReason: "담당자를 선택하세요.",
      },
    ],
  } satisfies Pick<
    MasterPreview,
    | "effectiveDate"
    | "mappings"
    | "classes"
    | "rosterReview"
    | "teachers"
    | "teacherMappings"
  >;
  const input: MasterInput = {
    source: "sheet",
    teacherTab: "t",
    rosterTab: "r",
    effectiveDate: "2026-10-01",
    maxColumn: "",
    classBindings: {},
  };
  return { preview, input };
}
describe("반·강사 연결과 명단 표시", () => {
  it("추천 명단은 기존 자동 연결과 구별해 보여주고 명시적 클릭만 연결 초안을 바꾼다", async () => {
    const f = fixture();
    const onChange = vi.fn();
    render(<ClassBindings {...f} pending={false} onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "LE1 반 연결" })).toHaveValue(
      "same-name",
    );
    expect(screen.getByText(/아직 연결을 확정하지 않았습니다/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    const details = screen.getByText(/명단 보기/).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(
      await screen.findByText(/공통 1명 · 시트에만 1명 · 기존 반에만 1명/),
    ).toBeVisible();
    const sheet = screen.getByRole("region", { name: "LE1 시트 명단" });
    expect(
      within(sheet).getByRole("link", { name: "김하윤C" }),
    ).toHaveAttribute("href", "/students/common");
    const existing = screen.getByRole("region", { name: "LS6 기존 명단" });
    expect(
      within(existing).getAllByRole("link", { name: "김하윤C" }),
    ).toHaveLength(2);
    expect(within(existing).getByText("기존 반에만 · 수강 유지")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "LS6 추천 반 연결" }),
    );
    expect(onChange).toHaveBeenCalledWith({ classBindings: { LE1: "prior" } });
  });
  it("명시적으로 고른 반을 추천 명단으로 다시 덮지 않는다", () => {
    const f = fixture();
    f.input.classBindings.LE1 = "same-name";
    render(<ClassBindings {...f} pending={false} onChange={vi.fn()} />);
    expect(screen.getByText(/명단 보기/)).toHaveTextContent("연결 반 LE1 0명");
    expect(screen.queryByText(/아직 연결을 확정/)).toBeNull();
  });
  it("강사 한글 이름 추천은 클릭으로만 적용하고 검사 중에는 막는다", async () => {
    const f = fixture();
    const onChange = vi.fn();
    const view = render(
      <TeacherBindings {...f} pending={false} onChange={onChange} />,
    );
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "송지혜 강사 연결" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      teacherBindings: { Jennifer: "teacher" },
    });
    view.rerender(
      <TeacherBindings {...f} pending={true} onChange={onChange} />,
    );
    expect(
      screen.getByRole("button", { name: "송지혜 강사 연결" }),
    ).toBeDisabled();
  });
});
