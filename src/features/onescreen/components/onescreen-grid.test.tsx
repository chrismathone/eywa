import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OneScreenGrid } from "./onescreen-grid";
import { DisplayOptionsProvider } from "./display-options-context";
import type { ComponentProps } from "react";
import type { OneScreenStudent, Subject } from "../types";

afterEach(cleanup);
vi.mock("./sequential-attach-button", () => ({ SequentialAttachButton: ({ rows }: { rows: { key: string }[] }) => <span data-testid="camera-order">{rows.map(r => r.key).join(",")}</span> }));
const subject = (className: string): Subject => ({ name: `수학 · ${className}`, subjectLabel: "수학", className, classId: className, prev: "", today: "", subjectKey: "math" });
const student = (id: string, name: string, classes: string[]): OneScreenStudent => ({
  id, name, grade: "중3", tag: classes[0], attendance: "출석", subjects: classes.map(subject),
  tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
  attitude: null, homework: "", progressConfirmed: false, reportDraft: "", reportSent: false,
});
const props: ComponentProps<typeof OneScreenGrid> = {
  students: [student("a", "안하나", ["오전반", "오후반"]), student("b", "김두나", ["오전반"])],
  reports: {}, classFilter: null, classOrder: ["오전반", "오후반"], attPending: new Set(),
  config: { attitudes: [], allowTestMax: true, dailyEnabled: true, checkEnabled: false, attachmentUrls: {}, noticeMode: "A" },
  fields: { onAttendance: vi.fn(), onProgress: vi.fn(), onProgressMode: vi.fn(), onStudyGrade: vi.fn(), onScore: vi.fn(), onMax: vi.fn(), onAttitude: vi.fn(), onHomework: vi.fn(), onTextbook: vi.fn(), onHomeworkToday: vi.fn(), onDraft: vi.fn(), onTrend: vi.fn(), onNote: vi.fn(), onMakeup: vi.fn() },
  rowActions: { onSendRow: vi.fn(), onAutoWrite: vi.fn(), onOpenCard: vi.fn(), onImportPrev: vi.fn(), onAttach: vi.fn(), onRemoveAttachment: vi.fn(), onOpenAttachments: vi.fn() },
  bulkActions: { onSaveAll: vi.fn(), onSendAll: vi.fn(), onAutoWriteAll: vi.fn(), onBulkApply: vi.fn() },
};

it("학생 수와 보고서 건수를 구분하고 반별로 같은 학생의 두 수업을 표시한다", () => {
  const { container } = render(<OneScreenGrid {...props} />);
  expect(screen.getByText(/학생 2명 · 보고서 3건/)).toBeTruthy();
  expect(screen.getAllByRole("rowheader").map(e => e.textContent)).toEqual(["오전반2명", "오후반1명"]);
  expect([...container.querySelectorAll("tbody tr")].filter(e => e.querySelector('input[type="checkbox"]')).map(e => e.textContent?.match(/안하나|김두나/)?.[0])).toEqual(["안하나", "김두나", "안하나"]);
  expect([...container.querySelectorAll("tbody td")].some(e => /오전반|오후반/.test(e.textContent ?? ""))).toBe(false);
  fireEvent.click(screen.getAllByRole("button", { name: "상세" })[2]);
  expect(props.rowActions.onOpenCard).toHaveBeenLastCalledWith("a", "수학 · 오후반");
});

it("가나다 정렬은 반 헤더 없이 이름순이며 해당 수업의 편집 인덱스가 유지된다", () => {
  const { container } = render(<DisplayOptionsProvider value={{ options: { sort: "name", hidePrevious: true }, change: vi.fn(), readonly: false }}>
    <OneScreenGrid {...props} />
  </DisplayOptionsProvider>);
  expect(screen.queryByRole("rowheader")).toBeNull();
  expect([...container.querySelectorAll("tbody tr")].map(e => e.textContent?.match(/안하나|김두나/)?.[0])).toEqual(["김두나", "안하나", "안하나"]);
  expect([...container.querySelectorAll("tbody td")].some(e => /오전반|오후반/.test(e.textContent ?? ""))).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "상세" })[2]);
  expect(props.rowActions.onOpenCard).toHaveBeenLastCalledWith("a", "수학 · 오후반");
});

it("반 필터의 인원과 행 선택은 다른 반을 포함하지 않는다", () => {
  render(<OneScreenGrid {...props} classFilter="오후반" />);
  expect(screen.getByText(/학생 1명 · 보고서 1건/)).toBeTruthy();
  expect(screen.queryByText("김두나")).toBeNull();
});

it("연속 첨부에 화면의 이름 정렬·반 필터를 거친 실제 행 순서를 넘긴다", () => {
  render(<DisplayOptionsProvider value={{ options: { sort: "name", hidePrevious: true }, change: vi.fn(), readonly: false }}>
    <OneScreenGrid {...props} classFilter="오전반" sequentialAttach={{ date: "2026-11-13", busy: false, onAttach: vi.fn(), onUploadingChange: vi.fn() }} />
  </DisplayOptionsProvider>);
  expect(screen.getByTestId("camera-order").textContent).toBe("b::수학 · 오전반,a::수학 · 오전반");
});
