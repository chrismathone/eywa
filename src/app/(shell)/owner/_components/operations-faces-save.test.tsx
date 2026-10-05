import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 운영 체계·과목 운영 면이 **새 저장 계약대로 보내고 받는지**(2026-10-05) — 실제 섹션 폼으로 그린다.
 *  · 저장 요청에 면과 기준 token이 실린다. 저장이 도는 동안의 재제출은 받지 않는다.
 *  · 저장 성공은 제출한 스냅샷에 대해 확정한다(저장 도중 더 고친 것은 미저장으로 남는다).
 *  · 과목 삭제는 미저장 변경이 있으면 막고, 끝나면 서버가 돌려준 값과 token을 함께 채택한다.
 */
const m = vi.hoisted(() => ({
  save: vi.fn(),
  removeUnused: vi.fn(),
  markSaved: vi.fn(),
  rebaseline: vi.fn(),
  notifySaved: vi.fn(),
}));
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: m.save }));
vi.mock("@/features/owner/server/subject-actions", () => ({
  absorbSubject: vi.fn(),
  getSubjectUsage: vi.fn(async () => ({ total: 0, items: [] })),
  removeUnusedSubject: m.removeUnused,
}));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: m.notifySaved, rebaseline: m.rebaseline }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: m.markSaved }) }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/components/forms/form-action-bar", () => ({
  FormActionBar: ({ children }: { children: ReactNode }) => <div data-testid="action-bar">{children}</div>,
}));
vi.mock("./classroom-manager", () => ({ ClassroomManager: () => null }));
vi.mock("./subject-session-editor", () => ({ SubjectSessionEditor: () => null }));

import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { serializeForm } from "@/lib/realtime/form-snapshot";
import { OperationsSection } from "./operations-section";
import { SubjectsSection } from "./subjects-section";

const operations = (): OperationsSettings => structuredClone(DEFAULT_SETTINGS.operations);
const hiddenPayload = (container: HTMLElement) =>
  JSON.parse((container.querySelector('input[type="hidden"][name="data"]') as HTMLInputElement).value) as OperationsSettings;
const lastRequest = () => m.save.mock.calls.at(-1)![1] as FormData;
const saveButton = () => within(screen.getByTestId("action-bar")).getByRole("button", { name: /저장/ });
const subjectNameInput = (label: string) => screen.getByDisplayValue(label) as HTMLInputElement;

/** 저장 액션을 테스트가 원하는 때 끝낸다. */
function deferredSave() {
  let resolve!: (value: unknown) => void;
  m.save.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return (value: unknown) => act(async () => resolve(value));
}

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom은 <dialog>의 모달 표시를 구현하지 않을 수 있다 — 여는 동작만 흉내 낸다.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

describe("저장 요청", () => {
  it("운영 체계 면 — 면 이름과 그 면의 기준 token이 실린다", async () => {
    m.save.mockResolvedValueOnce({ ok: true, nonce: 1, operations: { tokens: { operations: "T1", subjects: "S0" } } });
    render(<OperationsSection initial={operations()} classrooms={[]} baselineToken="T0" />);
    await act(async () => fireEvent.click(saveButton()));
    expect(lastRequest().get("section")).toBe("operations");
    expect(lastRequest().get("operationsFace")).toBe("operations");
    expect(lastRequest().get("operationsBaseline")).toBe("T0");
  });

  it("과목 운영 면 — 저장에 성공하면 다음 저장은 응답의 token으로 나간다", async () => {
    m.save
      .mockResolvedValueOnce({ ok: true, nonce: 1, operations: { tokens: { operations: "T0", subjects: "S1" } } })
      .mockResolvedValueOnce({ ok: true, nonce: 2, operations: { tokens: { operations: "T0", subjects: "S2" } } });
    render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    fireEvent.change(subjectNameInput("수학"), { target: { value: "수학B" } });
    await act(async () => fireEvent.click(saveButton()));
    expect(lastRequest().get("operationsFace")).toBe("subjects");
    expect(lastRequest().get("operationsBaseline")).toBe("S0");

    fireEvent.change(subjectNameInput("수학B"), { target: { value: "수학C" } });
    await act(async () => fireEvent.click(saveButton()));
    expect(lastRequest().get("operationsBaseline")).toBe("S1");
  });

  it("🔴 저장이 실패하면 기준 token을 옮기지 않는다", async () => {
    m.save.mockResolvedValueOnce({ error: "다른 창에서 이 설정이 변경되었습니다." }).mockResolvedValueOnce({ ok: true, nonce: 2 });
    render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    fireEvent.change(subjectNameInput("수학"), { target: { value: "수학B" } });
    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByText("다른 창에서 이 설정이 변경되었습니다.")).toBeTruthy();
    await act(async () => fireEvent.click(saveButton()));
    expect(lastRequest().get("operationsBaseline")).toBe("S0");
  });

  it("저장이 도는 동안의 재제출은 보내지 않는다", async () => {
    const finish = deferredSave();
    const { container } = render(<OperationsSection initial={operations()} classrooms={[]} baselineToken="T0" />);
    const form = container.querySelector("form")!;
    await act(async () => fireEvent.submit(form));
    await act(async () => fireEvent.submit(form));
    expect(m.save).toHaveBeenCalledTimes(1);
    await finish({ ok: true, nonce: 1, operations: { tokens: { operations: "T1", subjects: "S0" } } });
  });
});

