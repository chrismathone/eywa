import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LearningOverview } from "./learning-overview";
import type { MathSheetMonthData } from "../server/month-queries";
import type { LearningData } from "../lib/learning-plan";
import { saveMathLearningGoals } from "../server/learning-actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));
vi.mock("../server/actions", () => ({ setMyMcsFontSize: vi.fn() }));
vi.mock("../server/learning-actions", () => ({ setMathClassLearningTrack: vi.fn(), saveMathLearningGoals: vi.fn(), resetMathLearningGoals: vi.fn() }));
vi.mock("@/features/class-sheets/components/sheet-chrome", () => ({ SheetClassPicker: () => null, SheetBarDivider: () => null }));
afterEach(cleanup);
it("수업 유형 갱신 중 열었던 목표창도 최신 유형의 초안으로 저장한다", async () => {
  const data = { classId: "class", className: "합성 반", month: "2026-10", today: "2026-10-08", fontSize: "sm", canEdit: true,
    students: [{ studentId: "one", name: "합성 학생", grade: "중1", rosterPhase: "on", records: {} }], goals: {}, bookOptions: [] } as unknown as MathSheetMonthData;
  const learning: LearningData = { goals: {}, progress: {}, records: {}, status: "ok", referenceDate: data.today, track: "regular",
    context: { schedules: [{ dayOfWeek: "wed", startTime: "16:20", endTime: "17:20", validFrom: "2026-10-01", validTo: null }], holidays: {}, spans: { one: [{ start: "2026-10-01", end: null }] } } };
  const view = render(<LearningOverview data={data} learning={learning} classOptions={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "전체 목표 설정" }));
  expect(await screen.findByText("전체 12블록 · 월 4블록", {}, { timeout: 15000 })).toBeVisible();
  view.rerender(<LearningOverview data={data} learning={{ ...learning, track: "supplement" }} classOptions={[]} />);
  expect(await screen.findByText("전체 4블록 · 월 4블록")).toBeVisible();
  vi.mocked(saveMathLearningGoals).mockResolvedValue({ ok: true });
  fireEvent.click(screen.getByRole("button", { name: "전체 목표 저장" }));
  await vi.waitFor(() => expect(saveMathLearningGoals).toHaveBeenCalledWith(expect.objectContaining({ track: "supplement", blockCount: 4 })));
}, 30000);
