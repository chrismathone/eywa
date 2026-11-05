import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CellPopover } from "./cell-popover";
import { GridProvider, useCellState } from "./grid-context";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

const { setCell } = vi.hoisted(() => ({
  setCell: vi.fn<
    (input: Record<string, unknown>) => Promise<{ ok: true; autoUnits?: number | null } | { error: string }>
  >(async () => ({
    ok: true,
  })),
}));
vi.mock("@/features/attendance/server/actions", () => ({ setAttendanceCell: setCell, setAttendanceRange: vi.fn() }));
// 격자(GridProvider) 안에서 렌더하는 테스트용 — 자동 시수(autoUnits)는 격자 컨텍스트가 준다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/prefs-actions", () => ({ saveAttendanceCollapsed: vi.fn(async () => ({ ok: true })) }));

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
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ status: "absent", units: null, note: "학부모 요청 결석", noteOnly: true }));
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

  /** 수학 자동 시수(원장 2026-09-11) — 이 반·날짜 빈 칸은 1.5가 들어간다(격자 컨텍스트가 준다). */
  describe("수학 자동 시수 — 보이는 기본값 = 저장될 값", () => {
    function openInGrid(props: Partial<React.ComponentProps<typeof CellPopover>> = {}) {
      const onSaved = vi.fn<React.ComponentProps<typeof CellPopover>["onSaved"]>();
      render(
        <GridProvider rows={[]} cols={[]} initial={{}} lockBefore={null} autoUnits={{ [C]: { [D]: 1.5 } }}>
          <CellPopover
            studentId={S}
            classId={C}
            sessionDate={D}
            status={null}
            units={null}
            note=""
            anchor={{ x: 0, top: 0 }}
            onClose={vi.fn()}
            onSaved={onSaved}
            {...props}
          />
        </GridProvider>,
      );
      return { onSaved };
    }

    it("빈 칸은 수업 길이 기본값을 약속한다", () => {
      openInGrid();
      expect(screen.getByLabelText("시수")).toHaveAttribute("placeholder", "시수(기본 1.5 · 수업 길이)");
    });

    it("🔴 수업보고서 파생 칸(recorded=false)은 상태가 보여도 새 행 — 같은 기본값을 약속하고 같은 값을 칠한다", async () => {
      setCell.mockClear();
      setCell.mockResolvedValueOnce({ ok: true, autoUnits: 1.5 });
      const { onSaved } = openInGrid({ status: "present", recorded: false });
      expect(screen.getByLabelText("시수")).toHaveAttribute("placeholder", "시수(기본 1.5 · 수업 길이)");
      fireEvent.click(screen.getByRole("button", { name: "출석" }));
      expect(onSaved.mock.calls[0]![0]).toEqual({ status: "present", units: 1.5, unitsRaw: "", note: undefined }); // 상태 버튼 = 메모 안 보냄
    });

    it("기록이 있는 칸(기본값)의 빈 시수는 '1로 되돌리기' — 자동값을 약속하지 않는다", () => {
      openInGrid({ status: "present" });
      expect(screen.getByLabelText("시수")).toHaveAttribute("placeholder", "시수(기본 1)");
    });

    it("🔴 응답 보정은 처음 칠한 표식과 함께 — 그 사이 칸이 바뀌었으면 받는 쪽이 거절한다", async () => {
      setCell.mockClear();
      setCell.mockResolvedValueOnce({ ok: true, autoUnits: null }); // 서버 조회 실패 — 실제로는 null(=1)이 들어갔다
      const token = { painted: true };
      const { onSaved } = openInGrid();
      onSaved.mockReturnValueOnce(token);
      fireEvent.click(screen.getByRole("button", { name: "출석" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
      // 상태 버튼은 메모를 안 보낸다 → 칠할 메모도 없다(undefined — 받는 쪽이 메모를 가져가지 않게).
      expect(onSaved.mock.calls[0]).toEqual([{ status: "present", units: 1.5, unitsRaw: "", note: undefined }]);
      // 서버가 새 행에 넣은 시수(조회 실패 = null)를 따로 싣는다 — 받는 쪽이 칠한 값 대신 이 값으로 맞춘다.
      expect(onSaved.mock.calls[1]).toEqual([
        { status: "present", units: null, unitsRaw: "", serverUnits: null, note: undefined },
        { ifStill: token },
      ]);
    });

    it("🔴 저장이 실패하면 처음 칠한 표식과 함께 '되돌리기'를 알린다 — 받는 쪽이 열 때의 칸 값 그 객체로 되칠한다", async () => {
      setCell.mockClear();
      setCell.mockResolvedValueOnce({ error: "권한이 없습니다" });
      const token = { painted: true };
      const { onSaved } = openInGrid({ status: "present", recorded: false });
      onSaved.mockReturnValueOnce(token);
      fireEvent.click(screen.getByRole("button", { name: "출석" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
      expect(onSaved.mock.calls[1]).toEqual([
        { status: "present", units: null, note: "" },
        { ifStill: token, revert: true },
      ]);
    });
  });

  /** 출석부 읽기 권한(원장 2026-11-05) — 쓰기 단추는 그리지 않고, 입력칸은 잠그고 권한을 말한다(write-lock.ts). */
  describe("읽기 권한", () => {
    const NOTE = writeLockedNote("attendance");

    it("🔴 상태·지우기·보강 예약·저장 단추가 없다 — 상태는 글자로, 시수·메모는 잠긴 칸에 값만", () => {
      open({ readOnly: true, locked: NOTE, status: "absent", units: null, note: "병결", onReserve: vi.fn() });
      expect(screen.getByText(NOTE)).toBeInTheDocument();
      expect(screen.getByText("결석")).toBeInTheDocument();
      for (const name of [/지각/, /^지우기$/, /보강 예약/, /메모 저장/, /^저장$/]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(screen.getByLabelText("시수")).toBeDisabled();
      expect(screen.getByLabelText("시수")).toHaveValue("1");
      const memo = screen.getByLabelText("메모(사유)");
      expect(memo).toBeDisabled();
      expect(memo).toHaveValue("병결");
      expect(memo).toHaveAttribute("placeholder", writeLockedPlaceholder("attendance"));
    });

    it("🔴 7일 잠금의 '메모는 언제든'도 열지 않는다 — 메모 저장도 같은 쓰기 게이트다", () => {
      open({ readOnly: true, locked: NOTE, status: "present", note: "" });
      expect(screen.queryByText(/언제든/)).not.toBeInTheDocument();
      expect(screen.getByLabelText("메모(사유)")).toBeDisabled();
    });

    function Probe({ date }: { date: string }) {
      const { ctx } = useCellState("probe");
      return <p data-testid="probe">{ctx ? `${ctx.readOnly}|${ctx.isLocked(date)}|${ctx.lockNoteOf(date)}` : "none"}</p>;
    }

    it("🔴 격자 — 읽기 권한이면 날짜와 무관하게 전부 잠기고, 사유는 7일이 아니라 권한이다", () => {
      render(
        <GridProvider rows={[]} cols={[]} initial={{}} lockBefore={null} readOnly>
          <Probe date="2099-01-01" />
        </GridProvider>,
      );
      expect(screen.getByTestId("probe")).toHaveTextContent(`true|true|${NOTE}`);
    });

    it("격자 — 쓰기 권한이면 종전대로(잠금 없음)", () => {
      render(
        <GridProvider rows={[]} cols={[]} initial={{}} lockBefore={null}>
          <Probe date="2099-01-01" />
        </GridProvider>,
      );
      expect(screen.getByTestId("probe")).toHaveTextContent("false|false|null");
    });
  });
});
