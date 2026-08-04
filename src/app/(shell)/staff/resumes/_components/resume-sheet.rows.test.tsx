import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CAREER_ROWS, emptyResume } from "@/features/staff/resume";
import { ResumeSheet } from "./resume-sheet";

/**
 * 경력·학력 **동적 행** 계약(원장 요청 2026-08-04: "경력사항을 3개밖에 못 적는다").
 * 종이 서식 행 수(경력 3·학력 4)는 하한이고, 마지막 행에 입력하면 스스로 한 줄 늘어난다.
 * ⚠️ 하한 아래로는 −버튼으로도 안 줄어야 한다 — normalizeResume가 하한까지 패딩하므로,
 *    화면에서 더 지울 수 있으면 "지웠는데 새로고침하면 되살아난다"로 보인다.
 */
vi.mock("@/lib/form-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/form-draft")>()),
  saveDraft: vi.fn(),
  loadDraft: async () => null,
  clearDraft: async () => {},
}));
vi.mock("@/features/staff/server/resume-actions", () => ({
  saveStaffResume: vi.fn(),
  deleteStaffResume: vi.fn(),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({
  useUnsavedGuard: () => ({ markSaved: vi.fn() }),
}));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: vi.fn() }));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBanner: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** 지금 화면에 있는 경력 행 수 = 직장명 칸 개수. */
const careerRows = (form: HTMLElement) => form.querySelectorAll('[name$="_company"][name^="car_"]').length;

function renderEditing() {
  const { container } = render(<ResumeSheet data={emptyResume()} userId="u1" canWrite startEditing />);
  const form = container.querySelector("form");
  expect(form, "편집 모드면 form이 렌더돼야 한다").toBeTruthy();
  return form as HTMLFormElement;
}

describe("이력서 경력·학력 동적 행", () => {
  it("마지막 경력 행에 입력하면 빈 행이 자동으로 하나 늘어난다", () => {
    const form = renderEditing();
    expect(careerRows(form)).toBe(CAREER_ROWS);

    const last = form.querySelector<HTMLInputElement>(`[name="car_${CAREER_ROWS - 1}_company"]`)!;
    fireEvent.change(last, { target: { value: "강의하는아이들" } });

    expect(careerRows(form)).toBe(CAREER_ROWS + 1);
    // 값이 상태에 남아야(컨트롤드) 다음 행이 붙어도 입력한 글자가 유지된다.
    expect(form.querySelector<HTMLInputElement>(`[name="car_${CAREER_ROWS - 1}_company"]`)!.value).toBe(
      "강의하는아이들",
    );
  });

  it("+ 버튼으로도 늘고, − 버튼은 종이 서식 하한에서 멈춘다", () => {
    const form = renderEditing();
    fireEvent.click(screen.getByLabelText("경력 행 추가"));
    expect(careerRows(form)).toBe(CAREER_ROWS + 1);

    // 하한보다 많이 눌러도 CAREER_ROWS 아래로는 안 내려간다.
    for (let i = 0; i < CAREER_ROWS + 3; i++) fireEvent.click(screen.getByLabelText("경력 마지막 행 삭제"));
    expect(careerRows(form)).toBe(CAREER_ROWS);
  });

  it("학력에도 같은 손잡이가 있다", () => {
    renderEditing();
    expect(screen.getByLabelText("학력 행 추가")).toBeTruthy();
    expect(screen.getByLabelText("학력 마지막 행 삭제")).toBeTruthy();
  });
});
