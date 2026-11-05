import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GradeEntryDialog } from "./grade-entry-dialog";

vi.mock("@/features/grades/server/actions", () => ({ saveGradeScores: vi.fn() }));
vi.mock("@/features/grades/unified/server/create-action", () => ({ createUnifiedGrade: vi.fn() }));
vi.mock("@/features/grades/unified/server/entry-actions", () => ({ loadSchoolRoster: vi.fn() }));
afterEach(cleanup);

const props = { today: "2026-11-05", subjects: [{ value: "math", label: "수학" }], students: [], classes: [], classNamesOf: {} };

describe("성적 입력 창 — 읽기 권한(원장 2026-11-05)", () => {
  it("🔴 읽기 권한이면 '성적 입력' 단추를 그리지 않고, `?entry=1`로 와도 창을 열지 않는다", () => {
    render(<GradeEntryDialog {...props} canWrite={false} initialOpen />);
    expect(screen.queryByRole("button", { name: "성적 입력" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("쓰기 권한이면 단추가 서고 `?entry=1`이면 창이 열린 채 시작한다", () => {
    render(<GradeEntryDialog {...props} canWrite initialOpen />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
