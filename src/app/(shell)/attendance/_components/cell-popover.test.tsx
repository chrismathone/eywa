import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CellPopover } from "./cell-popover";

const { setCell } = vi.hoisted(() => ({
  setCell: vi.fn<(input: Record<string, unknown>) => Promise<{ ok: true } | { error: string }>>(async () => ({
    ok: true,
  })),
}));
vi.mock("@/features/attendance/server/actions", () => ({ setAttendanceCell: setCell }));

const S = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const C = "aaaaaaaa-1111-1111-1111-111111111111";
const D = "2026-07-01";
const LOCK = "2026-07-01 출결은 36일 지나 강사가 수정할 수 없습니다";

function open(props: Partial<React.ComponentProps<typeof CellPopover>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CellPopover
      studentId={S}
      classId={C}
      sessionDate={D}
      status="absent"
      units={null}
      note=""
      anchor={{ x: 0, top: 0 }}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { ...view, onSaved, onClose };
}

describe("칸 상세 팝오버", () => {
  it("평소엔 상태·시수·메모를 다 고칠 수 있다", () => {
    open();
    expect(screen.getByRole("button", { name: /지각/ })).toBeInTheDocument();
    expect(screen.getByLabelText("시수")).toBeInTheDocument();
    expect(screen.getByLabelText("메모(사유)")).toBeInTheDocument();
  });

  describe("7일이 지나 잠긴 칸", () => {
    it("🔴 그래도 열린다 — 메모만 고칠 수 있다(상태·시수·지우기는 없다)", () => {
      open({ locked: LOCK });
      expect(screen.getByText(LOCK)).toBeInTheDocument();
      expect(screen.getByLabelText("메모(사유)")).toBeInTheDocument();
      // 돈이 움직이는 것들은 잠긴 채로 — 상태 선택·시수·지우기가 아예 없어야 한다.
      expect(screen.queryByRole("button", { name: /지각/ })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("시수")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "지우기" })).not.toBeInTheDocument();
    });

    it("🔴 저장은 메모만 보낸다 — 시수(급여 재료)를 함께 실어 보내지 않는다", async () => {
      setCell.mockClear();
      const { onSaved } = open({ locked: LOCK, note: "" });
      fireEvent.change(screen.getByLabelText("메모(사유)"), { target: { value: "학부모 요청 결석" } });
      fireEvent.click(screen.getByRole("button", { name: /메모 저장/ }));
      await waitFor(() => expect(setCell).toHaveBeenCalled());
      const arg = setCell.mock.calls[0]![0];
      expect(arg.noteOnly).toBe(true);
      expect(arg.note).toBe("학부모 요청 결석");
      expect(arg).not.toHaveProperty("units");
      // 격자에도 상태·시수는 그대로 반영된다(메모만 바뀐다).
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ status: "absent", units: null, note: "학부모 요청 결석" }));
    });

    it("🔴 서버가 거절하면 닫지 않고 이유를 보여 준다 — 적은 메모가 조용히 사라지면 안 된다", async () => {
      setCell.mockClear();
      setCell.mockResolvedValueOnce({ error: "그날 출결 기록이 없어 메모만 남길 수 없습니다" });
      const { onClose, onSaved } = open({ locked: LOCK });
      fireEvent.change(screen.getByLabelText("메모(사유)"), { target: { value: "지각 사유" } });
      fireEvent.click(screen.getByRole("button", { name: /메모 저장/ }));
      await waitFor(() => expect(screen.getByText(/기록이 없어/)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByLabelText("메모(사유)")).toHaveValue("지각 사유");
    });

    it("기록이 아예 없는 칸엔 메모를 못 붙인다 — 없는 출결을 지어내지 않는다", () => {
      open({ locked: LOCK, status: null });
      expect(screen.queryByLabelText("메모(사유)")).not.toBeInTheDocument();
      expect(screen.getByText(/기록이 없는 날/)).toBeInTheDocument();
    });
  });
});
