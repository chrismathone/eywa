import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { MasterSheetForm } from "./sheet-form";
import { preview } from "./test-preview";
const api = vi.hoisted(() => ({
  tabs: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/features/timetable/server/master-sheet-actions", () => ({
  listMasterSheetTabs: api.tabs,
  previewMasterSheet: api.preview,
  applyMasterSheet: api.apply,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.mockResolvedValue({
    ok: true,
    title: "월별 시간표",
    tabs: [
      { gid: 1, title: "강사별(10월)", hidden: false },
      { gid: 2, title: " 통합(10월)", hidden: false },
    ],
  });
});
afterEach(cleanup);
async function open() {
  const user = userEvent.setup();
  render(
    <MasterSheetForm
      today="2026-10-01"
      defaultSource="https://docs.google.com/spreadsheets/d/sheet/edit"
    />,
  );
  await user.click(screen.getByRole("button", { name: "탭 불러오기" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "미리보기" })).toBeEnabled(),
  );
  return user;
}
describe("영어 시트 화면의 실제 버튼 배선", () => {
  it("적용 불가 이유·수정 방법·원본 셀을 보이고 적용을 막는다", async () => {
    api.preview.mockResolvedValue({
      ok: true,
      preview: preview([
        {
          key: "student",
          severity: "error",
          target: "퇴원 학생",
          reason: "현재 퇴원 상태입니다.",
          fix: "학생 상태를 수정해 주세요.",
          tab: " 통합(10월)",
          cell: "C7",
          href: "/students/s1",
        },
      ]),
    });
    const user = await open();
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    expect(await screen.findByText("현재 퇴원 상태입니다.")).toBeVisible();
    expect(screen.getByText("학생 상태를 수정해 주세요.")).toBeVisible();
    expect(screen.getByRole("link", { name: /C7 열기/ })).toHaveAttribute(
      "href",
      "https://docs.google.com/spreadsheets/d/sheet/edit#gid=2&range=C7",
    );
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.preview.mock.calls[0]?.[0].rosterTab).toBe(" 통합(10월)");
  });
  it("전체 확인이 적용 서버에 전달되고 바뀐 결과를 받으면 다시 차단한다", async () => {
    const p = preview([
      {
        key: "conflict",
        severity: "confirm",
        target: "시간 겹침",
        reason: "수학 수업과 겹칩니다.",
        fix: "등원 요일을 확인해 주세요.",
      },
    ]);
    api.preview.mockResolvedValue({ ok: true, preview: p });
    api.apply.mockResolvedValue({
      ok: false,
      stage: "재검사 및 적용",
      error: "시트 또는 에이와 정보가 변경되었습니다.",
      preview: preview([
        {
          key: "new",
          severity: "error",
          target: "새 오류",
          reason: "반 연결이 변경되었습니다.",
          fix: "다시 선택하세요.",
        },
      ]),
    });
    const user = await open();
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    const apply = await screen.findByRole("button", { name: "적용" });
    expect(apply).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "확인 항목 전체 확인" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "확인 항목 전체 확인" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "시간 겹침 확인" }),
    ).toBeChecked();
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(await screen.findByText("반 연결이 변경되었습니다.")).toBeVisible();
    expect(apply).toBeDisabled();
    expect(api.apply).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: "2026-10-01" }),
      p.hash,
      ["conflict"],
    );
  });
  it("입력 변경은 재검사를 요구하며 미래 적용의 성공 결과를 표시한다", async () => {
    api.preview.mockResolvedValue({ ok: true, preview: preview() });
    api.apply.mockResolvedValue({
      ok: true,
      result: {
        scheduled: true,
        effectiveDate: "2026-11-01",
        closed: 0,
        inserted: 1,
        moved: 0,
        added: 0,
        snapshotId: "s",
        rosterSnapshotId: null,
      },
    });
    const user = await open();
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "적용" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("적용일"), {
      target: { value: "2026-11-01" },
    });
    expect(screen.getByRole("button", { name: "예약 적용" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "수정 내용 다시 검사" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "예약 적용" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "예약 적용" }));
    expect(
      await screen.findByText("2026-11-01 반영을 예약했습니다."),
    ).toBeVisible();
  });
});
