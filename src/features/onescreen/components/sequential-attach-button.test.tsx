import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SequentialAttachButton } from "./sequential-attach-button";
import type { PhotoTarget } from "../sequential-photo";
import { buildGridRows } from "../grid";
import type { OneScreenStudent } from "../types";

const device = vi.hoisted(() => ({ mobile: true }));
vi.mock("./use-mobile-camera", () => ({ useMobileCamera: () => device.mobile }));
vi.mock("next/dynamic", () => ({ default: () => ({ targets }: { targets: PhotoTarget[] }) => <span data-testid="frozen-targets">{targets.map(t => `${t.name}:${t.classId}:${t.date}`).join(",")}</span> }));
afterEach(() => { cleanup(); device.mobile = true; });
const rows = buildGridRows([{ id: "a", name: "이학생", subjects: [{ name: "영어", subjectKey: "english", classId: "jj", today: "1" }] } as OneScreenStudent]);
const props = { rows, reports: {}, attachment: { date: "2026-10-29", busy: false, onAttach: vi.fn(), onUploadingChange: vi.fn() }, disabled: false };

it("모바일에서만 버튼을 보이고 PC나 영어 행이 없는 표에서는 숨긴다", () => {
  const { rerender } = render(<SequentialAttachButton {...props} />);
  expect(screen.getByRole("button", { name: "연속 첨부" })).toBeTruthy();
  device.mobile = false;
  rerender(<SequentialAttachButton {...props} />);
  expect(screen.queryByRole("button", { name: "연속 첨부" })).toBeNull();
  device.mobile = true;
  rerender(<SequentialAttachButton {...props} rows={rows.map(r => ({ ...r, subject: { ...r.subject, subjectKey: "math" } }))} />);
  expect(screen.queryByRole("button", { name: "연속 첨부" })).toBeNull();
});
it("촬영을 시작하면 명단·반·날짜를 고정하고 새 정렬이나 조회 날짜를 섞지 않는다", () => {
  const { rerender } = render(<SequentialAttachButton {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "연속 첨부" }));
  expect(screen.getByTestId("frozen-targets").textContent).toBe("이학생:jj:2026-10-29");
  rerender(<SequentialAttachButton {...props} rows={[]} attachment={{ ...props.attachment, date: "2026-11-13" }} />);
  // Keep the open session even if the current table becomes empty; it may still contain local photos.
  expect(screen.getByTestId("frozen-targets").textContent).toBe("이학생:jj:2026-10-29");
});
