import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * 새 반 양식의 **읽기 권한 모양**(원장 2026-11-05 — lib/write-lock.ts) — 주소로 바로 들어온 읽기 권한 사용자가
 * 양식을 끝까지 쓴 뒤에야 "관리자만"을 듣던 꼴을 잠근다: 칸은 전부 꺼지고 안내가 서며, 저장·행 추가 단추는 없다.
 */
const createClass = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/classes/server/actions", () => ({
  createClass: (...a: unknown[]) => createClass(...a),
  updateClass: vi.fn(),
}));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({
    options: [{ value: "math", label: "수학" }],
    labelOf: (k: string) => k,
  }),
}));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: vi.fn() }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({
  useUnsavedGuard: () => ({ markSaved: vi.fn() }),
}));
vi.mock("@/lib/ui/conflict-toast", () => ({ conflictToast: vi.fn() }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: vi.fn() }));

import { ClassForm } from "./class-form";

function renderForm(readOnly: boolean) {
  return render(
    <ClassForm
      mode="create"
      today="2026-11-05"
      teacherOptions={[{ id: "t-1", name: "이성우" }]}
      classroomOptions={[{ id: "r-1", name: "301호", capacity: 10 }]}
      subjectOptions={[{ value: "math", label: "수학" }]}
      readOnly={readOnly}
    />,
  );
}

describe("새 반 양식 — 읽기 권한", () => {
  it("🔴 칸은 전부 꺼지고(시간표 격자 포함) 안내가 서며, '반 생성'·'시각 추가'는 그리지 않는다", () => {
    renderForm(true);
    expect(screen.getByText("읽기 권한입니다. 고치려면 수업목록 작성 권한이 필요합니다.")).toBeInTheDocument();
    const locked = screen.getAllByPlaceholderText("수업목록 작성 권한이 필요합니다");
    expect(locked).toHaveLength(2); // 반 이름 · 메모
    for (const field of locked) expect(field).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "과목" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "강사" })).toBeDisabled();
    // 시간표 격자 칸(요일×교시 버튼)도 함께 꺼진다 — 칸마다 따로 끄지 않고 fieldset 하나로.
    const gridCells = screen.getAllByRole("button", { pressed: false });
    expect(gridCells.length).toBeGreaterThan(0);
    for (const cell of gridCells) expect(cell).toBeDisabled();
    expect(screen.queryByRole("button", { name: /반 생성/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /시각 추가/ })).not.toBeInTheDocument();
  });

  it("쓰기 권한이면 종전 그대로 — 칸이 켜져 있고 '반 생성'이 있다", () => {
    renderForm(false);
    expect(screen.queryByText(/읽기 권한입니다/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("예: 중3 수학 심화반")).toBeEnabled();
    expect(screen.getByRole("button", { name: /반 생성/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /시각 추가/ })).toBeInTheDocument();
  });
});