describe("저장 성공의 확정", () => {
  it("🔴 미저장 가드에는 **제출 시점의 폼**을 넘긴다 — 저장 도중 더 고친 것까지 저장됨으로 치지 않는다", async () => {
    const finish = deferredSave();
    const { container } = render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    fireEvent.change(subjectNameInput("수학"), { target: { value: "수학B" } });
    const form = container.querySelector("form")!;
    await act(async () => fireEvent.submit(form));
    const submitted = serializeForm(form);

    // 저장이 도는 동안에도 값은 바뀔 수 있다(버튼으로 바뀌는 편집 등) — 폼 잠금과 무관하게 스냅샷이 기준이어야 한다.
    await finish({ ok: true, nonce: 1, operations: { tokens: { operations: "T0", subjects: "S1" } } });
    await waitFor(() => expect(m.markSaved).toHaveBeenCalled());
    expect(m.markSaved.mock.calls.at(-1)![0]).toBe(submitted);
    expect(m.notifySaved).toHaveBeenCalledTimes(1);
  });
});

describe("과목 삭제", () => {
  const removeButtonOf = (label: string) =>
    within(subjectNameInput(label).closest("div")!.parentElement!).getAllByRole("button", { name: "삭제" })[0]!;

  it("🔴 저장하지 않은 변경이 있으면 삭제 창을 열지 않고 먼저 저장하라고 알린다", () => {
    render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    fireEvent.change(subjectNameInput("수학"), { target: { value: "수학B" } });
    fireEvent.click(removeButtonOf("과학"));
    expect(screen.getByRole("alert").textContent).toContain("저장하지 않은 변경이 있습니다");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("저장이 도는 동안에는 폼이 잠겨 과목 삭제를 시작할 수 없다 — 삭제 응답과 저장 응답은 겹치지 않는다", async () => {
    const finish = deferredSave();
    const { container } = render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    fireEvent.change(subjectNameInput("수학"), { target: { value: "수학B" } });
    await act(async () => fireEvent.submit(container.querySelector("form")!));
    // 삭제 버튼은 저장 중 잠기는 fieldset 안에 있다(브라우저는 잠긴 fieldset 안 버튼의 클릭을 보내지 않는다).
    expect(removeButtonOf("과학").closest("fieldset")!.disabled).toBe(true);
    await finish({ ok: true, nonce: 1, operations: { tokens: { operations: "T0", subjects: "S1" } } });
    expect(removeButtonOf("과학").closest("fieldset")!.disabled).toBe(false);
  });

  it("🔴 삭제가 끝나면 서버가 돌려준 과목 목록과 token을 함께 받는다 — 자기 목록에서 행만 빼지 않는다", async () => {
    // 그사이 다른 창이 수학 이름을 바꾸고 논술을 더했다 — 서버 응답에 그 변경이 들어 있다.
    const serverSubjects = [
      ...operations()
        .subjects.filter((s) => s.key !== "science")
        .map((s) => (s.key === "math" ? { ...s, label: "수학(다른 창)" } : s)),
      { key: "subject_9", label: "논술", color: "neutral" as const, weekdayGrouping: "mon-thu", testMax: 5 },
    ];
    m.removeUnused.mockResolvedValueOnce({
      ok: true,
      moved: 0,
      subjectsFace: { snapshot: { subjects: serverSubjects, weekdayGroupings: [], hiddenBuiltinWeekdayGroupings: [] }, token: "S2" },
    });
    m.save.mockResolvedValueOnce({ ok: true, nonce: 1, operations: { tokens: { operations: "T0", subjects: "S3" } } });
    const { container } = render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);

    fireEvent.click(removeButtonOf("과학"));
    const dialog = await waitFor(() => document.querySelector("dialog")!);
    const confirm = await waitFor(() => within(dialog as HTMLElement).getByRole("button", { name: "삭제" }));
    await act(async () => fireEvent.click(confirm));

    await waitFor(() => expect(hiddenPayload(container).subjects.map((s) => s.label)).toContain("수학(다른 창)"));
    expect(hiddenPayload(container).subjects.map((s) => s.key)).toEqual(serverSubjects.map((s) => s.key));
    // 채택한 값이 곧 서버 상태다 — 미저장 가드의 기준을 다시 잡는다.
    expect(m.rebaseline).toHaveBeenCalled();

    await act(async () => fireEvent.click(saveButton()));
    expect(lastRequest().get("operationsBaseline")).toBe("S2");
  });
});
